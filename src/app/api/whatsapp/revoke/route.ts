/**
 * POST /api/whatsapp/revoke — delete an agent message for everyone.
 * Body: { conversation_id, message_db_id }
 *
 * Sends the WhatsApp revoke, then blanks the local row so the thread
 * shows "[deleted]".
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveConfigForConversation } from '@/lib/whatsapp/config-resolver'

const BAILEYS_SERVICE_URL = process.env.BAILEYS_SERVICE_URL ?? 'http://localhost:3001'
const BAILEYS_API_SECRET = process.env.BAILEYS_API_SECRET ?? ''

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversation_id, message_db_id } = await request.json()
  if (!conversation_id || !message_db_id) {
    return NextResponse.json({ error: 'conversation_id and message_db_id required' }, { status: 400 })
  }

  const { data: msg } = await supabase
    .from('messages')
    .select('id, message_id, sender_type, conversation_id')
    .eq('id', message_db_id)
    .eq('conversation_id', conversation_id)
    .maybeSingle()
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  if (msg.sender_type !== 'agent' && msg.sender_type !== 'bot') {
    return NextResponse.json({ error: 'Can only delete your own outbound messages' }, { status: 400 })
  }
  if (!msg.message_id || msg.message_id.startsWith('baileys-') || msg.message_id.startsWith('api-')) {
    return NextResponse.json(
      { error: 'No WhatsApp id for this message — cannot revoke remotely' },
      { status: 400 },
    )
  }

  const { data: conv } = await supabase
    .from('conversations')
    .select('account_id, phone_number_id, is_group, group_jid, contact:contacts(phone)')
    .eq('id', conversation_id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const config = await resolveConfigForConversation(supabase, conv.account_id, conv.phone_number_id, 'phone_number_id')
  if (!config) return NextResponse.json({ error: 'Not configured' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = conv.contact as any
  const jid = conv.is_group && conv.group_jid
    ? conv.group_jid
    : `${String(contact?.phone ?? '').replace(/\D/g, '')}@s.whatsapp.net`

  const res = await fetch(`${BAILEYS_SERVICE_URL}/sessions/${config.phone_number_id}/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BAILEYS_API_SECRET}`,
    },
    body: JSON.stringify({ jid, messageId: msg.message_id }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    return NextResponse.json({ error: payload?.error ?? 'revoke failed' }, { status: res.status })
  }

  await supabase
    .from('messages')
    .update({ content_text: '🚫 You deleted this message', content_type: 'text', media_url: null })
    .eq('id', msg.id)

  return NextResponse.json({ ok: true })
}

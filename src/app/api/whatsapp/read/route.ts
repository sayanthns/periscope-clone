/**
 * POST /api/whatsapp/read — mark recent inbound messages read on WhatsApp
 * (sender sees blue ticks). Fired when an agent opens a conversation.
 * Body: { conversation_id }
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

  const { conversation_id } = await request.json()
  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
  }

  const { data: conv } = await supabase
    .from('conversations')
    .select('account_id, phone_number_id, is_group, group_jid, contact:contacts(phone)')
    .eq('id', conversation_id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Multi-number: read receipts go out from the number that owns this chat
  const config = await resolveConfigForConversation(supabase, conv.account_id, conv.phone_number_id)
  if (!config) return NextResponse.json({ error: 'Not configured' }, { status: 400 })

  // Last 25 inbound messages with real WA ids
  const { data: msgs } = await supabase
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversation_id)
    .eq('sender_type', 'customer')
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(25)

  const ids = (msgs ?? [])
    .map((m: { message_id: string | null }) => m.message_id)
    .filter((id): id is string => !!id && !id.startsWith('baileys-') && !id.startsWith('api-'))

  if (!ids.length) return NextResponse.json({ ok: true, marked: 0 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = conv.contact as any
  const jid = conv.is_group && conv.group_jid
    ? conv.group_jid
    : `${String(contact?.phone ?? '').replace(/\D/g, '')}@s.whatsapp.net`

  const res = await fetch(`${BAILEYS_SERVICE_URL}/sessions/${config.phone_number_id}/read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BAILEYS_API_SECRET}`,
    },
    body: JSON.stringify({ keys: ids.map((id) => ({ remoteJid: jid, id })) }),
  })
  if (!res.ok) {
    return NextResponse.json({ error: 'read failed' }, { status: res.status })
  }
  return NextResponse.json({ ok: true, marked: ids.length })
}

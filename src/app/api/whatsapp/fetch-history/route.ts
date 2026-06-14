/**
 * POST /api/whatsapp/fetch-history — backfill older messages for a chat
 * from WhatsApp, without needing a fresh QR relink.
 *
 * Body: { conversation_id }
 *
 * Finds the oldest stored message in the conversation, asks baileys-service
 * to fetch history before it. The fetched messages stream back through
 * messaging-history.set → /api/whatsapp/history-sync, so the thread fills
 * in after a moment. Requires a connected session.
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

  const config = await resolveConfigForConversation(
    supabase, conv.account_id, conv.phone_number_id, 'phone_number_id',
  )
  if (!config) return NextResponse.json({ error: 'Not configured' }, { status: 400 })

  // Oldest stored message with a real WhatsApp id — our anchor point
  const { data: oldest } = await supabase
    .from('messages')
    .select('message_id, created_at, sender_type')
    .eq('conversation_id', conversation_id)
    .not('message_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!oldest?.message_id || oldest.message_id.startsWith('baileys-') || oldest.message_id.startsWith('api-')) {
    return NextResponse.json(
      { error: 'No anchor message to fetch history before. Receive a message first.' },
      { status: 400 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = conv.contact as any
  const remoteJid = conv.is_group && conv.group_jid
    ? conv.group_jid
    : `${String(contact?.phone ?? '').replace(/\D/g, '')}@s.whatsapp.net`

  const oldestTs = Math.floor(new Date(oldest.created_at).getTime() / 1000)

  const res = await fetch(`${BAILEYS_SERVICE_URL}/sessions/${config.phone_number_id}/fetch-history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BAILEYS_API_SECRET}`,
    },
    body: JSON.stringify({
      remoteJid,
      oldestId: oldest.message_id,
      oldestTs,
      fromMe: oldest.sender_type === 'agent' || oldest.sender_type === 'bot',
      count: 50,
    }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    return NextResponse.json({ error: payload?.error ?? 'fetch failed' }, { status: res.status })
  }
  // History arrives async; client should refetch the thread after a beat.
  return NextResponse.json({ ok: true, pending: true })
}

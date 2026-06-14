/**
 * POST /api/whatsapp/presence — typing/recording indicator on WhatsApp.
 * Body: { conversation_id, state: 'composing' | 'recording' | 'paused' }
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

  const { conversation_id, state } = await request.json()
  if (!conversation_id || !['composing', 'recording', 'paused'].includes(state)) {
    return NextResponse.json({ error: 'conversation_id and valid state required' }, { status: 400 })
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

  const res = await fetch(`${BAILEYS_SERVICE_URL}/sessions/${config.phone_number_id}/presence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BAILEYS_API_SECRET}`,
    },
    body: JSON.stringify({ jid, state }),
  })
  if (!res.ok) {
    return NextResponse.json({ error: 'presence failed' }, { status: res.status })
  }
  return NextResponse.json({ ok: true })
}

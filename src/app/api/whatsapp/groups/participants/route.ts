/**
 * Group participant management — proxy to baileys-service.
 *
 * GET  ?jid=<group_jid>            → metadata + participants
 * POST { jid, action, phones[] }   → add | remove | promote | demote
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const BAILEYS_SERVICE_URL = process.env.BAILEYS_SERVICE_URL ?? 'http://localhost:3001'
const BAILEYS_API_SECRET = process.env.BAILEYS_API_SECRET ?? ''

async function resolvePhoneNumberId(): Promise<{ phoneNumberId: string } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()
  if (!profile?.account_id) {
    return { error: NextResponse.json({ error: 'No account' }, { status: 403 }) }
  }
  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id')
    .eq('account_id', profile.account_id)
    .single()
  if (!config) {
    return { error: NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 }) }
  }
  return { phoneNumberId: config.phone_number_id }
}

export async function GET(request: Request) {
  const resolved = await resolvePhoneNumberId()
  if ('error' in resolved) return resolved.error

  const url = new URL(request.url)
  const jid = url.searchParams.get('jid')
  if (!jid || !jid.endsWith('@g.us')) {
    return NextResponse.json({ error: 'valid group jid required' }, { status: 400 })
  }

  const res = await fetch(
    `${BAILEYS_SERVICE_URL}/sessions/${resolved.phoneNumberId}/groups/${encodeURIComponent(jid)}/metadata`,
    { headers: { Authorization: `Bearer ${BAILEYS_API_SECRET}` } },
  )
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    return NextResponse.json({ error: payload?.error ?? 'baileys error' }, { status: res.status })
  }
  return NextResponse.json(payload)
}

export async function POST(request: Request) {
  const resolved = await resolvePhoneNumberId()
  if ('error' in resolved) return resolved.error

  const body = await request.json()
  const { jid, action, phones } = body as {
    jid: string
    action: 'add' | 'remove' | 'promote' | 'demote'
    phones: string[]
  }

  if (!jid?.endsWith('@g.us') || !['add', 'remove', 'promote', 'demote'].includes(action) || !Array.isArray(phones) || !phones.length) {
    return NextResponse.json({ error: 'jid, action and phones[] required' }, { status: 400 })
  }

  // Accept raw phones or full jids
  const participants = phones.map((p) =>
    p.includes('@') ? p : `${p.replace(/\D/g, '')}@s.whatsapp.net`,
  )

  const res = await fetch(
    `${BAILEYS_SERVICE_URL}/sessions/${resolved.phoneNumberId}/groups/${encodeURIComponent(jid)}/participants`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BAILEYS_API_SECRET}`,
      },
      body: JSON.stringify({ action, participants }),
    },
  )
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    return NextResponse.json({ error: payload?.error ?? 'baileys error' }, { status: res.status })
  }
  return NextResponse.json(payload)
}

/**
 * Public API v1 — send a WhatsApp message.
 *
 * POST /api/v1/messages
 * Auth: Authorization: Bearer pk_<key>   (created in Settings → Workspace)
 *
 * Body: { phone: string, text: string }
 *   or  { group_jid: string, text: string }
 *
 * Returns: { ok: true, conversation_id }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { sendTextMessage } from '@/lib/whatsapp/baileys-api'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authenticate(request: Request): Promise<{ accountId: string; userId: string } | null> {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer pk_')) return null
  const raw = auth.slice(7)
  const hash = createHash('sha256').update(raw).digest('hex')

  const { data: key } = await supabaseAdmin()
    .from('api_keys')
    .select('id, account_id')
    .eq('key_hash', hash)
    .maybeSingle()
  if (!key) return null

  void supabaseAdmin().from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)

  const { data: account } = await supabaseAdmin()
    .from('accounts')
    .select('owner_user_id')
    .eq('id', key.account_id)
    .single()
  if (!account) return null

  return { accountId: key.account_id, userId: account.owner_user_id }
}

export async function POST(request: Request) {
  const auth = await authenticate(request)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }
  const { accountId, userId } = auth

  let body: { phone?: string; group_jid?: string; text?: string; from?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { phone, group_jid, text } = body
  if (!text?.trim() || (!phone && !group_jid)) {
    return NextResponse.json(
      { error: 'text and either phone or group_jid are required' },
      { status: 400 },
    )
  }

  // Multi-number: an account may have several. Optional body.from selects
  // one by phone_number_id; otherwise prefer a connected number.
  const { data: cfgRows } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('phone_number_id, status')
    .eq('account_id', accountId)
  const cfgList = (cfgRows ?? []) as Array<{ phone_number_id: string; status: string }>
  const fromNum = body.from ? String(body.from).replace(/\D/g, '') : null
  const config =
    (fromNum && cfgList.find((c) => c.phone_number_id === fromNum)) ||
    cfgList.find((c) => c.status === 'connected') ||
    cfgList[0] ||
    null
  if (!config) {
    return NextResponse.json({ error: 'WhatsApp not connected' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  let conversationId: string | null = null

  try {
    if (group_jid) {
      // Group send — must be a known group conversation
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('group_jid', group_jid)
        .maybeSingle()
      if (!conv) {
        return NextResponse.json({ error: 'Unknown group_jid' }, { status: 404 })
      }
      conversationId = conv.id

      await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken: '',
        to: group_jid,
        text: text.trim(),
      })
    } else {
      // 1:1 — find/create contact + conversation (mirrors new-conversation route)
      const normalized = normalizePhone(phone!)
      let { data: contact } = await admin
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .eq('phone', normalized)
        .maybeSingle()
      if (!contact) {
        const { data: created, error } = await admin
          .from('contacts')
          .insert({
            account_id: accountId,
            user_id: userId,
            phone: normalized,
            name: normalized,
            opted_in: true,
            opted_in_at: new Date().toISOString(),
          })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        contact = created
      }

      let { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contact!.id)
        .maybeSingle()
      if (!conv) {
        const { data: created, error } = await admin
          .from('conversations')
          .insert({
            account_id: accountId,
            user_id: userId,
            contact_id: contact!.id,
            status: 'open',
            phone_number_id: config.phone_number_id,
          })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        conv = created
      }
      conversationId = conv!.id

      await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken: '',
        to: normalized,
        text: text.trim(),
      })
    }

    await admin.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: text.trim(),
      message_id: `api-${Date.now()}`,
      status: 'sent',
    })

    await admin.from('conversations').update({
      last_message_text: text.trim(),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', conversationId)

    return NextResponse.json({ ok: true, conversation_id: conversationId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

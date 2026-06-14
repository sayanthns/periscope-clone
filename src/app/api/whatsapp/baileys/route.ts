/**
 * Baileys session management API
 *
 * POST /api/whatsapp/baileys
 *   Body: { phone_id: string }  — e.g. "919876543210" (digits only)
 *   - Upserts whatsapp_config row (phone_number_id = phone_id)
 *   - Calls baileys-service to start session
 *   - Returns { ok: true }
 *
 * GET /api/whatsapp/baileys?phoneId=xxx
 *   - Proxies to baileys-service GET /sessions/:phoneId/status
 *   - Returns { status: 'scanning'|'connected'|'disconnected', qr: string|null, qrImage: string|null }
 *   - qrImage is a base64 PNG data URL ready for <img src={...} />
 *
 * DELETE /api/whatsapp/baileys?phoneId=xxx
 *   - Calls baileys-service DELETE /sessions/:phoneId
 *   - Updates whatsapp_config status = 'disconnected'
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import QRCode from 'qrcode'

const BAILEYS_SERVICE_URL = process.env.BAILEYS_SERVICE_URL ?? 'http://localhost:3001'
const BAILEYS_API_SECRET = process.env.BAILEYS_API_SECRET ?? ''

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

async function baileysReq(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${BAILEYS_SERVICE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BAILEYS_API_SECRET}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function getAccountAndUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('user_id', user.id).maybeSingle()
  if (!profile?.account_id) return null

  return { user, accountId: profile.account_id as string }
}

// ── POST — start a new Baileys session ────────────────────────────────────────
export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await getAccountAndUser(supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, accountId } = auth

  const body = (await request.json()) as { phone_id?: string; label?: string }
  const phone_id = body.phone_id
  const label = body.label?.trim() || null
  if (!phone_id || !/^\d{7,15}$/.test(phone_id)) {
    return NextResponse.json(
      { error: 'phone_id must be digits only (7-15 chars), e.g. 919876543210' },
      { status: 400 }
    )
  }

  // Block if ANOTHER account claimed this phone_id (globally unique)
  const { data: claimed } = await supabaseAdmin()
    .from('whatsapp_config').select('account_id')
    .eq('phone_number_id', phone_id).neq('account_id', accountId).maybeSingle()

  if (claimed) {
    return NextResponse.json(
      { error: 'This phone number is already connected to another account.' },
      { status: 409 }
    )
  }

  // Multi-number: one config row PER phone_number_id (not per account).
  // Match on (account_id, phone_number_id); insert a new row for a new
  // number, update in place when re-connecting an existing one.
  const encryptedPlaceholder = encrypt(phone_id)

  const { data: existing } = await supabase
    .from('whatsapp_config').select('id')
    .eq('account_id', accountId)
    .eq('phone_number_id', phone_id)
    .maybeSingle()

  if (existing) {
    await supabase.from('whatsapp_config').update({
      status: 'disconnected',
      ...(label !== null ? { label } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id)
  } else {
    const { error: insertErr } = await supabase.from('whatsapp_config').insert({
      account_id: accountId,
      user_id: user.id,
      phone_number_id: phone_id,
      label,
      access_token: encryptedPlaceholder,
      status: 'disconnected',
    })
    if (insertErr) {
      console.error('[baileys POST] insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
    }
  }

  // Tell baileys-service to start the session
  try {
    const res = await baileysReq(`/sessions/${phone_id}/start`, 'POST')
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      return NextResponse.json({ error: err.error ?? 'baileys-service error' }, { status: 500 })
    }
  } catch (err) {
    console.error('[baileys POST] service call error:', err)
    return NextResponse.json(
      { error: 'Cannot reach baileys-service. Is it running?' },
      { status: 503 }
    )
  }

  return NextResponse.json({ ok: true, phone_id })
}

// ── GET — poll QR/status ───────────────────────────────────────────────────────
export async function GET(request: Request) {
  const supabase = await createClient()
  const auth = await getAccountAndUser(supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  // ?list=1 — return every number connected to this account (settings UI)
  if (searchParams.get('list') === '1') {
    const { data: rows } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, label, status, connected_at')
      .eq('account_id', auth.accountId)
      .order('created_at', { ascending: true })
    return NextResponse.json({ numbers: rows ?? [] })
  }

  const phoneId = searchParams.get('phoneId')
  if (!phoneId) return NextResponse.json({ error: 'phoneId param required' }, { status: 400 })

  try {
    const res = await baileysReq(`/sessions/${phoneId}/status`, 'GET')
    if (!res.ok) {
      return NextResponse.json({ status: 'disconnected', qrImage: null })
    }
    const data = await res.json() as { status: string; qr: string | null }

    let qrImage: string | null = null
    if (data.qr) {
      try {
        qrImage = await QRCode.toDataURL(data.qr, {
          width: 256,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        })
      } catch (err) {
        console.error('[baileys GET] QR render error:', err)
      }
    }

    return NextResponse.json({ status: data.status, qrImage })
  } catch (err) {
    console.error('[baileys GET] service error:', err)
    return NextResponse.json({ status: 'disconnected', qrImage: null })
  }
}

// ── DELETE — disconnect ────────────────────────────────────────────────────────
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const auth = await getAccountAndUser(supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { accountId } = auth

  const { searchParams } = new URL(request.url)
  const phoneId = searchParams.get('phoneId')
  const remove = searchParams.get('remove') === '1'
  if (!phoneId) return NextResponse.json({ error: 'phoneId param required' }, { status: 400 })

  // Stop baileys session
  try {
    await baileysReq(`/sessions/${phoneId}`, 'DELETE')
  } catch (err) {
    console.error('[baileys DELETE] service error:', err)
    // Non-fatal — still update DB
  }

  if (remove) {
    // Fully remove this number's config row (account-scoped)
    await supabase.from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('phone_number_id', phoneId)
  } else {
    // Just mark this one number disconnected — leave others untouched
    await supabase.from('whatsapp_config').update({
      status: 'disconnected',
      connected_at: null,
      updated_at: new Date().toISOString(),
    }).eq('account_id', accountId).eq('phone_number_id', phoneId)
  }

  return NextResponse.json({ ok: true })
}

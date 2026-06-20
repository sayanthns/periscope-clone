/**
 * GET /api/whatsapp/sla/cron
 *
 * Flags SLA breaches. Hit every minute by the server crontab.
 * Auth: x-cron-secret header must match BAILEYS_API_SECRET.
 *
 *   first_response_breached → first_response_due_at passed, still unmet
 *   resolution_breached     → resolution_due_at passed, still unresolved
 *
 * Idempotent (only flips false→true once). Fires a webhook per breach so
 * supervisors can be alerted.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export async function GET(request: Request) {
  const expected = process.env.BAILEYS_API_SECRET
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const nowIso = new Date().toISOString()

  // First-response breaches
  const { data: frBreaches } = await admin
    .from('conversations')
    .select('id, account_id')
    .is('first_response_met_at', null)
    .eq('first_response_breached', false)
    .not('first_response_due_at', 'is', null)
    .lt('first_response_due_at', nowIso)
    .limit(200)

  // Resolution breaches
  const { data: resBreaches } = await admin
    .from('conversations')
    .select('id, account_id')
    .is('resolved_at', null)
    .eq('resolution_breached', false)
    .not('resolution_due_at', 'is', null)
    .lt('resolution_due_at', nowIso)
    .limit(200)

  const frIds = (frBreaches ?? []).map((c: { id: string }) => c.id)
  const resIds = (resBreaches ?? []).map((c: { id: string }) => c.id)

  if (frIds.length) {
    await admin.from('conversations').update({ first_response_breached: true }).in('id', frIds)
  }
  if (resIds.length) {
    await admin.from('conversations').update({ resolution_breached: true }).in('id', resIds)
  }

  // Fire breach webhooks (best-effort, per account)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fire = async (rows: any[], kind: string) => {
    for (const c of rows ?? []) {
      try {
        const { data: hooks } = await admin
          .from('webhooks').select('url, secret')
          .eq('account_id', c.account_id).eq('enabled', true)
          .contains('events', ['sla.breached'])
        for (const h of hooks ?? []) {
          const body = JSON.stringify({ event: 'sla.breached', kind, conversation_id: c.id, at: nowIso })
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (h.secret) {
            const { createHmac } = await import('crypto')
            headers['x-webhook-signature'] = createHmac('sha256', h.secret).update(body).digest('hex')
          }
          fetch(h.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) }).catch(() => {})
        }
      } catch { /* best-effort */ }
    }
  }
  await fire(frBreaches ?? [], 'first_response')
  await fire(resBreaches ?? [], 'resolution')

  return NextResponse.json({
    first_response_breached: frIds.length,
    resolution_breached: resIds.length,
  })
}

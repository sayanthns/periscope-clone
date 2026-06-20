/**
 * POST /api/whatsapp/status
 *
 * Receives delivery/read receipts for OUR outbound messages, pushed by
 * baileys-service from the Baileys `messages.update` event.
 * Auth: Authorization: Bearer {BAILEYS_API_SECRET}
 *
 * Body: { phoneId: string, messageId: string, status: number }
 * where `status` is the Baileys WAMessageStatus ack:
 *   0 ERROR · 1 PENDING · 2 SERVER_ACK(sent) · 3 DELIVERY_ACK(delivered)
 *   4 READ · 5 PLAYED
 *
 * Advances messages.status (sending → sent → delivered → read) and never
 * regresses: the update is filtered on the set of statuses it may advance
 * FROM, so an out-of-order delivered ack can't downgrade a read message.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

/** Map a Baileys ack number to our status + the statuses it may advance from. */
function mapStatus(n: number): { status: string; from: string[] } | null {
  if (n === 0) return { status: 'failed', from: ['sending', 'sent', 'delivered'] }
  if (n <= 2) return { status: 'sent', from: ['sending'] }
  if (n === 3) return { status: 'delivered', from: ['sending', 'sent'] }
  // 4 READ, 5 PLAYED → read
  return { status: 'read', from: ['sending', 'sent', 'delivered'] }
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.BAILEYS_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { phoneId?: string; messageId?: string; status?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { messageId, status } = body
  if (!messageId || typeof status !== 'number') {
    return NextResponse.json({ error: 'messageId and numeric status required' }, { status: 400 })
  }

  const mapped = mapStatus(status)
  if (!mapped) return NextResponse.json({ ok: true, skipped: 'unmapped' })

  // Forward-only: only advance from an earlier state, so reordered acks
  // (e.g. a late "delivered" after "read") can't downgrade the tick.
  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status: mapped.status })
    .eq('message_id', messageId)
    .in('status', mapped.from)

  if (error) {
    console.error('[status] update failed:', error.message)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status: mapped.status })
}

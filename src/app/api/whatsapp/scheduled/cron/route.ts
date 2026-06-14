/**
 * GET /api/whatsapp/scheduled/cron
 *
 * Drains due scheduled_messages rows. Hit every minute by the server
 * crontab. Auth: x-cron-secret header must match BAILEYS_API_SECRET
 * (reused so no new env var is needed).
 *
 * Claim step (status pending → sending via conditional UPDATE) prevents
 * double-sends from overlapping invocations. Recurring rows are re-armed
 * after a successful send; one-offs are marked sent.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendTextMessage } from '@/lib/whatsapp/baileys-api'
import { resolveConfigForConversation } from '@/lib/whatsapp/config-resolver'

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

function nextOccurrence(from: Date, recurrence: string): Date {
  const next = new Date(from)
  if (recurrence === 'daily') next.setDate(next.getDate() + 1)
  else if (recurrence === 'weekly') next.setDate(next.getDate() + 7)
  else if (recurrence === 'monthly') next.setMonth(next.getMonth() + 1)
  return next
}

export async function GET(request: Request) {
  const expected = process.env.BAILEYS_API_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('send_at', new Date().toISOString())
    .order('send_at', { ascending: true })
    .limit(25)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  let failed = 0

  for (const row of due) {
    // Claim — only proceed if we flipped it ourselves
    const { data: claim } = await admin
      .from('scheduled_messages')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      // Load conversation + contact + config
      const { data: conv } = await admin
        .from('conversations')
        .select('*, contact:contacts(*)')
        .eq('id', row.conversation_id)
        .single()
      if (!conv) throw new Error('conversation missing')

      // Multi-number: send from the number that owns this conversation
      const config = await resolveConfigForConversation(
        admin, row.account_id, conv.phone_number_id, 'phone_number_id',
      )
      if (!config) throw new Error('whatsapp_config missing')

      const to = conv.is_group && conv.group_jid
        ? conv.group_jid
        : conv.contact?.phone
      if (!to) throw new Error('no recipient')

      await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken: '',
        to,
        text: row.content_text,
      })

      await admin.from('messages').insert({
        conversation_id: row.conversation_id,
        sender_type: 'agent',
        sender_id: row.user_id,
        content_type: 'text',
        content_text: row.content_text,
        message_id: `scheduled-${row.id}-${Date.now()}`,
        status: 'sent',
      })

      await admin.from('conversations').update({
        last_message_text: row.content_text,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.conversation_id)

      // Recurring → arm the next occurrence as a fresh pending row on
      // the SAME record (simpler than row-cloning; history is in messages)
      if (row.recurrence) {
        await admin.from('scheduled_messages').update({
          status: 'pending',
          send_at: nextOccurrence(new Date(row.send_at), row.recurrence).toISOString(),
          sent_at: null,
        }).eq('id', row.id)
      }

      processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[scheduled/cron] send failed:', row.id, message)
      await admin.from('scheduled_messages').update({
        status: 'failed',
        last_error: message,
      }).eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({ processed, failed })
}

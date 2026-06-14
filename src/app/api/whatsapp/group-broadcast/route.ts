/**
 * POST /api/whatsapp/group-broadcast
 *
 * Sends one text message to many group conversations at once
 * (Periskope-style bulk group messaging).
 *
 * Body: { conversation_ids: string[], text: string }
 *
 * Sends sequentially with a small jitter delay between groups to avoid
 * tripping WhatsApp rate heuristics. Returns per-group results.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTextMessage } from '@/lib/whatsapp/baileys-api'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = checkRateLimit(`group-broadcast:${user.id}`, RATE_LIMITS.broadcast)
  if (!limit.success) return rateLimitResponse(limit)

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 403 })
  }

  const body = await request.json()
  const { conversation_ids, text } = body as {
    conversation_ids: string[]
    text: string
  }

  if (!Array.isArray(conversation_ids) || conversation_ids.length === 0 || !text?.trim()) {
    return NextResponse.json(
      { error: 'conversation_ids[] and text are required' },
      { status: 400 },
    )
  }
  if (conversation_ids.length > 50) {
    return NextResponse.json(
      { error: 'Max 50 groups per broadcast' },
      { status: 400 },
    )
  }

  // All account numbers (broadcast routes each group via its own number)
  const { data: cfgRows } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, status')
    .eq('account_id', accountId)
  const cfgList = (cfgRows ?? []) as Array<{ phone_number_id: string; status: string }>
  if (!cfgList.length) {
    return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })
  }
  const fallbackPhoneId =
    (cfgList.find((c) => c.status === 'connected') ?? cfgList[0]).phone_number_id

  // Only group conversations belonging to this account
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, group_jid, is_group, phone_number_id')
    .eq('account_id', accountId)
    .eq('is_group', true)
    .in('id', conversation_ids)

  if (!convs?.length) {
    return NextResponse.json({ error: 'No matching group conversations' }, { status: 404 })
  }

  const results: { conversation_id: string; ok: boolean; error?: string }[] = []

  for (const conv of convs) {
    try {
      if (!conv.group_jid) throw new Error('missing group_jid')

      const sendFrom = conv.phone_number_id && cfgList.some((c) => c.phone_number_id === conv.phone_number_id)
        ? conv.phone_number_id
        : fallbackPhoneId

      await sendTextMessage({
        phoneNumberId: sendFrom,
        accessToken: '',
        to: conv.group_jid,
        text: text.trim(),
      })

      await supabase.from('messages').insert({
        conversation_id: conv.id,
        sender_type: 'agent',
        sender_id: user.id,
        content_type: 'text',
        content_text: text.trim(),
        message_id: `gbcast-${conv.id}-${Date.now()}`,
        status: 'sent',
      })

      await supabase.from('conversations').update({
        last_message_text: text.trim(),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', conv.id)

      results.push({ conversation_id: conv.id, ok: true })
    } catch (err) {
      results.push({
        conversation_id: conv.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 1.5–3.5s jitter between group sends
    await sleep(1500 + Math.random() * 2000)
  }

  const sent = results.filter((r) => r.ok).length
  return NextResponse.json({ sent, failed: results.length - sent, results })
}

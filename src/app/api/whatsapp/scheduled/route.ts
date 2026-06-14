/**
 * Scheduled messages CRUD.
 *
 * POST   — create a scheduled message for a conversation
 * GET    — list pending scheduled messages (optionally ?conversation_id=)
 * DELETE — cancel one (?id=)
 *
 * Sending happens in /api/whatsapp/scheduled/cron which drains due rows.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
  const { conversation_id, content_text, send_at, recurrence } = body

  if (!conversation_id || !content_text || !send_at) {
    return NextResponse.json(
      { error: 'conversation_id, content_text and send_at are required' },
      { status: 400 },
    )
  }

  const sendAtDate = new Date(send_at)
  if (isNaN(sendAtDate.getTime()) || sendAtDate.getTime() < Date.now()) {
    return NextResponse.json(
      { error: 'send_at must be a valid future timestamp' },
      { status: 400 },
    )
  }

  if (recurrence && !['daily', 'weekly', 'monthly'].includes(recurrence)) {
    return NextResponse.json(
      { error: 'recurrence must be daily, weekly or monthly' },
      { status: 400 },
    )
  }

  // Conversation must belong to this account
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversation_id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('scheduled_messages')
    .insert({
      account_id: accountId,
      user_id: user.id,
      conversation_id,
      content_text,
      send_at: sendAtDate.toISOString(),
      recurrence: recurrence || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ scheduled: data })
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const conversationId = url.searchParams.get('conversation_id')

  let query = supabase
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .order('send_at', { ascending: true })

  if (conversationId) query = query.eq('conversation_id', conversationId)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ scheduled: data ?? [] })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

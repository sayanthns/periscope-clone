/**
 * POST /api/whatsapp/groups/sync
 *
 * Receives `groups.upsert` events from baileys-service.
 * Auth: Authorization: Bearer {BAILEYS_API_SECRET}
 *
 * Body:
 * {
 *   phoneId: string,
 *   groups: Array<{ id: string; subject: string; desc?: string; participants?: unknown[] }>
 * }
 *
 * Upserts rows in `whatsapp_groups` so the inbox can show group names.
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

interface BaileysGroup {
  id: string          // e.g. "1234567890-1234567890@g.us"
  subject?: string
  desc?: string
  participants?: unknown[]
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.BAILEYS_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { phoneId: string; groups: BaileysGroup[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { phoneId, groups } = body

  if (!phoneId || !Array.isArray(groups)) {
    return NextResponse.json({ error: 'phoneId and groups[] required' }, { status: 400 })
  }

  // Look up account_id + user_id for this phoneId
  const { data: configRows, error: configErr } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id, user_id')
    .eq('phone_number_id', phoneId)

  if (configErr || !configRows?.length) {
    console.error('[groups/sync] No config for phoneId:', phoneId)
    return NextResponse.json({ error: 'Unknown phoneId' }, { status: 404 })
  }

  const accountId: string = configRows[0].account_id
  const userId: string = configRows[0].user_id

  const now = new Date().toISOString()
  let synced = 0
  let failed = 0

  for (const group of groups) {
    if (!group.id || !group.id.endsWith('@g.us')) continue

    const groupName = (group.subject ?? group.id) as string

    // 1. Upsert whatsapp_groups cache
    const { error: cacheErr } = await supabaseAdmin()
      .from('whatsapp_groups')
      .upsert({
        account_id: accountId,
        phone_id: phoneId,
        group_jid: group.id,
        name: groupName,
        description: group.desc ?? null,
        participant_count: Array.isArray(group.participants) ? group.participants.length : null,
        synced_at: now,
      }, { onConflict: 'account_id,group_jid' })

    if (cacheErr) {
      console.error('[groups/sync] whatsapp_groups upsert error:', group.id, cacheErr)
      failed++
      continue
    }

    // 2. Find or create contact for this group
    const { data: existingContact } = await supabaseAdmin()
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('group_jid', group.id)
      .maybeSingle()

    let contactId: string

    if (existingContact) {
      contactId = existingContact.id
      await supabaseAdmin().from('contacts').update({ name: groupName }).eq('id', contactId)
    } else {
      const { data: newContact, error: contactErr } = await supabaseAdmin()
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone: group.id,
          name: groupName,
          is_group: true,
          group_jid: group.id,
          opted_in: true,
        })
        .select('id')
        .single()

      if (contactErr || !newContact) {
        console.error('[groups/sync] contact create error:', group.id, contactErr)
        failed++
        continue
      }
      contactId = newContact.id
    }

    // 3. Find or create conversation — makes the group visible in inbox
    const { data: existingConv } = await supabaseAdmin()
      .from('conversations')
      .select('id, group_name')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()

    if (existingConv) {
      if (existingConv.group_name !== groupName) {
        await supabaseAdmin().from('conversations').update({ group_name: groupName }).eq('id', existingConv.id)
      }
    } else {
      const { error: convErr } = await supabaseAdmin()
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: userId,
          contact_id: contactId,
          is_group: true,
          group_jid: group.id,
          group_name: groupName,
          status: 'open',
        })

      if (convErr) {
        console.error('[groups/sync] conversation create error:', group.id, convErr)
        failed++
        continue
      }
    }

    synced++
  }

  console.log(`[groups/sync] phoneId=${phoneId} synced=${synced} failed=${failed}`)
  return NextResponse.json({ ok: true, synced, failed })
}

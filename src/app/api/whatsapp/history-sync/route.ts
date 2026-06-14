/**
 * POST /api/whatsapp/history-sync
 *
 * Bulk-imports past messages streamed by WhatsApp after pairing
 * (messaging-history.set). Pure import: no automations, no webhooks,
 * no auto-replies, no unread bumps — just rows.
 *
 * Auth: Bearer BAILEYS_API_SECRET.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMsg = any

function jidToPhone(jid: string): string {
  return `+${jid.split('@')[0].replace(/\D/g, '')}`
}

function parseContent(m: AnyMsg): { type: string; text: string | null } | null {
  if (!m) return null
  if (m.conversation) return { type: 'text', text: m.conversation }
  if (m.extendedTextMessage?.text) return { type: 'text', text: m.extendedTextMessage.text }
  if (m.imageMessage) return { type: 'image', text: m.imageMessage.caption ?? null }
  if (m.videoMessage) return { type: 'video', text: m.videoMessage.caption ?? null }
  if (m.audioMessage) return { type: 'audio', text: null }
  if (m.documentMessage) return { type: 'document', text: m.documentMessage.fileName ?? null }
  if (m.stickerMessage) return { type: 'image', text: '[sticker]' }
  if (m.locationMessage) return { type: 'location', text: m.locationMessage.name ?? 'Location' }
  // protocol / reactions / system junk — skip entirely
  return null
}

function tsOf(m: AnyMsg): number {
  const t = m.messageTimestamp
  if (!t) return 0
  if (typeof t === 'object' && 'toNumber' in t) return t.toNumber()
  const n = Number(t)
  // proto Long sometimes serialises as { low, high }
  if (Number.isNaN(n) && typeof t === 'object' && 'low' in t) return Number(t.low)
  return n
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.BAILEYS_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { phoneId, messages } = await request.json() as { phoneId: string; messages: AnyMsg[] }
  if (!phoneId || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'phoneId and messages[] required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('account_id, user_id')
    .eq('phone_number_id', phoneId)
    .maybeSingle()
  if (!config) return NextResponse.json({ error: 'Unknown phoneId' }, { status: 404 })
  const { account_id: accountId, user_id: userId } = config

  // Caches to avoid re-querying per message in the batch
  const contactCache = new Map<string, string>()  // phone/groupJid → contact_id
  const convCache = new Map<string, string>()     // contact_id → conversation_id

  let imported = 0
  let skipped = 0

  for (const msg of messages) {
    try {
      const rawJid: string | undefined = msg.key?.remoteJid
      const remoteJid: string | undefined = rawJid?.endsWith('@lid')
        ? (msg.key?.remoteJidAlt ?? rawJid)
        : rawJid
      const waId: string | undefined = msg.key?.id
      if (!remoteJid || !waId || remoteJid === 'status@broadcast') { skipped++; continue }

      const parsed = parseContent(msg.message)
      if (!parsed) { skipped++; continue }

      const isGroup = remoteJid.endsWith('@g.us')
      if (remoteJid.endsWith('@lid')) { skipped++; continue }

      // ── contact ──
      const contactKey = isGroup ? remoteJid : jidToPhone(remoteJid)
      let contactId = contactCache.get(contactKey)
      if (!contactId) {
        const matcher = isGroup
          ? admin.from('contacts').select('id').eq('account_id', accountId).eq('group_jid', remoteJid).maybeSingle()
          : admin.from('contacts').select('id').eq('account_id', accountId).like('phone', `%${contactKey.replace(/\D/g, '').slice(-8)}`).limit(1).maybeSingle()
        const { data: existing } = await matcher
        if (existing) {
          contactId = existing.id as string
        } else {
          const { data: created, error } = await admin.from('contacts').insert({
            account_id: accountId,
            user_id: userId,
            phone: contactKey,
            name: msg.pushName && !msg.key?.fromMe ? msg.pushName : contactKey,
            is_group: isGroup,
            group_jid: isGroup ? remoteJid : null,
            opted_in: true,
          }).select('id').single()
          if (error || !created) { skipped++; continue }
          contactId = created.id as string
        }
        contactCache.set(contactKey, contactId)
      }

      // ── conversation ──
      let convId = convCache.get(contactId)
      if (!convId) {
        const { data: existing } = await admin
          .from('conversations').select('id')
          .eq('account_id', accountId).eq('contact_id', contactId).maybeSingle()
        if (existing) {
          convId = existing.id as string
        } else {
          const { data: created, error } = await admin.from('conversations').insert({
            account_id: accountId,
            user_id: userId,
            contact_id: contactId,
            is_group: isGroup,
            group_jid: isGroup ? remoteJid : null,
            status: 'open',
            phone_number_id: phoneId,
          }).select('id').single()
          if (error || !created) { skipped++; continue }
          convId = created.id as string
        }
        convCache.set(contactId, convId)
      }

      // ── dedup ──
      const { count } = await admin
        .from('messages').select('id', { count: 'exact', head: true })
        .eq('conversation_id', convId).eq('message_id', waId)
      if ((count ?? 0) > 0) { skipped++; continue }

      const fromMe = msg.key?.fromMe === true
      const ts = tsOf(msg)
      const senderPn = msg.key?.participantAlt ?? msg.key?.participantPn ?? msg.key?.participant

      await admin.from('messages').insert({
        conversation_id: convId,
        sender_type: fromMe ? 'agent' : 'customer',
        content_type: parsed.type,
        content_text: parsed.text,
        message_id: waId,
        sender_name: !fromMe && isGroup
          ? (msg.pushName || (senderPn && !String(senderPn).endsWith('@lid') ? jidToPhone(senderPn) : null))
          : null,
        status: 'delivered',
        created_at: ts ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
      })
      imported++
    } catch {
      skipped++
    }
  }

  // Refresh last_message on touched conversations from actual data
  for (const convId of new Set(convCache.values())) {
    const { data: last } = await admin
      .from('messages')
      .select('content_text, content_type, created_at, sender_name')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (last) {
      await admin.from('conversations').update({
        last_message_text: last.sender_name
          ? `${last.sender_name}: ${last.content_text ?? `[${last.content_type}]`}`
          : (last.content_text ?? `[${last.content_type}]`),
        last_message_at: last.created_at,
      }).eq('id', convId)
    }
  }

  console.log(`[history-sync] imported=${imported} skipped=${skipped}`)
  return NextResponse.json({ ok: true, imported, skipped })
}

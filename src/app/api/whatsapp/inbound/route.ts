/**
 * POST /api/whatsapp/inbound
 *
 * Receives messages pushed by baileys-service instead of Meta's webhook.
 * Auth: Authorization: Bearer {BAILEYS_API_SECRET}
 *
 * Body shape:
 * {
 *   phoneId: string,         // = whatsapp_config.phone_number_id
 *   message: BaileysMessage  // raw proto.IWebMessageInfo from Baileys
 * }
 *
 * Normalises the Baileys message format to the same shape the existing
 * processMessage() function expects, then runs the identical DB logic:
 * contact/conversation upsert, message insert, automations, flows.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'

// ── Supabase admin client ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// ── Baileys message types ────────────────────────────────────────────────────
interface BaileysKey {
  remoteJid?: string | null
  remoteJidAlt?: string | null    // 1:1: real phone JID when remoteJid is @lid (Baileys 7.x)
  fromMe?: boolean | null
  id?: string | null
  participant?: string | null     // group sender (may be a privacy @lid JID)
  participantPn?: string | null   // group sender's phone JID (Baileys 6.7.x name)
  participantAlt?: string | null  // group sender's phone JID (Baileys 7.x name)
}

interface BaileysMessage {
  key: BaileysKey
  message?: {
    conversation?: string
    extendedTextMessage?: { text?: string; contextInfo?: { stanzaId?: string } }
    imageMessage?: { mimetype?: string; caption?: string; url?: string }
    videoMessage?: { mimetype?: string; caption?: string; url?: string }
    documentMessage?: { mimetype?: string; caption?: string; fileName?: string; url?: string }
    audioMessage?: { mimetype?: string; url?: string }
    stickerMessage?: { mimetype?: string; url?: string }
    locationMessage?: { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    reactionMessage?: { key?: BaileysKey; text?: string }
    [key: string]: unknown
  }
  messageTimestamp?: number | { toNumber(): number } | null
  pushName?: string | null
  // Status updates from Baileys
  update?: { status?: number }
  // Attached by baileys-service before forwarding:
  _mediaUrl?: string | null     // decrypted media re-hosted in Supabase Storage
  _avatarUrl?: string | null    // sender's profile picture (cached)
  _senderPhone?: string | null  // group sender's resolved phone (+digits), LID-mapped
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Baileys JID to E.164-style phone number. */
function jidToPhone(jid: string): string {
  // "1234567890@s.whatsapp.net" → "+1234567890"
  const digits = jid.split('@')[0].replace(/\D/g, '')
  return `+${digits}`
}

/** Determine if a JID is a group. */
function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

/**
 * System/protocol payloads (history-sync notifications, key distribution,
 * ephemeral toggles, edits/revokes) have no renderable body — storing them
 * produces "[protocolMessage message]" noise in the inbox.
 */
function isRenderableMessage(m: BaileysMessage['message']): boolean {
  if (!m) return false
  const junkOnly = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'deviceSentMessage']
  const keys = Object.keys(m).filter((k) => m[k as keyof typeof m] != null)
  if (keys.length === 0) return false
  return keys.some((k) => !junkOnly.includes(k))
}

/** Extract message timestamp as unix seconds. */
function getTimestamp(ts: BaileysMessage['messageTimestamp']): number {
  if (!ts) return Math.floor(Date.now() / 1000)
  if (typeof ts === 'object' && 'toNumber' in ts) return ts.toNumber()
  return Number(ts)
}

/** Parse Baileys message content into DB-friendly fields. */
function parseBaileysContent(msg: BaileysMessage['message']): {
  contentType: string
  contentText: string | null
  mediaUrl: string | null
} {
  if (!msg) return { contentType: 'text', contentText: null, mediaUrl: null }

  if (msg.conversation) {
    return { contentType: 'text', contentText: msg.conversation, mediaUrl: null }
  }
  if (msg.extendedTextMessage?.text) {
    return { contentType: 'text', contentText: msg.extendedTextMessage.text, mediaUrl: null }
  }
  if (msg.imageMessage) {
    return {
      contentType: 'image',
      contentText: msg.imageMessage.caption || null,
      // Baileys CDN URLs expire. Store as-is; add proxy in Phase 5.
      mediaUrl: msg.imageMessage.url || null,
    }
  }
  if (msg.videoMessage) {
    return {
      contentType: 'video',
      contentText: msg.videoMessage.caption || null,
      mediaUrl: msg.videoMessage.url || null,
    }
  }
  if (msg.documentMessage) {
    return {
      contentType: 'document',
      contentText: msg.documentMessage.caption || msg.documentMessage.fileName || null,
      mediaUrl: msg.documentMessage.url || null,
    }
  }
  if (msg.audioMessage) {
    return { contentType: 'audio', contentText: null, mediaUrl: msg.audioMessage.url || null }
  }
  if (msg.stickerMessage) {
    return { contentType: 'image', contentText: null, mediaUrl: msg.stickerMessage.url || null }
  }
  if (msg.locationMessage) {
    const loc = msg.locationMessage
    const text = [loc.name, loc.address, `${loc.degreesLatitude},${loc.degreesLongitude}`]
      .filter(Boolean).join(' - ')
    return { contentType: 'location', contentText: text, mediaUrl: null }
  }
  if (msg.reactionMessage) {
    return { contentType: 'text', contentText: msg.reactionMessage.text || null, mediaUrl: null }
  }

  // ── Rich types Baileys exposes that don't map to a media slot ──────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any

  // View-once wrappers — unwrap and re-parse the inner content
  const viewOnce = m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message ?? m.viewOnceMessageV2Extension?.message
  if (viewOnce) return parseBaileysContent(viewOnce)

  // Contact card (vCard) → "Name (+number)"
  if (m.contactMessage) {
    const name = m.contactMessage.displayName || 'Contact'
    const tel = /TEL[^:]*:([+\d\s-]+)/i.exec(m.contactMessage.vcard ?? '')?.[1]?.trim()
    return { contentType: 'text', contentText: `👤 ${name}${tel ? ` (${tel})` : ''}`, mediaUrl: null }
  }
  if (m.contactsArrayMessage) {
    const arr = m.contactsArrayMessage.contacts ?? []
    const names = arr.map((c: { displayName?: string }) => c.displayName).filter(Boolean).slice(0, 3).join(', ')
    return { contentType: 'text', contentText: `👤 ${arr.length} contacts${names ? `: ${names}` : ''}`, mediaUrl: null }
  }

  // Polls
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3
  if (poll) {
    return { contentType: 'text', contentText: `📊 Poll: ${poll.name ?? 'Untitled'}`, mediaUrl: null }
  }

  // Video note (round PTV) → treat as video
  if (m.ptvMessage) {
    return { contentType: 'video', contentText: null, mediaUrl: m.ptvMessage.url || null }
  }

  // Live location
  if (m.liveLocationMessage) {
    const ll = m.liveLocationMessage
    return { contentType: 'location', contentText: ll.caption || '📍 Live location', mediaUrl: null }
  }

  // Interactive replies (button / list taps) → the chosen label
  const interactiveText =
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText
  if (interactiveText) {
    return { contentType: 'text', contentText: interactiveText, mediaUrl: null }
  }

  // Group invite
  if (m.groupInviteMessage) {
    return { contentType: 'text', contentText: `👥 Group invite: ${m.groupInviteMessage.groupName ?? ''}`.trim(), mediaUrl: null }
  }

  // Unknown type — last resort
  const knownKey = Object.keys(msg).find(k => k.endsWith('Message'))
  return {
    contentType: 'text',
    contentText: `[${knownKey ?? 'unknown'} message]`,
    mediaUrl: null,
  }
}

// ── DB helpers (mirrors webhook/route.ts) ─────────────────────────────────────

/**
 * Find or create a contact row for a WhatsApp GROUP.
 * The "contact" for a group is the group itself — phone = group_jid,
 * name = group subject, is_group = true.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateGroupContact(accountId: string, userId: string, groupJid: string): Promise<{ contact: any; wasCreated: boolean } | null> {
  const { data: existing, error } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('group_jid', groupJid)
    .maybeSingle()

  if (error) { console.error('[inbound] group contact fetch error:', error); return null }

  if (existing) return { contact: existing, wasCreated: false }

  // Fetch group name from whatsapp_groups cache if available
  const { data: groupRow } = await supabaseAdmin()
    .from('whatsapp_groups')
    .select('name')
    .eq('account_id', accountId)
    .eq('group_jid', groupJid)
    .maybeSingle()

  const groupName = groupRow?.name ?? groupJid

  const { data: created, error: createErr } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: userId,
      phone: groupJid,   // group JID stored in phone field for consistency
      name: groupName,
      is_group: true,
      group_jid: groupJid,
      opted_in: true,    // groups don't need opt-in
    })
    .select()
    .single()

  if (createErr) { console.error('[inbound] group contact create error:', createErr); return null }
  return { contact: created, wasCreated: true }
}

/**
 * Round-robin auto-assignment. Returns the next agent's user_id when the
 * account has auto_assign_enabled, else null. Advances the cursor stored
 * in accounts.last_assigned_user_id.
 */
async function pickNextAgent(accountId: string): Promise<string | null> {
  const { data: account } = await supabaseAdmin()
    .from('accounts')
    .select('auto_assign_enabled, last_assigned_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (!account?.auto_assign_enabled) return null

  const { data: members } = await supabaseAdmin()
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .order('user_id')
  if (!members?.length) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = members.map((m: any) => m.user_id as string)
  const lastIdx = account.last_assigned_user_id
    ? ids.indexOf(account.last_assigned_user_id)
    : -1
  const next = ids[(lastIdx + 1) % ids.length]

  await supabaseAdmin()
    .from('accounts')
    .update({ last_assigned_user_id: next })
    .eq('id', accountId)

  return next
}

/**
 * Find or create a conversation for a group.
 * Stores is_group, group_jid, group_name for UI display.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateGroupConversation(accountId: string, userId: string, contactId: string, groupJid: string, groupName: string, phoneId?: string): Promise<any | null> {
  const { data: existing, error } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (!error && existing) {
    // Update group_name if it changed
    if (existing.group_name !== groupName) {
      await supabaseAdmin().from('conversations').update({ group_name: groupName }).eq('id', existing.id)
      existing.group_name = groupName
    }
    // Multi-number: backfill the owning number if missing
    if (phoneId && !existing.phone_number_id) {
      await supabaseAdmin().from('conversations')
        .update({ phone_number_id: phoneId }).eq('id', existing.id)
      existing.phone_number_id = phoneId
    }
    return existing
  }

  const assignee = await pickNextAgent(accountId)
  const { data: created, error: createErr } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      is_group: true,
      group_jid: groupJid,
      group_name: groupName,
      assigned_agent_id: assignee,
      phone_number_id: phoneId ?? null,
    })
    .select()
    .single()

  if (createErr) { console.error('[inbound] group conversation create error:', createErr); return null }
  return created
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateContact(accountId: string, userId: string, phone: string, name: string): Promise<{ contact: any; wasCreated: boolean } | null> {
  const normalizedSender = phone.replace(/\D/g, '')
  const suffix = normalizedSender.length >= 8 ? normalizedSender.slice(-8) : normalizedSender

  const { data: candidates, error } = await supabaseAdmin()
    .from('contacts').select('*')
    .eq('account_id', accountId).like('phone', `%${suffix}`)

  if (error) { console.error('[inbound] contacts fetch error:', error); return null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = candidates?.find((c: any) => phonesMatch(c.phone, phone))

  if (existing) {
    if (name && name !== existing.name) {
      await supabaseAdmin().from('contacts')
        .update({ name, updated_at: new Date().toISOString() }).eq('id', existing.id)
    }
    return { contact: existing, wasCreated: false }
  }

  const { data: created, error: createErr } = await supabaseAdmin()
    .from('contacts').insert({
      account_id: accountId,
      user_id: userId,
      phone,
      name: name || phone,
      // Messaged us first = explicit consent
      opted_in: true,
      opted_in_at: new Date().toISOString(),
    })
    .select().single()

  if (createErr) { console.error('[inbound] contact create error:', createErr); return null }
  return { contact: created, wasCreated: true }
}

// STOP keyword patterns (multilingual) — ISO 639 most common
const STOP_PATTERNS = /^\s*(stop|unsubscribe|optout|opt.out|remove|cancel|quit|end|نه|إلغاء|توقف|بند|रुको)\s*$/i

async function handleOptOut(contactId: string): Promise<void> {
  await supabaseAdmin().from('contacts').update({
    opted_out_at: new Date().toISOString(),
    opted_in: false,
    updated_at: new Date().toISOString(),
  }).eq('id', contactId)
  console.log(`[inbound] Contact ${contactId} opted out`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateConversation(accountId: string, userId: string, contactId: string, phoneId?: string): Promise<any | null> {
  const { data: existing, error } = await supabaseAdmin()
    .from('conversations').select('*')
    .eq('account_id', accountId).eq('contact_id', contactId).single()

  if (!error && existing) {
    // Multi-number: backfill the owning number if this row predates it
    if (phoneId && !existing.phone_number_id) {
      await supabaseAdmin().from('conversations')
        .update({ phone_number_id: phoneId }).eq('id', existing.id)
      existing.phone_number_id = phoneId
    }
    return existing
  }

  const assignee = await pickNextAgent(accountId)
  const { data: created, error: createErr } = await supabaseAdmin()
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId, assigned_agent_id: assignee, phone_number_id: phoneId ?? null })
    .select().single()

  if (createErr) { console.error('[inbound] conversation create error:', createErr); return null }
  return created
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients').select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId).eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false }).limit(1)

    if (error || !recs?.length) return
    await supabaseAdmin().from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', recs[0].id)
  } catch (err) {
    console.error('[inbound] flagBroadcastReply error:', err)
  }
}

async function handleReactionMessage(
  reactionKey: BaileysKey | undefined,
  reactionEmoji: string | undefined,
  conversationId: string,
  contactId: string
) {
  if (!reactionKey?.id) return

  const { data: target } = await supabaseAdmin()
    .from('messages').select('id').eq('message_id', reactionKey.id)
    .eq('conversation_id', conversationId).maybeSingle()

  if (!target) return

  if (!reactionEmoji) {
    await supabaseAdmin().from('message_reactions').delete()
      .eq('message_id', target.id).eq('actor_type', 'customer').eq('actor_id', contactId)
    return
  }

  await supabaseAdmin().from('message_reactions').upsert({
    message_id: target.id, conversation_id: conversationId,
    actor_type: 'customer', actor_id: contactId, emoji: reactionEmoji,
  }, { onConflict: 'message_id,actor_type,actor_id' })
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Auth check
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.BAILEYS_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { phoneId: string; message: BaileysMessage }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { phoneId, message } = body

  if (!phoneId || !message?.key) {
    return NextResponse.json({ error: 'phoneId and message.key required' }, { status: 400 })
  }

  // Process async so we ack baileys-service immediately
  processInbound(phoneId, message).catch((err) =>
    console.error('[inbound] processInbound error:', err)
  )

  return NextResponse.json({ status: 'received' })
}

/**
 * Handle a message we sent from the phone directly (fromMe=true).
 * The send API already tracks messages sent from the inbox — those arrive
 * here too as an echo from Baileys. Dedup by message_id so we don't double-
 * insert. Messages sent from the phone (not via inbox) have no DB row yet.
 */
async function processFromMeInbound(phoneId: string, remoteJid: string, message: BaileysMessage) {
  if (!isRenderableMessage(message.message)) return
  const { key, messageTimestamp } = message

  const { data: configRows, error: configErr } = await supabaseAdmin()
    .from('whatsapp_config').select('account_id, user_id').eq('phone_number_id', phoneId)
  if (configErr || !configRows?.length || configRows.length > 1) return
  const { account_id: accountId, user_id: userId } = configRows[0]

  const recipientPhone = normalizePhone(jidToPhone(remoteJid))
  const contactOutcome = await findOrCreateContact(accountId, userId, recipientPhone, recipientPhone)
  if (!contactOutcome) return

  const conv = await findOrCreateConversation(accountId, userId, contactOutcome.contact.id, phoneId)
  if (!conv) return

  const messageId = key.id ?? `baileys-fromme-${Date.now()}`

  // Skip if already stored by the send API
  const { count: existing } = await supabaseAdmin()
    .from('messages').select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id).eq('message_id', messageId)
  if ((existing ?? 0) > 0) return

  const { contentType, contentText } = parseBaileysContent(message.message)
  const ts = getTimestamp(messageTimestamp)

  await supabaseAdmin().from('messages').insert({
    conversation_id: conv.id,
    sender_type: 'agent',
    content_type: contentType,
    content_text: contentText,
    message_id: messageId,
    status: 'sent',
    created_at: new Date(ts * 1000).toISOString(),
  })

  await supabaseAdmin().from('conversations').update({
    last_message_text: contentText || `[${contentType}]`,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', conv.id)

  console.log(`[inbound/fromMe] ✓ 1:1 echo stored for ${remoteJid} conv ${conv.id}`)
}

/**
 * Handle a group message we sent from the phone directly (fromMe=true in a group).
 */
async function processFromMeGroupInbound(phoneId: string, groupJid: string, message: BaileysMessage) {
  if (!isRenderableMessage(message.message)) return
  const { key, messageTimestamp } = message

  const { data: configRows, error: configErr } = await supabaseAdmin()
    .from('whatsapp_config').select('account_id, user_id').eq('phone_number_id', phoneId)
  if (configErr || !configRows?.length || configRows.length > 1) return
  const { account_id: accountId, user_id: userId } = configRows[0]

  const groupContactOutcome = await findOrCreateGroupContact(accountId, userId, groupJid)
  if (!groupContactOutcome) return

  const { data: groupRow } = await supabaseAdmin()
    .from('whatsapp_groups').select('name')
    .eq('account_id', accountId).eq('group_jid', groupJid).maybeSingle()
  const groupName = groupRow?.name ?? groupJid

  const conv = await findOrCreateGroupConversation(accountId, userId, groupContactOutcome.contact.id, groupJid, groupName, phoneId)
  if (!conv) return

  const messageId = key.id ?? `baileys-fromme-${Date.now()}`

  // Skip if already stored by the send API
  const { count: existing } = await supabaseAdmin()
    .from('messages').select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id).eq('message_id', messageId)
  if ((existing ?? 0) > 0) return

  const { contentType, contentText } = parseBaileysContent(message.message)
  const ts = getTimestamp(messageTimestamp)

  await supabaseAdmin().from('messages').insert({
    conversation_id: conv.id,
    sender_type: 'agent',
    content_type: contentType,
    content_text: contentText,
    message_id: messageId,
    status: 'sent',
    created_at: new Date(ts * 1000).toISOString(),
  })

  await supabaseAdmin().from('conversations').update({
    last_message_text: `You: ${contentText || `[${contentType}]`}`,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', conv.id)

  console.log(`[inbound/fromMe] ✓ group echo stored for ${groupJid} conv ${conv.id}`)
}

async function processInbound(phoneId: string, message: BaileysMessage) {
  const { key, messageTimestamp, pushName } = message

  // Messages sent by us from the phone (not the inbox send API) need to be
  // stored and surfaced in the thread. The send API stores them directly, so
  // processFromMeInbound deduplicates by message_id.
  if (key.fromMe) {
    // 1:1 lid chats: the real phone JID lives in remoteJidAlt (Baileys 7.x)
    const remoteJid = key.remoteJid?.endsWith('@lid')
      ? (key.remoteJidAlt ?? key.remoteJid)
      : key.remoteJid
    if (remoteJid && !remoteJid.endsWith('@lid')) {
      await processFromMeInbound(phoneId, remoteJid, message)
    }
    return
  }

  // 1:1 lid chats: prefer the real phone JID from remoteJidAlt (Baileys 7.x)
  const remoteJid = key.remoteJid?.endsWith('@lid')
    ? (key.remoteJidAlt ?? key.remoteJid)
    : key.remoteJid
  if (!remoteJid) return
  // Unresolvable lid 1:1 — can't map to a phone number, skip rather than
  // creating a junk contact with lid digits as the phone
  if (remoteJid.endsWith('@lid')) return

  // ── Group message path ────────────────────────────────────────────────────
  if (isGroupJid(remoteJid)) {
    await processGroupInbound(phoneId, remoteJid, message)
    return
  }

  // Look up the whatsapp_config row for this phoneId
  const { data: configRows, error: configErr } = await supabaseAdmin()
    .from('whatsapp_config').select('*').eq('phone_number_id', phoneId)

  if (configErr || !configRows?.length) {
    console.error('[inbound] No whatsapp_config for phoneId:', phoneId)
    return
  }
  if (configRows.length > 1) {
    console.error('[inbound] Multiple configs for phoneId:', phoneId, '— dropping message')
    return
  }
  const config = configRows[0]
  const { account_id: accountId, user_id: userId } = config

  // Normalize sender phone
  const senderPhone = normalizePhone(jidToPhone(remoteJid))
  const senderName = pushName || senderPhone

  // Handle reactions inline
  if (message.message?.reactionMessage) {
    const reaction = message.message.reactionMessage
    // Need conversation ID for reaction — find contact first
    const contactOutcome = await findOrCreateContact(accountId, userId, senderPhone, senderName)
    if (!contactOutcome) return
    const conv = await findOrCreateConversation(accountId, userId, contactOutcome.contact.id, phoneId)
    if (!conv) return
    await handleReactionMessage(reaction.key, reaction.text || '', conv.id, contactOutcome.contact.id)
    return
  }

  // Skip if no real message content (e.g. protocol/system messages)
  if (!isRenderableMessage(message.message)) return

  const contactOutcome = await findOrCreateContact(accountId, userId, senderPhone, senderName)
  if (!contactOutcome) return

  // Auto opt-in: existing contact who messages us = gives consent
  if (!contactOutcome.wasCreated && !contactOutcome.contact.opted_in) {
    await supabaseAdmin().from('contacts').update({
      opted_in: true,
      opted_in_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', contactOutcome.contact.id)
    contactOutcome.contact.opted_in = true
  }

  // Avatar sync — baileys-service attaches the sender's profile picture
  if (message._avatarUrl && message._avatarUrl !== contactOutcome.contact.avatar_url) {
    await supabaseAdmin().from('contacts')
      .update({ avatar_url: message._avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', contactOutcome.contact.id)
  }

  const conv = await findOrCreateConversation(accountId, userId, contactOutcome.contact.id, phoneId)
  if (!conv) return

  const parsed = parseBaileysContent(message.message)
  const contentType = parsed.contentType
  const contentText = parsed.contentText
  // Prefer the decrypted re-hosted URL from baileys-service over the
  // raw (encrypted, unusable) WhatsApp CDN URL.
  const mediaUrl = message._mediaUrl ?? parsed.mediaUrl

  // ── STOP / opt-out handler ────────────────────────────────────────────────
  if (contentType === 'text' && contentText && STOP_PATTERNS.test(contentText)) {
    await handleOptOut(contactOutcome.contact.id)
    // Insert the opt-out message so agent sees it in thread
    const ts2 = getTimestamp(messageTimestamp)
    await supabaseAdmin().from('messages').insert({
      conversation_id: conv.id,
      sender_type: 'customer',
      content_type: 'text',
      content_text: contentText,
      message_id: key.id ?? `baileys-${Date.now()}`,
      status: 'delivered',
      created_at: new Date(ts2 * 1000).toISOString(),
    }).then(() => {})
    // Don't fire automations — this is an opt-out, not a workflow trigger
    return
  }
  const ts = getTimestamp(messageTimestamp)
  const messageId = key.id ?? `baileys-${Date.now()}`

  // Check first inbound BEFORE insert
  const { count: priorCount } = await supabaseAdmin()
    .from('messages').select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id).eq('sender_type', 'customer')
  const isFirstInbound = (priorCount ?? 0) === 0

  const { error: msgErr } = await supabaseAdmin().from('messages').insert({
    conversation_id: conv.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: messageId,
    status: 'delivered',
    created_at: new Date(ts * 1000).toISOString(),
  })

  if (msgErr) {
    console.error('[inbound] message insert error:', msgErr)
    return
  }

  await supabaseAdmin().from('conversations').update({
    last_message_text: contentText || `[${contentType}]`,
    last_message_at: new Date().toISOString(),
    unread_count: (conv.unread_count || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('id', conv.id)

  // Webhooks: message.received (1:1)
  void dispatchWebhooks(accountId, 'message.received', {
    conversation_id: conv.id,
    contact_phone: senderPhone,
    contact_name: senderName,
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: messageId,
  })

  await flagBroadcastReplyIfAny(accountId, contactOutcome.contact.id)

  // Flows + automations (identical to webhook/route.ts)
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId,
    contactId: contactOutcome.contact.id,
    conversationId: conv.id,
    message: {
      kind: 'text',
      text: contentText ?? '',
      meta_message_id: messageId,
    },
    isFirstInboundMessage: isFirstInbound,
  })

  const triggers: ('new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match')[] = []
  if (!flowResult.consumed) triggers.push('new_message_received', 'keyword_match')
  if (contactOutcome.wasCreated) triggers.unshift('new_contact_created')
  if (isFirstInbound) triggers.unshift('first_inbound_message')

  for (const triggerType of triggers) {
    runAutomationsForTrigger({
      accountId, triggerType,
      contactId: contactOutcome.contact.id,
      context: { message_text: contentText ?? '', conversation_id: conv.id },
    }).catch((err) => console.error('[inbound] automation dispatch error:', err))
  }

  console.log(`[inbound] ✓ ${senderPhone} → conv ${conv.id} (${contentType})`)
}

/**
 * Handle a message from a WhatsApp group (@g.us JID).
 * - remoteJid = the group's JID
 * - key.participant = the actual sender's JID within the group
 * Group threads are stored as conversations where contact.is_group = true.
 * sender_name in each message row identifies the individual participant.
 */
async function processGroupInbound(phoneId: string, groupJid: string, message: BaileysMessage) {
  const { key, messageTimestamp, pushName } = message

  // Our own group messages from phone → store with dedup
  if (key.fromMe) {
    await processFromMeGroupInbound(phoneId, groupJid, message)
    return
  }
  if (!isRenderableMessage(message.message)) return

  // Look up whatsapp_config
  const { data: configRows, error: configErr } = await supabaseAdmin()
    .from('whatsapp_config').select('*').eq('phone_number_id', phoneId)

  if (configErr || !configRows?.length) {
    console.error('[inbound/group] No whatsapp_config for phoneId:', phoneId)
    return
  }
  if (configRows.length > 1) return
  const config = configRows[0]
  const { account_id: accountId, user_id: userId } = config

  // Determine sender display name.
  // WhatsApp privacy LIDs: key.participant may be "…@lid" (opaque), with the
  // real phone in key.participantPn. Prefer the phone JID, then resolve
  // against the contacts table for a saved name, then pushName, then phone.
  // baileys-service resolves the sender LID → phone (native USync) and
  // attaches it as _senderPhone (already in "+digits" form).
  const resolvedSenderPhone = message._senderPhone ?? null
  const participantPhone = key.participantAlt ?? key.participantPn ?? null
  const participantJid = participantPhone ?? key.participant ?? ''
  const isLid = !!key.participant && key.participant.endsWith('@lid') && !participantPhone
  const senderPhoneStr = resolvedSenderPhone
    ?? (participantJid && !isLid ? jidToPhone(participantJid) : '')

  let senderName = pushName || senderPhoneStr || 'Member'
  if (senderPhoneStr) {
    // Saved contact name beats pushName — agents recognise their own CRM names
    const suffix = senderPhoneStr.replace(/\D/g, '').slice(-8)
    const { data: known } = await supabaseAdmin()
      .from('contacts')
      .select('name, phone')
      .eq('account_id', accountId)
      .like('phone', `%${suffix}`)
      .limit(1)
      .maybeSingle()
    if (known?.name && known.name !== known.phone) senderName = known.name
  }

  // Find/create group contact + conversation
  const groupContactOutcome = await findOrCreateGroupContact(accountId, userId, groupJid)
  if (!groupContactOutcome) return

  // Refresh group name from cache
  const { data: groupRow } = await supabaseAdmin()
    .from('whatsapp_groups')
    .select('name')
    .eq('account_id', accountId)
    .eq('group_jid', groupJid)
    .maybeSingle()
  const groupName = groupRow?.name ?? groupJid

  const conv = await findOrCreateGroupConversation(accountId, userId, groupContactOutcome.contact.id, groupJid, groupName, phoneId)
  if (!conv) return

  const parsedGroup = parseBaileysContent(message.message)
  const contentType = parsedGroup.contentType
  const contentText = parsedGroup.contentText
  const mediaUrl = message._mediaUrl ?? parsedGroup.mediaUrl
  const ts = getTimestamp(messageTimestamp)
  const messageId = key.id ?? `baileys-${Date.now()}`

  const { error: msgErr } = await supabaseAdmin().from('messages').insert({
    conversation_id: conv.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: messageId,
    sender_name: senderName,   // who in the group sent this
    status: 'delivered',
    created_at: new Date(ts * 1000).toISOString(),
  })

  if (msgErr) {
    console.error('[inbound/group] message insert error:', msgErr)
    return
  }

  await supabaseAdmin().from('conversations').update({
    last_message_text: contentText ? `${senderName}: ${contentText}` : `[${contentType}]`,
    last_message_at: new Date().toISOString(),
    unread_count: (conv.unread_count || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('id', conv.id)

  // Per-group auto-replies: case-insensitive substring keyword match
  if (contentText) {
    void runGroupAutoReplies(accountId, groupJid, conv.id, contentText)
  }

  // Webhooks: message.received
  void dispatchWebhooks(accountId, 'message.received', {
    conversation_id: conv.id,
    group_jid: groupJid,
    group_name: groupName,
    sender_name: senderName,
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: messageId,
  })

  // No automations/flows for group messages (group is not a contact with opt-in)
  console.log(`[inbound/group] ✓ ${senderName} → group ${groupJid} → conv ${conv.id} (${contentType})`)
}

/**
 * Check enabled group_auto_replies for this group; send the first match.
 * One reply max per inbound message to avoid spam loops. Fire-and-forget.
 */
async function runGroupAutoReplies(accountId: string, groupJid: string, conversationId: string, text: string) {
  try {
    const { data: rules } = await supabaseAdmin()
      .from('group_auto_replies')
      .select('*')
      .eq('account_id', accountId)
      .eq('group_jid', groupJid)
      .eq('enabled', true)

    if (!rules?.length) return

    const lower = text.toLowerCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = rules.find((r: any) => lower.includes(String(r.keyword).toLowerCase()))
    if (!match) return

    const { data: config } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('phone_number_id')
      .eq('account_id', accountId)
      .single()
    if (!config) return

    const baileysUrl = process.env.BAILEYS_SERVICE_URL ?? 'http://localhost:3001'
    const res = await fetch(`${baileysUrl}/sessions/${config.phone_number_id}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BAILEYS_API_SECRET}`,
      },
      body: JSON.stringify({ jid: groupJid, text: match.reply_text, isAutomation: true }),
    })
    if (!res.ok) {
      console.error('[auto-reply] send failed:', res.status)
      return
    }

    await supabaseAdmin().from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: match.reply_text,
      message_id: `autoreply-${match.id}-${Date.now()}`,
      status: 'sent',
    })
    console.log(`[auto-reply] ✓ "${match.keyword}" → group ${groupJid}`)
  } catch (err) {
    console.error('[auto-reply] error:', err)
  }
}

/**
 * POST the event to every enabled webhook subscribed to it.
 * Best-effort with 5s timeout; records last_status per hook.
 */
async function dispatchWebhooks(accountId: string, event: string, payload: Record<string, unknown>) {
  try {
    const { data: hooks } = await supabaseAdmin()
      .from('webhooks')
      .select('*')
      .eq('account_id', accountId)
      .eq('enabled', true)
      .contains('events', [event])

    if (!hooks?.length) return

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload })

    await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hooks.map(async (hook: any) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (hook.secret) {
          const { createHmac } = await import('crypto')
          headers['x-webhook-signature'] = createHmac('sha256', hook.secret).update(body).digest('hex')
        }
        let status = 0
        try {
          const res = await fetch(hook.url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(5000),
          })
          status = res.status
        } catch {
          status = -1
        }
        await supabaseAdmin().from('webhooks').update({
          last_status: status,
          last_fired_at: new Date().toISOString(),
        }).eq('id', hook.id)
      })
    )
  } catch (err) {
    console.error('[webhooks] dispatch error:', err)
  }
}

/**
 * Baileys service transport layer.
 *
 * Drop-in replacement for the Meta-facing functions in meta-api.ts.
 * Same function signatures — call sites don't change.
 *
 * phoneNumberId → baileys-service phoneId (stored in whatsapp_config.phone_number_id)
 * accessToken   → ignored (baileys-service uses API_SECRET internally)
 * to            → E.164 phone number, converted to WA JID here
 */

const BAILEYS_SERVICE_URL = process.env.BAILEYS_SERVICE_URL ?? 'http://localhost:3001'
const BAILEYS_API_SECRET = process.env.BAILEYS_API_SECRET ?? ''

function phoneToJid(phone: string): string {
  // Already a WA JID (group @g.us or individual @s.whatsapp.net) — pass through
  if (phone.endsWith('@g.us') || phone.endsWith('@s.whatsapp.net')) return phone
  // E.164 → individual JID
  const digits = phone.replace(/^\+/, '').replace(/\D/g, '')
  return `${digits}@s.whatsapp.net`
}

async function baileysPost(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${BAILEYS_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BAILEYS_API_SECRET}`,
    },
    body: JSON.stringify(body),
  })
  return res
}

async function throwBaileysError(res: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) message = data.error
  } catch { /* keep fallback */ }
  throw new Error(message)
}

// ── Re-export the result type so call sites keep working ─────────────────────
export interface MetaSendResult {
  messageId: string
}

// ── Text message ─────────────────────────────────────────────────────────────

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  contextMessageId?: string
  /** Full JIDs to @mention (group messages) */
  mentions?: string[]
}

export async function sendTextMessage(args: SendTextMessageArgs): Promise<MetaSendResult> {
  const { phoneNumberId, to, text, mentions } = args
  const jid = phoneToJid(to)

  const res = await baileysPost(`/sessions/${phoneNumberId}/send`, { jid, text, mentions })
  if (!res.ok) await throwBaileysError(res, `Baileys send failed: ${res.status}`)

  // Prefer the real WA message id (revoke/read need it); fall back to local.
  try {
    const data = (await res.json()) as { messageId?: string | null }
    if (data.messageId) return { messageId: data.messageId }
  } catch { /* fall through */ }
  return { messageId: `baileys-${Date.now()}` }
}

// ── Media message ─────────────────────────────────────────────────────────────

export type MediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
  contextMessageId?: string
  /** Real mimetype from the uploaded file; falls back to kind defaults. */
  mimetype?: string
  /** Audio only: true = WhatsApp voice note (push-to-talk bubble) */
  ptt?: boolean
  /** Audio only: clip length in seconds so WhatsApp shows the duration. */
  seconds?: number
}

export async function sendMediaMessage(args: SendMediaMessageArgs): Promise<MetaSendResult> {
  const { phoneNumberId, to, kind, link, caption, mimetype, ptt, seconds } = args
  const jid = phoneToJid(to)

  const fallback =
    kind === 'image' ? 'image/jpeg'
    : kind === 'video' ? 'video/mp4'
    : kind === 'audio' ? 'audio/mp4'
    : 'application/octet-stream'

  const res = await baileysPost(`/sessions/${phoneNumberId}/send-media`, {
    jid,
    url: link,
    mimetype: mimetype || fallback,
    caption,
    ptt,
    seconds,
  })
  if (!res.ok) await throwBaileysError(res, `Baileys send-media failed: ${res.status}`)

  // Prefer the real WA message id so the fromMe echo dedups (no double-insert).
  try {
    const data = (await res.json()) as { messageId?: string | null }
    if (data.messageId) return { messageId: data.messageId }
  } catch { /* fall through */ }
  return { messageId: `baileys-${Date.now()}` }
}

// ── Template message — rendered as plain text via Baileys ─────────────────────
// Meta templates don't apply to regular WA numbers. We extract whatever
// text the caller has and send it as a regular message. Template approval,
// 24h windows, etc. don't apply to the Baileys transport.

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  params?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messageParams?: any
  contextMessageId?: string
}

export async function sendTemplateMessage(args: SendTemplateMessageArgs): Promise<MetaSendResult> {
  const { phoneNumberId, to, templateName, params, messageParams } = args
  const jid = phoneToJid(to)

  // Build a best-effort text representation of the template.
  // Full template rendering is a Phase 6 improvement.
  const bodyVars: string[] = messageParams?.body ?? params ?? []
  const bodyText = bodyVars.length > 0
    ? `[${templateName}]: ${bodyVars.join(' ')}`
    : `[${templateName}]`

  const res = await baileysPost(`/sessions/${phoneNumberId}/send`, { jid, text: bodyText })
  if (!res.ok) await throwBaileysError(res, `Baileys send (template) failed: ${res.status}`)

  return { messageId: `baileys-${Date.now()}` }
}

// ── Interactive messages — stubbed (Meta-only feature) ────────────────────────
// Baileys supports interactive messages differently. For now render as text.
// TODO Phase 5: implement native Baileys button/list messages.

export interface InteractiveButton { id: string; title: string }
export interface InteractiveListRow { id: string; title: string; description?: string }
export interface InteractiveListSection { title?: string; rows: InteractiveListRow[] }

export interface SendInteractiveButtonsArgs {
  phoneNumberId: string; accessToken: string; to: string
  bodyText: string; headerText?: string; footerText?: string
  buttons: InteractiveButton[]; contextMessageId?: string
}

export async function sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<MetaSendResult> {
  const { phoneNumberId, to, bodyText, buttons } = args
  const jid = phoneToJid(to)
  const buttonLines = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n')
  const text = `${bodyText}\n\n${buttonLines}`
  const res = await baileysPost(`/sessions/${phoneNumberId}/send`, { jid, text })
  if (!res.ok) await throwBaileysError(res, `Baileys send failed: ${res.status}`)
  return { messageId: `baileys-${Date.now()}` }
}

export interface SendInteractiveListArgs {
  phoneNumberId: string; accessToken: string; to: string
  bodyText: string; buttonLabel: string; headerText?: string; footerText?: string
  sections: InteractiveListSection[]; contextMessageId?: string
}

export async function sendInteractiveList(args: SendInteractiveListArgs): Promise<MetaSendResult> {
  const { phoneNumberId, to, bodyText, sections } = args
  const jid = phoneToJid(to)
  const rows = sections.flatMap(s => s.rows).map((r, i) => `${i + 1}. ${r.title}`).join('\n')
  const text = `${bodyText}\n\n${rows}`
  const res = await baileysPost(`/sessions/${phoneNumberId}/send`, { jid, text })
  if (!res.ok) await throwBaileysError(res, `Baileys send failed: ${res.status}`)
  return { messageId: `baileys-${Date.now()}` }
}

// ── Reaction ──────────────────────────────────────────────────────────────────

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  targetMessageId: string
  emoji: string
}

export async function sendReactionMessage(args: SendReactionMessageArgs): Promise<MetaSendResult> {
  const { phoneNumberId, to, targetMessageId, emoji } = args
  const jid = phoneToJid(to)

  const res = await baileysPost(`/sessions/${phoneNumberId}/send-reaction`, {
    jid,
    targetMessageId,
    emoji,
  })
  if (!res.ok) await throwBaileysError(res, `Baileys reaction failed: ${res.status}`)

  return { messageId: `baileys-${Date.now()}` }
}

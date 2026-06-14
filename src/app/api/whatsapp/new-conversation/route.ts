import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTextMessage } from '@/lib/whatsapp/baileys-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveConfigForConversation } from '@/lib/whatsapp/config-resolver'

/**
 * POST /api/whatsapp/new-conversation
 *
 * Creates a contact + conversation (if they don't exist) then sends the
 * first message via Baileys. Used by the "New conversation" dialog in the inbox.
 *
 * Body: { phone: string, text: string }
 *   phone — digits only, with country code (e.g. "919876543210")
 *   text  — message body
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = checkRateLimit(`new-conv:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Profile not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const phone: string = String(body.phone ?? '').replace(/\D/g, '')
    const text: string = String(body.text ?? '').trim()
    // Optional: which connected number to send from (multi-number).
    const fromNumber: string | null = body.phone_number_id ? String(body.phone_number_id) : null

    if (phone.length < 10) {
      return NextResponse.json(
        { error: 'Invalid phone number — include country code, digits only' },
        { status: 400 },
      )
    }
    if (!text) {
      return NextResponse.json({ error: 'Message text is required' }, { status: 400 })
    }

    // WhatsApp config — multi-number: send from the chosen number, else
    // prefer a connected one, else any.
    const config = await resolveConfigForConversation(supabase, accountId, fromNumber)

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Set up WhatsApp in Settings first.' },
        { status: 400 },
      )
    }

    // Find or create contact by phone within this account
    let contact: { id: string; phone: string }

    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, phone')
      .eq('phone', phone)
      .eq('account_id', accountId)
      .maybeSingle()

    if (existingContact) {
      contact = existingContact
    } else {
      const { data: newContact, error: contactErr } = await supabase
        .from('contacts')
        .insert({ phone, account_id: accountId, user_id: user.id })
        .select('id, phone')
        .single()
      if (contactErr || !newContact) {
        return NextResponse.json(
          { error: `Failed to create contact: ${contactErr?.message}` },
          { status: 500 },
        )
      }
      contact = newContact
    }

    // Upsert conversation — one per (contact, account)
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('account_id', accountId)
      .maybeSingle()

    let conversationId: string

    if (existing) {
      conversationId = existing.id
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          contact_id: contact.id,
          account_id: accountId,
          user_id: user.id,
          status: 'open',
          phone_number_id: config.phone_number_id,
        })
        .select('id')
        .single()

      if (convErr || !newConv) {
        return NextResponse.json(
          { error: `Failed to create conversation: ${convErr?.message}` },
          { status: 500 },
        )
      }
      conversationId = newConv.id
    }

    // Send via Baileys
    const accessToken = decrypt(config.access_token)
    let waMessageId = ''
    try {
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text,
      })
      waMessageId = result.messageId
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Send failed: ${msg}` }, { status: 502 })
    }

    // Persist message
    const { data: messageRecord, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: waMessageId,
        status: 'sent',
      })
      .select()
      .single()

    if (msgErr) {
      return NextResponse.json(
        { error: `Message sent but DB save failed: ${msgErr.message}` },
        { status: 500 },
      )
    }

    // Update conversation last message
    await supabase
      .from('conversations')
      .update({
        last_message_text: text,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'open',
      })
      .eq('id', conversationId)

    return NextResponse.json({
      success: true,
      conversation_id: conversationId,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (err) {
    console.error('[new-conversation] unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

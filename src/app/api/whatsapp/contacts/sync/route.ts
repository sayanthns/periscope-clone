/**
 * POST /api/whatsapp/contacts/sync
 *
 * Receives the user's saved WhatsApp address-book names from
 * baileys-service (contacts.upsert events). Updates contacts whose
 * current name is just the phone number — saved names win over
 * placeholders, but never overwrite a name an agent typed in the CRM
 * that differs from both.
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

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.BAILEYS_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { phoneId, contacts } = await request.json() as {
    phoneId: string
    contacts: Array<{ phone: string; name: string }>
  }
  if (!phoneId || !Array.isArray(contacts)) {
    return NextResponse.json({ error: 'phoneId and contacts[] required' }, { status: 400 })
  }

  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneId)
    .maybeSingle()
  if (!config) return NextResponse.json({ error: 'Unknown phoneId' }, { status: 404 })

  let updated = 0
  for (const c of contacts) {
    if (!c.phone || !c.name) continue
    const digits = c.phone.replace(/\D/g, '')
    if (digits.length < 8) continue

    // Only update rows whose name is still a phone-number placeholder
    const { data: rows } = await supabaseAdmin()
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', config.account_id)
      .like('phone', `%${digits.slice(-8)}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (rows ?? []) as any[]) {
      const nameIsPlaceholder =
        !row.name ||
        row.name === row.phone ||
        row.name.replace(/\D/g, '') === row.phone.replace(/\D/g, '')
      if (nameIsPlaceholder && row.name !== c.name) {
        await supabaseAdmin()
          .from('contacts')
          .update({ name: c.name, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        updated++
      }
    }
  }

  if (updated > 0) console.log(`[contacts/sync] updated ${updated} contact names`)
  return NextResponse.json({ ok: true, updated })
}

/**
 * API key management. Raw key (pk_…) is returned exactly once at
 * creation; only the SHA-256 hash + display prefix are stored.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHash, randomBytes } from 'crypto'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) {
    return { error: NextResponse.json({ error: 'No account' }, { status: 403 }) }
  }
  if (!['owner', 'admin'].includes(profile.account_role ?? '')) {
    return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  }
  return { supabase, userId: user.id, accountId: profile.account_id as string }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const { data, error } = await ctx.supabase
    .from('api_keys')
    .select('id, name, key_prefix, created_at, last_used_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const { name } = await request.json().catch(() => ({ name: null }))
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }

  const raw = `pk_${randomBytes(24).toString('hex')}`
  const hash = createHash('sha256').update(raw).digest('hex')

  const { data, error } = await ctx.supabase
    .from('api_keys')
    .insert({
      account_id: ctx.accountId,
      name: name.trim(),
      key_hash: hash,
      key_prefix: raw.slice(0, 11),
      created_by: ctx.userId,
    })
    .select('id, name, key_prefix, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Raw key returned ONCE — UI must show + tell user to copy now
  return NextResponse.json({ key: data, raw })
}

export async function DELETE(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await ctx.supabase.from('api_keys').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * Multi-number config resolution.
 *
 * An account can have several whatsapp_config rows (one per connected
 * number). Given a conversation's phone_number_id, return the config for
 * THAT number. When the conversation predates multi-number (null
 * phone_number_id), fall back to a connected number, then any number.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any

export interface ResolvedConfig {
  phone_number_id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export async function resolveConfigForConversation(
  supabase: SupabaseLike,
  accountId: string,
  phoneNumberId: string | null | undefined,
  columns = '*',
): Promise<ResolvedConfig | null> {
  if (phoneNumberId) {
    const { data } = await supabase
      .from('whatsapp_config')
      .select(columns)
      .eq('account_id', accountId)
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle()
    if (data) return data as ResolvedConfig
  }

  const { data: rows } = await supabase
    .from('whatsapp_config')
    .select(columns)
    .eq('account_id', accountId)
  const list = (rows ?? []) as ResolvedConfig[]
  return list.find((r) => r.status === 'connected') ?? list[0] ?? null
}

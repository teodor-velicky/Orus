import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Client scoped to the calling user's JWT — RLS applies. */
export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: {
        headers: { Authorization: req.headers.get('Authorization') ?? '' },
      },
    },
  )
}

/** Service-role client — bypasses RLS. Use only for the usage counter. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

export async function requireUser(req: Request) {
  const supabase = userClient(req)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { user: null, supabase }
  return { user, supabase }
}

/**
 * Per-user daily rate limit backed by the edge_usage table.
 * Returns true if the call is allowed.
 */
export async function checkRateLimit(
  userId: string,
  fn: string,
  dailyCap: number,
): Promise<boolean> {
  const admin = adminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data } = await admin
    .from('edge_usage')
    .select('calls')
    .eq('user_id', userId)
    .eq('fn', fn)
    .eq('date', today)
    .maybeSingle()

  const calls = data?.calls ?? 0
  if (calls >= dailyCap) return false

  await admin.from('edge_usage').upsert(
    { user_id: userId, fn, date: today, calls: calls + 1 },
    { onConflict: 'user_id,fn,date' },
  )
  return true
}

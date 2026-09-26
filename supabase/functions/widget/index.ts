// Orus — widget endpoint.
//
// GET /functions/v1/widget?token=<widget token>
//
// Returns a small snapshot for the lock screen widget (scripts/orus-widget.js):
//   { name, hr, hrAt, restingHr, restingAt, updatedAt }
//
// The token comes from public.create_widget_token() in the app and maps to one
// user. It reads nothing but that user's heart rate numbers, and a request with
// a bad token gets a flat 401 with no hint about which part was wrong.
//
// Deploy:  supabase functions deploy widget --no-verify-jwt

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { adminClient } from '../_shared/auth.ts'

const DAY_MS = 86_400_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const token = (url.searchParams.get('token') ?? '').trim()
  if (token.length < 32) return jsonResponse({ error: 'Unauthorized' }, 401)

  const admin = adminClient()
  const { data: row } = await admin.from('widget_tokens').select('user_id').eq('token', token).maybeSingle()
  if (!row) return jsonResponse({ error: 'Unauthorized' }, 401)
  const userId = row.user_id as string

  const since = new Date(Date.now() - DAY_MS).toISOString()
  const [{ data: minutes }, { data: days }, { data: profile }] = await Promise.all([
    admin.from('ring_minutes').select('minute,hr_avg')
      .eq('user_id', userId).gte('minute', since).not('hr_avg', 'is', null)
      .order('minute', { ascending: false }).limit(1),
    admin.from('ring_daily').select('date,resting_hr')
      .eq('user_id', userId).not('resting_hr', 'is', null)
      .order('date', { ascending: false }).limit(1),
    admin.from('profiles').select('name').eq('id', userId).maybeSingle(),
  ])

  // Apple Health is the fallback when the ring hasn't reported a resting rate.
  let resting = days?.[0] ? { value: Number(days[0].resting_hr), at: days[0].date } : null
  if (!resting) {
    const { data: metrics } = await admin.from('daily_metrics').select('date,resting_hr')
      .eq('user_id', userId).not('resting_hr', 'is', null)
      .order('date', { ascending: false }).limit(1)
    if (metrics?.[0]) resting = { value: Number(metrics[0].resting_hr), at: metrics[0].date }
  }

  admin.from('widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token)
    .then(() => {}, () => {})

  return jsonResponse({
    name: (profile?.name as string | null)?.split(' ')[0] ?? null,
    hr: minutes?.[0] ? Math.round(Number(minutes[0].hr_avg)) : null,
    hrAt: minutes?.[0]?.minute ?? null,
    restingHr: resting ? Math.round(resting.value) : null,
    restingAt: resting?.at ?? null,
    updatedAt: new Date().toISOString(),
  })
})

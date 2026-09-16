// Orus — Strava integration edge function.
//
// Body: { action: 'exchange', code }  — finish OAuth, store tokens, first sync
//       { action: 'sync', days? }     — pull recent activities into workouts
//       { action: 'status' }          — { connected, athleteName, lastSyncAt }
//       { action: 'disconnect' }      — deauthorize + delete tokens
//
// Tokens live in strava_tokens (RLS on, no policies → service role only),
// so the client secret and refresh tokens never reach the device.
//
// Deploy:  supabase functions deploy strava
// Secrets: supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, adminClient, checkRateLimit } from '../_shared/auth.ts'

const DAILY_CAP = 60
const API = 'https://www.strava.com/api/v3'

interface TokenRow {
  user_id: string
  athlete_id: number
  athlete_name: string | null
  access_token: string
  refresh_token: string
  expires_at: string
  last_sync_at: string | null
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      ...params,
    }),
  })
  if (!res.ok) throw new Error(`Strava token request failed: ${res.status} ${await res.text()}`)
  return await res.json()
}

async function validToken(row: TokenRow): Promise<string> {
  if (new Date(row.expires_at).getTime() - Date.now() > 120_000) return row.access_token
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token })
  await adminClient().from('strava_tokens').update({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(t.expires_at * 1000).toISOString(),
  }).eq('user_id', row.user_id)
  return t.access_token
}

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun'])
const MAX_STREAM_FETCHES = 12

/**
 * Runs also get their GPS + heart-rate streams, stored in `runs` so the app
 * can show routes, splits and HR zones. Zones / splits are computed on the
 * device (they depend on personal HR settings). Streams cost one API call
 * each, so only runs not yet imported are fetched, a few per sync.
 */
async function syncRunStreams(row: TokenRow, token: string, activities: any[]) {
  const admin = adminClient()
  const runs = activities.filter((a) => RUN_TYPES.has(String(a.sport_type ?? a.type)))
  if (!runs.length) return
  const { data: known } = await admin.from('runs').select('external_id')
    .eq('user_id', row.user_id).eq('source', 'strava').in('external_id', runs.map((a) => String(a.id)))
  const have = new Set((known ?? []).map((r: { external_id: string }) => r.external_id))
  const todo = runs.filter((a) => !have.has(String(a.id))).slice(0, MAX_STREAM_FETCHES)
  const out = []
  for (const a of todo) {
    let streams: Record<string, { data: any[] }> = {}
    try {
      const res = await fetch(`${API}/activities/${a.id}/streams?keys=time,latlng,heartrate,altitude&key_by_type=true`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 429) break
      if (res.ok) streams = await res.json()
    } catch { /* keep the summary */ }
    const time: number[] = streams.time?.data ?? []
    const latlng: [number, number][] = streams.latlng?.data ?? []
    const hrs: number[] = streams.heartrate?.data ?? []
    const alt: number[] = streams.altitude?.data ?? []
    const step = Math.max(1, Math.ceil(latlng.length / 1500))
    // [lat, lng, t_offset_s, alt, seg] — at most ~1500 points
    const route: [number, number, number, number | null, number][] = []
    for (let i = 0; i < latlng.length; i++) {
      if (i % step !== 0 && i !== latlng.length - 1) continue
      route.push([latlng[i][0], latlng[i][1], time[i] ?? i, alt[i] != null ? Math.round(alt[i]) : null, 0])
    }
    // One heart-rate sample per ~5 s
    const hr: [number, number][] = []
    let lastT = -5
    hrs.forEach((b, i) => {
      const t = time[i] ?? i
      if (t - lastT >= 5 && b >= 30 && b <= 230) { hr.push([t, b]); lastT = t }
    })
    const start = new Date(a.start_date)
    const elapsed = Number(a.elapsed_time) || 0
    out.push({
      user_id: row.user_id,
      source: 'strava',
      external_id: String(a.id),
      name: a.name ? String(a.name).slice(0, 120) : null,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + elapsed * 1000).toISOString(),
      duration_s: elapsed,
      moving_s: Number(a.moving_time) || elapsed,
      distance_m: Number(a.distance) || 0,
      elevation_gain_m: a.total_elevation_gain ?? null,
      avg_hr: a.average_heartrate ?? null,
      max_hr: a.max_heartrate ?? null,
      hr_source: a.has_heartrate ? 'strava' : null,
      route: route.length ? route : null,
      hr: hr.length ? hr : null,
      updated_at: new Date().toISOString(),
    })
  }
  if (out.length) {
    const { error } = await admin.from('runs').upsert(out, { onConflict: 'user_id,source,external_id' })
    if (error) console.error('strava runs upsert failed:', error.message)
  }
}

async function syncActivities(row: TokenRow, days: number) {
  const token = await validToken(row)
  const after = Math.floor((Date.now() - days * 86400_000) / 1000)
  const activities: any[] = []
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Strava activities failed: ${res.status}`)
    const batch = await res.json()
    activities.push(...batch)
    if (batch.length < 100) break
  }

  const rows = activities.map((a) => {
    const start = new Date(a.start_date)
    const elapsed = Number(a.elapsed_time) || 0
    return {
      user_id: row.user_id,
      source: 'strava',
      external_id: String(a.id),
      activity: String(a.sport_type ?? a.type ?? 'Workout'),
      name: a.name ? String(a.name).slice(0, 120) : null,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + elapsed * 1000).toISOString(),
      duration_s: Number(a.moving_time) || elapsed,
      distance_m: a.distance ?? null,
      // Summary activities only carry kilojoules (rides); ≈1 kJ work ≈ 1 kcal burned
      kcal: a.kilojoules ? Math.round(a.kilojoules) : null,
      avg_hr: a.average_heartrate ?? null,
      max_hr: a.max_heartrate ?? null,
      elevation_m: a.total_elevation_gain ?? null,
      source_name: 'Strava',
    }
  })

  const admin = adminClient()
  if (rows.length > 0) {
    const { error } = await admin.from('workouts').upsert(rows, { onConflict: 'user_id,source,external_id' })
    if (error) throw new Error(error.message)
  }
  await syncRunStreams(row, token, activities)
  await admin.from('strava_tokens').update({ last_sync_at: new Date().toISOString() }).eq('user_id', row.user_id)
  return rows.length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { user } = await requireUser(req)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)
  if (!(await checkRateLimit(user.id, 'strava', DAILY_CAP))) {
    return jsonResponse({ error: 'Daily limit reached' }, 429)
  }

  let body: { action?: string; code?: string; days?: number }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const admin = adminClient()
  const { data: row } = await admin.from('strava_tokens').select('*').eq('user_id', user.id).maybeSingle()

  try {
    switch (body.action) {
      case 'exchange': {
        if (!body.code) return jsonResponse({ error: 'Missing code' }, 400)
        const t = await tokenRequest({ grant_type: 'authorization_code', code: body.code })
        const newRow: TokenRow = {
          user_id: user.id,
          athlete_id: t.athlete?.id,
          athlete_name: [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(' ') || null,
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: new Date(t.expires_at * 1000).toISOString(),
          last_sync_at: null,
        }
        const { error } = await admin.from('strava_tokens').upsert(newRow, { onConflict: 'user_id' })
        if (error) throw new Error(error.message)
        const imported = await syncActivities(newRow, 90)
        return jsonResponse({ connected: true, athleteName: newRow.athlete_name, imported })
      }
      case 'sync': {
        if (!row) return jsonResponse({ error: 'Strava not connected' }, 400)
        const days = Math.min(365, Math.max(1, body.days ?? 30))
        const imported = await syncActivities(row as TokenRow, days)
        return jsonResponse({ imported })
      }
      case 'status':
        return jsonResponse({
          connected: !!row,
          athleteName: row?.athlete_name ?? null,
          lastSyncAt: row?.last_sync_at ?? null,
        })
      case 'disconnect': {
        if (row) {
          await fetch('https://www.strava.com/oauth/deauthorize', {
            method: 'POST',
            headers: { Authorization: `Bearer ${row.access_token}` },
          }).catch(() => {})
          await admin.from('strava_tokens').delete().eq('user_id', user.id)
        }
        return jsonResponse({ connected: false })
      }
      default:
        return jsonResponse({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    console.error('strava failed:', e)
    return jsonResponse({ error: 'Strava request failed' }, 502)
  }
})

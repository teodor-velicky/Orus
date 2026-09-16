// Supabase IO for runs and run goals.

import { supabase } from '../supabase'
import { addDays, localIso } from '../format'
import { sessionsRange } from '../gym'
import { fitnessSeries } from './load'
import { workoutsRange } from '../metrics'
import type { DailyMetrics, Profile, Run, RunGoalRow } from '../types'
import { dedupeRuns, deriveRun, isRunWorkout, kcalForRun, trainingEvents, workoutToRun, zoneSettings } from './training'

/** Everything except the heavy route / HR arrays. */
const LIST_COLUMNS =
  'id,user_id,source,external_id,name,start_at,end_at,duration_s,moving_s,distance_m,elevation_gain_m,avg_hr,max_hr,kcal,hr_source,splits,best_efforts,zones,trimp,kind,perceived_effort,notes,analysis'

const num = (v: unknown) => (v == null ? null : Number(v))

function normalize(r: Record<string, unknown>): Run {
  return {
    ...(r as unknown as Run),
    distance_m: Number(r.distance_m ?? 0),
    elevation_gain_m: num(r.elevation_gain_m),
    avg_hr: num(r.avg_hr),
    max_hr: num(r.max_hr),
    trimp: num(r.trimp),
  }
}

/**
 * Runs for the last `days` days: stored runs plus running workouts from
 * Apple Health / Strava that have no stored run yet (the fallback when a
 * Garmin or watch recorded it), deduplicated.
 */
export async function runsRange(userId: string, days: number): Promise<Run[]> {
  const from = addDays(new Date(), -days).toISOString()
  const [{ data, error }, workouts] = await Promise.all([
    supabase.from('runs').select(LIST_COLUMNS).eq('user_id', userId).gte('start_at', from).order('start_at', { ascending: false }),
    workoutsRange(userId, days),
  ])
  if (error) throw new Error(error.message)
  const stored = (data ?? []).map(r => normalize(r as Record<string, unknown>))
  return dedupeRuns([...stored, ...workouts.filter(isRunWorkout).map(workoutToRun)])
}

/** Small route previews ([lat, lng] ≤ 40 points) for list thumbnails. */
export async function routePreviews(ids: string[]): Promise<Record<string, [number, number][]>> {
  const real = ids.filter(id => !id.startsWith('w-'))
  if (!real.length) return {}
  const { data } = await supabase.from('runs').select('id,route').in('id', real)
  const out: Record<string, [number, number][]> = {}
  for (const r of (data ?? []) as Pick<Run, 'id' | 'route'>[]) {
    const route = r.route ?? []
    if (route.length < 2) continue
    const step = Math.max(1, Math.ceil(route.length / 40))
    out[r.id] = route.filter((_, i) => i % step === 0 || i === route.length - 1).map(p => [p[0], p[1]])
  }
  return out
}

export async function getRun(id: string): Promise<Run | null> {
  const { data, error } = await supabase.from('runs').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? normalize(data as Record<string, unknown>) : null
}

export type RunInsert = Omit<Run, 'id' | 'lite'>

export async function saveRun(run: RunInsert): Promise<Run> {
  const { data, error } = await supabase.from('runs')
    .upsert({ ...run, updated_at: new Date().toISOString() }, { onConflict: 'user_id,source,external_id' })
    .select('*').single()
  if (error) throw new Error(error.message)
  return normalize(data as Record<string, unknown>)
}

export async function updateRun(id: string, patch: Partial<Pick<Run, 'name' | 'notes' | 'perceived_effort' | 'kind' | 'analysis' | 'hr' | 'avg_hr' | 'max_hr' | 'hr_source' | 'zones' | 'trimp' | 'splits' | 'best_efforts' | 'kcal'>>) {
  const { error } = await supabase.from('runs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteRun(id: string) {
  const { error } = await supabase.from('runs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getGoal(userId: string): Promise<RunGoalRow | null> {
  const { data } = await supabase.from('run_goals').select('*').eq('user_id', userId).maybeSingle()
  return data ? { ...(data as RunGoalRow), distance_m: Number((data as RunGoalRow).distance_m) } : null
}

export async function saveGoal(goal: RunGoalRow) {
  const { error } = await supabase.from('run_goals').upsert({ ...goal, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

export async function deleteGoal(userId: string) {
  const { error } = await supabase.from('run_goals').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)
}

/** Profile + recent resting HR → zone settings, for code paths without a loaded screen (sync). */
export async function zoneContext(userId: string) {
  const [{ data: profile }, { data: metrics }, { data: runs }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('daily_metrics').select('date,resting_hr').eq('user_id', userId).order('date', { ascending: false }).limit(14),
    supabase.from('runs').select('max_hr').eq('user_id', userId).gte('start_at', addDays(new Date(), -180).toISOString()),
  ])
  const p = profile as Profile | null
  return {
    profile: p,
    zs: zoneSettings(p, ((metrics ?? []) as DailyMetrics[]).reverse(), (runs ?? []) as Pick<Run, 'max_hr'>[]),
  }
}

/**
 * Recompute zones / TRIMP / kind for stored runs that have heart rate — after
 * max or resting HR changes, and for runs imported without them (Strava).
 */
export async function recomputeZones(userId: string, onlyMissing = false): Promise<number> {
  const { profile, zs } = await zoneContext(userId)
  let q = supabase.from('runs').select('*').eq('user_id', userId).or('hr.not.is.null,route.not.is.null')
    .gte('start_at', addDays(new Date(), -365).toISOString())
  // best_efforts is only null for runs that were never derived on a device.
  if (onlyMissing) q = q.is('best_efforts', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  let n = 0
  for (const row of (data ?? []).map(r => normalize(r as Record<string, unknown>))) {
    const d = deriveRun({ ...row, zones: null, trimp: null, kind: onlyMissing ? row.kind : null }, zs, profile?.sex ?? null)
    await updateRun(row.id, { zones: d.zones, trimp: d.trimp, kind: d.kind, splits: d.splits, best_efforts: d.best_efforts ?? {}, kcal: row.kcal ?? kcalForRun(row, profile) })
    n++
  }
  return n
}

/**
 * Runs + gym + workouts for the last 90 days → daily load series (for the
 * readiness load part) and the runs themselves. Used where a screen doesn't
 * already hold the raw training data (Food, Us).
 */
export async function trainingSnapshot(profile: Profile, metrics: DailyMetrics[], days = 90) {
  const [runs, sessions, workouts] = await Promise.all([
    runsRange(profile.id, days), sessionsRange(profile.id, days), workoutsRange(profile.id, days),
  ])
  const zs = zoneSettings(profile, metrics, runs)
  const loads = fitnessSeries(
    trainingEvents({ runs, sessions, workouts, zs, sex: profile.sex }),
    localIso(addDays(new Date(), -days)), localIso(),
  )
  return { runs, sessions, workouts, loads, zs }
}

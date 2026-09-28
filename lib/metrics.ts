// Read side for health data + the readiness score.

import { supabase } from './supabase'
import { addDays, dayBounds, localIso } from './format'
import type { EnergyMinute } from './energy'
import { tempDeviation } from './ring/aggregate'
import type { DailyMetrics, SleepSession, Workout } from './types'

interface RingDailyRow {
  date: string
  source: string
  resting_hr: number | null
  hr_avg: number | null
  hr_min: number | null
  hr_max: number | null
  hrv_rmssd_ms: number | null
  skin_temp_c: number | null
  spo2_pct: number | null
  steps: number | null
}

/**
 * Apple Health daily rows overlaid with ring rollups. The ring wins for
 * heart, HRV, SpO₂ and temperature (it's worn at night); steps prefer the
 * phone (Apple Health) and fall back to the ring.
 */
export function mergeRingDays(userId: string, health: DailyMetrics[], ring: RingDailyRow[]): DailyMetrics[] {
  const byDate = new Map<string, DailyMetrics>()
  for (const h of health) byDate.set(h.date, { ...h, hrv_kind: h.hrv_ms != null ? 'sdnn' : undefined })
  const sortedRing = [...ring].sort((a, b) => a.date.localeCompare(b.date))
  sortedRing.forEach((r, i) => {
    const base: DailyMetrics = byDate.get(r.date) ?? {
      user_id: userId, date: r.date, steps: null, active_kcal: null, basal_kcal: null, exercise_min: null,
      distance_m: null, resting_hr: null, hr_avg: null, hr_min: null, hr_max: null, hrv_ms: null,
      respiratory_rate: null, spo2_pct: null, vo2max: null, weight_kg: null, body_fat_pct: null, sources: [],
    }
    const prevTemps = sortedRing.slice(Math.max(0, i - 14), i).map(x => x.skin_temp_c)
    byDate.set(r.date, {
      ...base,
      resting_hr: r.resting_hr ?? base.resting_hr,
      hr_avg: r.hr_avg ?? base.hr_avg,
      hr_min: r.hr_min ?? base.hr_min,
      hr_max: r.hr_max ?? base.hr_max,
      hrv_ms: r.hrv_rmssd_ms ?? base.hrv_ms,
      hrv_kind: r.hrv_rmssd_ms != null ? 'rmssd' : base.hrv_kind,
      spo2_pct: r.spo2_pct ?? base.spo2_pct,
      // A phone or watch counts steps better than a ring, which also counts
      // hand movement (typing, gesturing, gym reps). Ring steps only fill in
      // days with no Apple Health step count.
      steps: base.steps ?? r.steps ?? null,
      skin_temp_c: r.skin_temp_c,
      skin_temp_delta_c: tempDeviation(r.skin_temp_c, prevTemps),
      sources: [...new Set([r.source, ...base.sources])],
    })
  })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Heart rate and steps per ring minute for one local day (energy estimate). */
export async function ringMinutesForDay(userId: string, date: string): Promise<EnergyMinute[]> {
  const { start, end } = dayBounds(date)
  const { data } = await supabase.from('ring_minutes').select('minute, hr_avg, steps')
    .eq('user_id', userId).gte('minute', start).lt('minute', end).order('minute').limit(5000)
  return ((data ?? []) as { minute: string; hr_avg: number | string | null; steps: number | null }[])
    .map(r => ({ minute: r.minute, hr_avg: r.hr_avg == null ? null : Number(r.hr_avg), steps: r.steps }))
}

export async function metricsRange(userId: string, days: number): Promise<DailyMetrics[]> {
  const from = localIso(addDays(new Date(), -days + 1))
  // Extra 14 days of ring rows feed the skin-temperature baseline.
  const ringFrom = localIso(addDays(new Date(), -days - 13))
  const [{ data, error }, { data: ring }] = await Promise.all([
    supabase.from('daily_metrics').select('*').eq('user_id', userId).gte('date', from).order('date'),
    supabase.from('ring_daily').select('*').eq('user_id', userId).gte('date', ringFrom).order('date'),
  ])
  if (error) throw new Error(error.message)
  return mergeRingDays(userId, (data ?? []) as DailyMetrics[], (ring ?? []) as RingDailyRow[])
    .filter(m => m.date >= from)
}

/**
 * One session per night. When several sources recorded the same night
 * (e.g. ring AND watch), use the preferred source, else the one with the
 * most stage detail, else the longest.
 */
export function pickNights(sessions: SleepSession[], preferred?: string | null): SleepSession[] {
  const byNight = new Map<string, SleepSession[]>()
  for (const s of sessions) {
    const list = byNight.get(s.night) ?? []
    list.push(s)
    byNight.set(s.night, list)
  }
  const detail = (s: SleepSession) => (s.deep_min + s.rem_min + s.core_min > 0 ? 1 : 0)
  return [...byNight.values()]
    .map(list =>
      list.find(s => preferred && s.source === preferred) ??
      [...list].sort((a, b) => detail(b) - detail(a) || b.asleep_min - a.asleep_min)[0])
    .sort((a, b) => a.night.localeCompare(b.night))
}

export async function sleepRange(userId: string, days: number): Promise<SleepSession[]> {
  const from = localIso(addDays(new Date(), -days + 1))
  const { data, error } = await supabase.from('sleep_sessions').select('*')
    .eq('user_id', userId).gte('night', from).order('night', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as SleepSession[]
}

export async function workoutsRange(userId: string, days: number): Promise<Workout[]> {
  const from = addDays(new Date(), -days).toISOString()
  const { data, error } = await supabase.from('workouts').select('*')
    .eq('user_id', userId).gte('start_at', from).order('start_at', { ascending: false })
  if (error) throw new Error(error.message)
  return dedupeWorkouts((data ?? []) as Workout[])
}

/** Strava and Apple Health often hold the same activity — keep the Strava copy. */
export function dedupeWorkouts(ws: Workout[]): Workout[] {
  const strava = ws.filter(w => w.source === 'strava')
  return ws.filter(w => {
    if (w.source === 'strava') return true
    const t = new Date(w.start_at).getTime()
    return !strava.some(s => Math.abs(new Date(s.start_at).getTime() - t) < 5 * 60_000)
  })
}

// ─── Readiness ───
// Lives in lib/readiness.ts (pure, tested); re-exported so callers keep one import.
export { readiness, sleepScore } from './readiness'
export type { Readiness, ReadinessPart, ReadinessExtra } from './readiness'

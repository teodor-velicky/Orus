// Read side for health data + the readiness score.

import { supabase } from './supabase'
import { addDays, avg, localIso } from './format'
import { tempDeviation } from './ring/aggregate'
import { formRatio, LoadDay } from './run/load'
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
 * heart, HRV, SpO₂ and temperature (it's worn at night); steps take the
 * larger count since the phone and ring each miss some.
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
      steps: Math.max(r.steps ?? 0, base.steps ?? 0) || null,
      skin_temp_c: r.skin_temp_c,
      skin_temp_delta_c: tempDeviation(r.skin_temp_c, prevTemps),
      sources: [...new Set([r.source, ...base.sources])],
    })
  })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
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

export interface ReadinessPart {
  key: 'sleep' | 'hrv' | 'rhr' | 'temp' | 'load'
  label: string
  score: number
  weight: number
  detail: string
}

export interface Readiness {
  score: number | null
  parts: ReadinessPart[]
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const ramp = (v: number, zero: number, full: number) => Math.round(clamp01((v - zero) / (full - zero)) * 100)

/**
 * Transparent, deterministic readiness: last night's sleep vs target, today's
 * HRV vs the 28-day baseline, resting HR vs baseline, skin temperature and
 * training load (runs + gym + workouts: form = fatigue vs fitness). Missing inputs drop out
 * and the remaining weights renormalize.
 */
export function readiness(
  lastNight: SleepSession | undefined,
  metrics: DailyMetrics[],
  sleepTargetMin: number,
  today = localIso(),
  /** Training load for `today` (see lib/run/load.ts). */
  load?: LoadDay,
): Readiness {
  const parts: ReadinessPart[] = []

  if (lastNight) {
    const ratio = lastNight.asleep_min / sleepTargetMin
    parts.push({
      key: 'sleep', label: 'Sleep', weight: 0.4, score: ramp(ratio, 0.55, 1),
      detail: `${Math.round(ratio * 100)}% of your ${Math.round(sleepTargetMin / 60)}h target`,
    })
  }

  const todayRow = metrics.find(m => m.date === today)
  const history = metrics.filter(m => m.date !== today)

  // Only compare HRV measured the same way (ring RMSSD vs Apple SDNN).
  const hrvHistory = history.filter(m => m.hrv_ms != null && m.hrv_kind === todayRow?.hrv_kind)
  const hrvBase = avg(hrvHistory.map(m => m.hrv_ms))
  if (todayRow?.hrv_ms && hrvBase && hrvHistory.length >= 5) {
    const ratio = todayRow.hrv_ms / hrvBase
    parts.push({
      key: 'hrv', label: 'HRV', weight: 0.35, score: ramp(ratio, 0.75, 1.08),
      detail: `${Math.round(todayRow.hrv_ms)} ms vs ${Math.round(hrvBase)} ms baseline`,
    })
  }

  const rhrBase = avg(history.map(m => m.resting_hr))
  if (todayRow?.resting_hr && rhrBase && history.filter(m => m.resting_hr).length >= 5) {
    const diff = todayRow.resting_hr - rhrBase
    parts.push({
      key: 'rhr', label: 'Resting HR', weight: 0.25, score: ramp(-diff, -6, 1),
      detail: `${Math.round(todayRow.resting_hr)} bpm, ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} vs baseline`,
    })
  }

  // Skin temperature: deviations either way (fever, luteal phase, alcohol,
  // late meals) reduce readiness; within ±0.3 °C is normal night-to-night noise.
  const dt = todayRow?.skin_temp_delta_c
  if (dt != null) {
    parts.push({
      key: 'temp', label: 'Skin temp', weight: 0.15, score: ramp(-Math.abs(dt), -1.2, -0.3),
      detail: `${dt >= 0 ? '+' : ''}${dt.toFixed(2)} °C vs baseline`,
    })
  }

  // Training load: form (TSB) relative to fitness (CTL). Carrying some fatigue
  // is normal; a spike well above fitness lowers readiness.
  const form = formRatio(load)
  if (load && form != null) {
    parts.push({
      key: 'load', label: 'Training load', weight: 0.2, score: ramp(form, -0.6, -0.05),
      detail: `form ${load.tsb >= 0 ? '+' : ''}${Math.round(load.tsb)} · fitness ${Math.round(load.ctl)}`,
    })
  }

  if (!parts.length) return { score: null, parts }
  const w = parts.reduce((a, p) => a + p.weight, 0)
  return { score: Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / w), parts }
}

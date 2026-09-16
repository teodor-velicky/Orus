// Runs + gym + other workouts → one training picture: zones, derived run
// stats, deduplication, load events and calories. Pure (types only).

import { addDays, fromIso, localIso } from '../format'
import type { DailyMetrics, GymSession, GymSet, Profile, Run, RunKind, Workout } from '../types'
import {
  bestEfforts, cleanTrack, downsampleHr, elevationGain, GeoPoint, HrSample, movingTime, simplify, splits as computeSplits, trackDistance,
} from './geo'
import { estimateMaxHr, hrZones, timeInZones, trimp, trimpFromAverage, Zone } from './zones'
import { classifyRun, currentVdot, RunForPlan, TrainingPaces, trainingPaces } from './plan'
import { gymLoad, LoadEvent, runLoadNoHr } from './load'
import { EAT_BACK, runKcal } from './kcal'

// ─── Zone settings ───

export interface ZoneSettings {
  maxHr: number
  restingHr: number
  zones: Zone[]
  maxEstimated: boolean
  restingEstimated: boolean
}

export const ageOf = (p: Pick<Profile, 'birth_year'> | null | undefined) =>
  p?.birth_year ? new Date().getFullYear() - p.birth_year : null

/**
 * Max HR: profile override, else the higher of the age estimate and the
 * highest credible max seen in recent runs. Resting HR: override, else the
 * median of recent daily resting HR.
 */
export function zoneSettings(profile: Profile | null | undefined, metrics: DailyMetrics[], runs: Pick<Run, 'max_hr'>[] = []): ZoneSettings {
  const estimate = estimateMaxHr(ageOf(profile))
  const observed = Math.max(0, ...runs.map(r => (r.max_hr && r.max_hr <= 220 ? r.max_hr : 0)))
  const maxHr = profile?.max_hr ?? Math.max(estimate, observed)
  const rests = metrics.slice(-14).map(m => m.resting_hr).filter((x): x is number => x != null).sort((a, b) => a - b)
  const median = rests.length ? rests[Math.floor(rests.length / 2)] : null
  const restingHr = profile?.resting_hr ?? (median ? Math.round(median) : 60)
  return {
    maxHr, restingHr, zones: hrZones(maxHr, restingHr),
    maxEstimated: profile?.max_hr == null, restingEstimated: profile?.resting_hr == null,
  }
}

// ─── Route / HR codecs ───

export function routeToPoints(run: Pick<Run, 'route' | 'start_at'>): GeoPoint[] {
  const t0 = new Date(run.start_at).getTime()
  return (run.route ?? []).map(([lat, lng, t, alt, seg]) => ({ lat, lng, t: t0 + t * 1000, alt, seg }))
}

export function pointsToRoute(points: GeoPoint[], t0: number): NonNullable<Run['route']> {
  return points.map(p => [
    Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6, Math.round((p.t - t0) / 1000),
    p.alt != null ? Math.round(p.alt) : null, p.seg ?? 0,
  ])
}

export function hrToSamples(run: Pick<Run, 'hr' | 'start_at'>): HrSample[] {
  const t0 = new Date(run.start_at).getTime()
  return (run.hr ?? []).map(([t, bpm]) => ({ t: t0 + t * 1000, bpm }))
}

export const samplesToHr = (hr: HrSample[], t0: number): NonNullable<Run['hr']> =>
  hr.map(h => [Math.round((h.t - t0) / 1000), h.bpm])

// ─── Derivation ───

/** Fill zones / TRIMP / splits / efforts / kind where missing. */
export function deriveRun(run: Run, zs: ZoneSettings, sex: Profile['sex'], typicalKm = 7, paces: TrainingPaces | null = null): Run {
  const hr = hrToSamples(run)
  const out = { ...run }
  if (hr.length >= 10) {
    out.zones = timeInZones(hr, zs.zones)
    out.trimp = trimp(hr, zs.restingHr, zs.maxHr, sex)
  } else if (!out.trimp && run.avg_hr) {
    out.trimp = trimpFromAverage(run.moving_s ?? run.duration_s, run.avg_hr, zs.restingHr, zs.maxHr, sex)
  }
  if (run.route?.length && (!out.splits || !out.best_efforts)) {
    const pts = routeToPoints(run)
    out.splits = out.splits ?? computeSplits(pts, hr)
    out.best_efforts = out.best_efforts ?? bestEfforts(pts)
  }
  if (!out.kind) {
    out.kind = classifyRun(run.distance_m, run.moving_s ?? run.duration_s, out.zones, paces, typicalKm)
  }
  return out
}

export const RUN_ACTIVITY = /(^|\b)(run|running|trailrun|virtualrun|trail run)/i
export const isRunWorkout = (w: Pick<Workout, 'activity'>) => RUN_ACTIVITY.test(w.activity.replace(/([a-z])([A-Z])/g, '$1 $2'))

/** A lightweight run from a workouts row — the Apple Health / Strava fallback. */
export function workoutToRun(w: Workout): Run {
  return {
    id: `w-${w.source}-${w.external_id}`, user_id: w.user_id, source: w.source, external_id: w.external_id,
    name: w.name, start_at: w.start_at, end_at: w.end_at, duration_s: w.duration_s, moving_s: w.duration_s,
    distance_m: Number(w.distance_m ?? 0), elevation_gain_m: w.elevation_m, avg_hr: w.avg_hr, max_hr: w.max_hr,
    kcal: w.kcal, hr_source: w.avg_hr ? (w.source === 'strava' ? 'strava' : 'watch') : null,
    route: null, hr: null, splits: null, best_efforts: null, zones: null, trimp: null, kind: null,
    perceived_effort: null, notes: null, analysis: null, lite: true,
  }
}

const richness = (r: Run) =>
  (r.lite ? 0 : 4) + (r.route?.length || r.splits?.length ? 2 : 0) + (r.hr?.length || r.zones ? 2 : 0) + (r.source === 'orus' ? 1 : 0)

/** Overlap > 50 % of the shorter run → same run; keep the richest copy (and borrow HR if it lacks it). */
export function dedupeRuns(runs: Run[]): Run[] {
  const sorted = [...runs].sort((a, b) => richness(b) - richness(a))
  const kept: Run[] = []
  for (const r of sorted) {
    const s = new Date(r.start_at).getTime(), e = new Date(r.end_at).getTime()
    const twin = kept.find(k => {
      const ks = new Date(k.start_at).getTime(), ke = new Date(k.end_at).getTime()
      const overlap = Math.min(e, ke) - Math.max(s, ks)
      return overlap > 0.5 * Math.min(e - s, ke - ks)
    })
    if (!twin) { kept.push(r); continue }
    if (twin.avg_hr == null && r.avg_hr != null) {
      Object.assign(twin, { avg_hr: r.avg_hr, max_hr: r.max_hr, hr_source: r.hr_source, hr: twin.hr ?? r.hr, zones: twin.zones ?? r.zones, trimp: twin.trimp ?? r.trimp })
    }
  }
  return kept.sort((a, b) => b.start_at.localeCompare(a.start_at))
}

export const runDate = (r: Pick<Run, 'start_at'>) => localIso(new Date(r.start_at))

export const toPlanRuns = (runs: Run[]): RunForPlan[] => runs.map(r => ({
  date: runDate(r), distanceM: r.distance_m, durationS: r.moving_s ?? r.duration_s,
  kind: (r.kind ?? 'easy') as RunKind, bestEfforts: r.best_efforts,
}))

// ─── Load & calories ───

type SessionWithSets = GymSession & { sets: GymSet[] }

/** One load number per activity, deduping running workouts already present as runs. */
export function trainingEvents(o: {
  runs: Run[]
  sessions: SessionWithSets[]
  workouts: Workout[]
  zs: ZoneSettings
  sex: Profile['sex']
}): LoadEvent[] {
  const vdot = currentVdot(toPlanRuns(o.runs))
  const threshold = vdot ? trainingPaces(vdot).threshold : null
  const events: LoadEvent[] = []
  for (const r of o.runs) {
    const dur = r.moving_s ?? r.duration_s
    const load = r.trimp ?? (r.avg_hr
      ? trimpFromAverage(dur, r.avg_hr, o.zs.restingHr, o.zs.maxHr, o.sex)
      : runLoadNoHr(dur, r.distance_m > 0 ? dur / (r.distance_m / 1000) : 0, threshold))
    events.push({ date: runDate(r), load })
  }
  for (const s of o.sessions) {
    const dur = s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000 : null
    events.push({ date: localIso(new Date(s.started_at)), load: gymLoad(dur, s.sets.filter(x => x.completed && !x.is_warmup).length) })
  }
  for (const w of o.workouts) {
    if (isRunWorkout(w)) continue
    if (/strength|functional|core/i.test(w.activity) && o.sessions.some(s => Math.abs(new Date(s.started_at).getTime() - new Date(w.start_at).getTime()) < 30 * 60_000)) continue
    events.push({
      date: localIso(new Date(w.start_at)),
      load: w.avg_hr ? trimpFromAverage(w.duration_s, w.avg_hr, o.zs.restingHr, o.zs.maxHr, o.sex) : Math.round((w.duration_s / 60) * 1.2),
    })
  }
  return events
}

export function kcalForRun(r: Run, profile: Profile | null | undefined): number {
  if (r.kcal) return r.kcal
  return runKcal({
    distanceM: r.distance_m, durationS: r.moving_s ?? r.duration_s, weightKg: profile?.weight_kg,
    avgHr: r.avg_hr, age: ageOf(profile), sex: profile?.sex,
  })
}

/** Running calories on a date and how much of it goes back into the food target. */
export function runEnergy(runs: Run[], date: string, profile: Profile | null | undefined): { kcal: number; bonus: number; km: number; count: number } {
  const today = runs.filter(r => runDate(r) === date)
  const kcal = today.reduce((a, r) => a + kcalForRun(r, profile), 0)
  return { kcal, bonus: Math.round((kcal * EAT_BACK) / 10) * 10, km: today.reduce((a, r) => a + r.distance_m, 0) / 1000, count: today.length }
}

/** Distance per day for the `n` days ending at `end`. */
export function kmByDay(runs: Run[], n: number, end = localIso()): number[] {
  return Array.from({ length: n }, (_, i) => {
    const d = localIso(addDays(fromIso(end), i - n + 1))
    return runs.filter(r => runDate(r) === d).reduce((a, r) => a + r.distance_m, 0) / 1000
  })
}

// ─── Building a run from raw GPS + HR ───

export interface RawRun {
  userId: string
  source: Run['source']
  externalId: string
  name?: string | null
  startedAt: number
  endedAt: number
  /** Total paused time (recorded runs). */
  pausedMs?: number
  points: GeoPoint[]
  hr: HrSample[]
  hrSource: Run['hr_source']
  /** Distance / kcal reported by the device, used when there is no GPS. */
  distanceM?: number | null
  kcal?: number | null
}

export function runNameFor(startedAt: number, prefix = ''): string {
  const h = new Date(startedAt).getHours()
  const part = h < 5 ? 'Night' : h < 11 ? 'Morning' : h < 14 ? 'Lunch' : h < 18 ? 'Afternoon' : h < 22 ? 'Evening' : 'Night'
  return `${prefix}${part} run`
}

/**
 * Raw track → a storable run. Splits and best efforts come from the full
 * cleaned track; only the simplified route is stored. Zones / TRIMP / kind
 * need personal HR settings, so they're filled when `zs` is given.
 */
export function buildRun(raw: RawRun, profile: Profile | null | undefined, zs?: ZoneSettings, paces: TrainingPaces | null = null): Omit<Run, 'id' | 'lite'> {
  const pts = cleanTrack(raw.points)
  const hr = downsampleHr(raw.hr, 5)
  const gpsDistance = trackDistance(pts)
  const distance = pts.length >= 2 ? gpsDistance : Number(raw.distanceM ?? 0)
  const elapsed = Math.round((raw.endedAt - raw.startedAt) / 1000)
  const active = Math.round(elapsed - (raw.pausedMs ?? 0) / 1000)
  // GPS moving time, floored at 60 % of active time in case fixes were sparse (tunnels, lock screen).
  const moving = pts.length >= 2 ? Math.min(active, Math.max(movingTime(pts), Math.round(active * 0.6))) : active
  const bpm = hr.map(h => h.bpm)
  const avgHr = bpm.length ? Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length) : null
  const base: Omit<Run, 'id' | 'lite'> = {
    user_id: raw.userId, source: raw.source, external_id: raw.externalId,
    name: raw.name ?? runNameFor(raw.startedAt),
    start_at: new Date(raw.startedAt).toISOString(), end_at: new Date(raw.endedAt).toISOString(),
    duration_s: elapsed, moving_s: moving, distance_m: Math.round(distance),
    elevation_gain_m: pts.length >= 2 ? elevationGain(pts) : null,
    avg_hr: avgHr, max_hr: bpm.length ? Math.max(...bpm) : null,
    kcal: raw.kcal ?? null,
    hr_source: bpm.length ? raw.hrSource : null,
    route: pts.length >= 2 ? pointsToRoute(simplify(pts, 3), raw.startedAt) : null,
    hr: hr.length ? samplesToHr(hr, raw.startedAt) : null,
    splits: pts.length >= 2 ? computeSplits(pts, hr) : null,
    best_efforts: pts.length >= 2 ? bestEfforts(pts) : null,
    zones: null, trimp: null, kind: null, perceived_effort: null, notes: null, analysis: null,
  }
  base.kcal = base.kcal ?? kcalForRun(base as Run, profile)
  if (!zs) return base
  const d = deriveRun({ ...base, id: '' } as Run, zs, profile?.sex ?? null, 7, paces)
  return { ...base, zones: d.zones, trimp: d.trimp, kind: d.kind }
}

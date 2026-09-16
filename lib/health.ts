// Apple Health → Supabase sync.
//
// Orus never talks to wearables directly. Every device (Apple Watch, a smart
// ring via its companion app, scales, iPhone) writes into Apple Health, and
// this module reads HealthKit and upserts daily_metrics, sleep_sessions and
// workouts. Source names are kept so the UI can show "via Colmi R10" etc.
//
// The native module does not exist in Expo Go — everything degrades to
// `available: false` instead of crashing.

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { isExpoGo } from './env'
import { addDays, localIso, startOfDay } from './format'
import type { DailyMetrics, SleepSession, SleepStage, Workout } from './types'
import type { HrSample } from './run/geo'
import { buildRun } from './run/training'
import { zoneContext } from './run/data'

type HK = typeof import('@kingstinct/react-native-healthkit')

let hk: HK | null | undefined
function healthkit(): HK | null {
  if (hk !== undefined) return hk
  if (Platform.OS !== 'ios' || isExpoGo) return (hk = null)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@kingstinct/react-native-healthkit') as HK
    hk = mod.isHealthDataAvailable() ? mod : null
  } catch {
    hk = null
  }
  return hk
}

export const isHealthAvailable = () => healthkit() !== null

const LAST_SYNC_KEY = 'orus.health.lastSync'
const AUTHORIZED_KEY = 'orus.health.authorized'

const READ_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierBasalEnergyBurned',
  'HKQuantityTypeIdentifierAppleExerciseTime',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRespiratoryRate',
  'HKQuantityTypeIdentifierOxygenSaturation',
  'HKQuantityTypeIdentifierVO2Max',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierBodyFatPercentage',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKWorkoutTypeIdentifier',
  // GPS routes of runs recorded by a Garmin / Apple Watch / other app
  'HKWorkoutRouteTypeIdentifier',
] as const

export async function requestHealthAccess(): Promise<boolean> {
  const mod = healthkit()
  if (!mod) return false
  // HealthKit never reveals whether READ access was granted; a resolved
  // request only means the sheet was shown. Missing data is the only signal.
  await mod.requestAuthorization({ toRead: READ_TYPES as unknown as Parameters<HK['requestAuthorization']>[0]['toRead'] })
  await AsyncStorage.setItem(AUTHORIZED_KEY, '1')
  return true
}

export async function hasRequestedHealthAccess(): Promise<boolean> {
  return (await AsyncStorage.getItem(AUTHORIZED_KEY)) === '1'
}

export async function lastHealthSync(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SYNC_KEY)
}

// ─── Quantity statistics per day ───

type StatOption = 'cumulativeSum' | 'discreteAverage' | 'discreteMin' | 'discreteMax' | 'mostRecent'

interface DayStat { date: string; value: number; min?: number; max?: number; sources: string[] }

async function dailyStats(
  mod: HK,
  identifier: (typeof READ_TYPES)[number],
  option: StatOption,
  unit: string,
  from: Date,
  to: Date,
  withMinMax = false,
): Promise<Map<string, DayStat>> {
  const out = new Map<string, DayStat>()
  const options: StatOption[] = withMinMax ? [option, 'discreteMin', 'discreteMax'] : [option]
  try {
    const buckets = await mod.queryStatisticsCollectionForQuantity(
      identifier as never,
      options,
      startOfDay(from),
      { day: 1 },
      { unit: unit as never, filter: { date: { startDate: from, endDate: to } } },
    )
    for (const b of buckets) {
      if (!b.startDate) continue
      const q = option === 'cumulativeSum' ? b.sumQuantity
        : option === 'discreteAverage' ? b.averageQuantity
        : b.mostRecentQuantity
      if (!q || !isFinite(q.quantity)) continue
      out.set(localIso(new Date(b.startDate)), {
        date: localIso(new Date(b.startDate)),
        value: q.quantity,
        min: b.minimumQuantity?.quantity,
        max: b.maximumQuantity?.quantity,
        sources: (b.sources ?? []).map(s => s.name),
      })
    }
  } catch (e) {
    console.warn(`HealthKit stats failed for ${identifier}`, e)
  }
  return out
}

async function syncDailyMetrics(mod: HK, userId: string, from: Date, to: Date): Promise<number> {
  const [steps, active, basal, exercise, distance, hr, rhr, hrv, resp, spo2, vo2, weight, fat] = await Promise.all([
    dailyStats(mod, 'HKQuantityTypeIdentifierStepCount', 'cumulativeSum', 'count', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierActiveEnergyBurned', 'cumulativeSum', 'kcal', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierBasalEnergyBurned', 'cumulativeSum', 'kcal', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierAppleExerciseTime', 'cumulativeSum', 'min', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierDistanceWalkingRunning', 'cumulativeSum', 'm', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierHeartRate', 'discreteAverage', 'count/min', from, to, true),
    dailyStats(mod, 'HKQuantityTypeIdentifierRestingHeartRate', 'discreteAverage', 'count/min', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'discreteAverage', 'ms', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierRespiratoryRate', 'discreteAverage', 'count/min', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierOxygenSaturation', 'discreteAverage', '%', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierVO2Max', 'mostRecent', 'ml/(kg*min)', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierBodyMass', 'mostRecent', 'kg', from, to),
    dailyStats(mod, 'HKQuantityTypeIdentifierBodyFatPercentage', 'mostRecent', '%', from, to),
  ])

  const dates = new Set<string>()
  for (const m of [steps, active, basal, exercise, distance, hr, rhr, hrv, resp, spo2, vo2, weight, fat]) {
    m.forEach((_, k) => dates.add(k))
  }

  const round = (v: number | undefined, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)
  // HealthKit '%' comes back as a 0-1 fraction
  const pct = (v: number | undefined) => (v == null ? null : round(v <= 1 ? v * 100 : v, 1))

  const rows: DailyMetrics[] = [...dates].map(date => {
    const sources = new Set<string>()
    for (const m of [steps, hr, rhr, hrv, spo2]) m.get(date)?.sources.forEach(s => sources.add(s))
    const h = hr.get(date)
    return {
      user_id: userId,
      date,
      steps: round(steps.get(date)?.value),
      active_kcal: round(active.get(date)?.value),
      basal_kcal: round(basal.get(date)?.value),
      exercise_min: round(exercise.get(date)?.value),
      distance_m: round(distance.get(date)?.value),
      resting_hr: round(rhr.get(date)?.value, 1),
      hr_avg: round(h?.value, 1),
      hr_min: round(h?.min),
      hr_max: round(h?.max),
      hrv_ms: round(hrv.get(date)?.value, 1),
      respiratory_rate: round(resp.get(date)?.value, 1),
      spo2_pct: pct(spo2.get(date)?.value),
      vo2max: round(vo2.get(date)?.value, 1),
      weight_kg: round(weight.get(date)?.value, 1),
      body_fat_pct: pct(fat.get(date)?.value),
      sources: [...sources],
      updated_at: new Date().toISOString(),
    }
  })

  if (rows.length) {
    const { error } = await supabase.from('daily_metrics').upsert(rows, { onConflict: 'user_id,date' })
    if (error) throw new Error(`daily_metrics: ${error.message}`)
  }
  return rows.length
}

// ─── Sleep ───

const STAGE_BY_VALUE: Record<number, SleepStage> = {
  0: 'in_bed', 1: 'asleep', 2: 'awake', 3: 'core', 4: 'deep', 5: 'rem',
}

interface RawSleep { start: number; end: number; stage: SleepStage }

/**
 * Cluster one source's samples into sessions (gap > 2 h splits), attribute
 * each session to the local date it ended, and keep the longest per night
 * — that drops naps without dropping real nights.
 */
export function buildSleepSessions(userId: string, source: string, samples: RawSleep[]): SleepSession[] {
  const sorted = [...samples].sort((a, b) => a.start - b.start)
  const clusters: RawSleep[][] = []
  for (const s of sorted) {
    const last = clusters[clusters.length - 1]
    const lastEnd = last ? Math.max(...last.map(x => x.end)) : 0
    if (last && s.start - lastEnd <= 2 * 3600_000) last.push(s)
    else clusters.push([s])
  }

  const byNight = new Map<string, SleepSession>()
  for (const c of clusters) {
    const start = Math.min(...c.map(x => x.start))
    const end = Math.max(...c.map(x => x.end))
    const mins = (stage: SleepStage) =>
      Math.round(c.filter(x => x.stage === stage).reduce((a, x) => a + (x.end - x.start), 0) / 60000)

    const core = mins('core'), deep = mins('deep'), rem = mins('rem'), unspecified = mins('asleep')
    const asleep = core + deep + rem + unspecified
    if (asleep < 30) continue
    const inBedSamples = mins('in_bed')
    const session: SleepSession = {
      user_id: userId,
      night: localIso(new Date(end)),
      source,
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      in_bed_min: Math.max(inBedSamples, Math.round((end - start) / 60000)),
      asleep_min: asleep,
      awake_min: mins('awake'),
      core_min: core,
      deep_min: deep,
      rem_min: rem,
      stages: c
        .filter(x => x.stage !== 'in_bed')
        .map(x => ({
          v: x.stage,
          s: Math.round((x.start - start) / 60000),
          d: Math.max(1, Math.round((x.end - x.start) / 60000)),
        })),
    }
    const existing = byNight.get(session.night)
    if (!existing || session.asleep_min > existing.asleep_min) byNight.set(session.night, session)
  }
  return [...byNight.values()]
}

async function syncSleep(mod: HK, userId: string, from: Date, to: Date): Promise<number> {
  const samples = await mod.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
    limit: 0,
    ascending: true,
    filter: { date: { startDate: addDays(from, -1), endDate: to } },
  })
  const bySource = new Map<string, RawSleep[]>()
  for (const s of samples) {
    const stage = STAGE_BY_VALUE[Number(s.value)]
    if (!stage) continue
    const name = s.sourceRevision?.source?.name ?? 'Unknown'
    const list = bySource.get(name) ?? []
    list.push({ start: new Date(s.startDate).getTime(), end: new Date(s.endDate).getTime(), stage })
    bySource.set(name, list)
  }
  const sessions = [...bySource.entries()].flatMap(([source, list]) => buildSleepSessions(userId, source, list))
  if (sessions.length) {
    const { error } = await supabase.from('sleep_sessions').upsert(
      sessions.map(s => ({ ...s, updated_at: new Date().toISOString() })),
      { onConflict: 'user_id,night,source' },
    )
    if (error) throw new Error(`sleep_sessions: ${error.message}`)
  }
  return sessions.length
}

// ─── Workouts ───

const ACTIVITY_NAMES: Record<number, string> = {
  13: 'Cycling', 20: 'Functional Strength', 24: 'Hiking', 35: 'Rowing', 37: 'Running',
  46: 'Swimming', 50: 'Strength Training', 52: 'Walking', 57: 'Yoga', 59: 'Core Training',
  63: 'HIIT', 16: 'Elliptical', 11: 'Cross Training', 66: 'Pilates', 73: 'Mixed Cardio',
  44: 'Stair Climbing', 64: 'Jump Rope', 8: 'Boxing', 48: 'Tennis', 41: 'Soccer',
  61: 'Downhill Skiing', 9: 'Climbing', 62: 'Flexibility', 80: 'Cooldown',
}

function toMeters(q?: { quantity: number; unit: string }): number | null {
  if (!q) return null
  const f: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, yd: 0.9144, ft: 0.3048 }
  return Math.round(q.quantity * (f[q.unit] ?? 1))
}

function toKcal(q?: { quantity: number; unit: string }): number | null {
  if (!q) return null
  const f: Record<string, number> = { kcal: 1, Cal: 1, cal: 0.001, kJ: 0.239, J: 0.000239 }
  return Math.round(q.quantity * (f[q.unit] ?? 1))
}

async function syncWorkouts(mod: HK, userId: string, from: Date, to: Date): Promise<number> {
  const proxies = await mod.queryWorkoutSamples({
    limit: 0,
    ascending: false,
    filter: { date: { startDate: from, endDate: to } },
  })
  const rows: Workout[] = []
  const runs: Parameters<typeof buildRun>[0][] = []
  // Runs already imported with detail don't need their route / HR fetched again.
  const { data: known } = await supabase.from('runs').select('external_id')
    .eq('user_id', userId).eq('source', 'apple_health').gte('start_at', from.toISOString())
  const knownIds = new Set((known ?? []).map(r => r.external_id as string))
  for (const w of proxies) {
    try {
      // Strava-originated workouts arrive via the Strava sync with richer data.
      const sourceName = w.sourceRevision?.source?.name ?? null
      if (sourceName?.toLowerCase() === 'strava') continue
      let avgHr: number | null = null
      let maxHr: number | null = null
      try {
        const stat = await w.getStatistic('HKQuantityTypeIdentifierHeartRate', 'count/min')
        avgHr = stat?.averageQuantity?.quantity ?? null
        maxHr = stat?.maximumQuantity?.quantity ?? null
      } catch { /* no HR for this workout */ }
      const start = new Date(w.startDate)
      const end = new Date(w.endDate)
      rows.push({
        user_id: userId,
        source: 'apple_health',
        external_id: w.uuid,
        activity: ACTIVITY_NAMES[Number(w.workoutActivityType)] ?? 'Workout',
        name: null,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        duration_s: Math.round((end.getTime() - start.getTime()) / 1000),
        distance_m: toMeters(w.totalDistance),
        kcal: toKcal(w.totalEnergyBurned),
        avg_hr: avgHr ? Math.round(avgHr) : null,
        max_hr: maxHr ? Math.round(maxHr) : null,
        elevation_m: null,
        source_name: sourceName,
      })

      // Running (37): keep the GPS route and heart-rate samples as a full run —
      // the fallback when a Garmin / Apple Watch recorded it instead of the ring.
      if (Number(w.workoutActivityType) === 37 && !knownIds.has(w.uuid)) {
        let points: { t: number; lat: number; lng: number; alt: number | null; acc: number | null; seg: number }[] = []
        try {
          const routes = await w.getWorkoutRoutes()
          points = routes.flatMap((r, seg) => r.locations.map(l => ({
            t: new Date(l.date).getTime(), lat: l.latitude, lng: l.longitude, alt: l.altitude, acc: l.horizontalAccuracy, seg,
          })))
        } catch { /* no route permission or indoor run */ }
        runs.push({
          userId, source: 'apple_health', externalId: w.uuid, name: null,
          startedAt: start.getTime(), endedAt: end.getTime(), points,
          hr: await heartRateBetween(start, end), hrSource: 'watch',
          distanceM: toMeters(w.totalDistance), kcal: toKcal(w.totalEnergyBurned),
        })
      }
    } finally {
      w.dispose()
    }
  }
  if (rows.length) {
    const { error } = await supabase.from('workouts').upsert(rows, { onConflict: 'user_id,source,external_id' })
    if (error) throw new Error(`workouts: ${error.message}`)
  }
  if (runs.length) {
    const { profile, zs } = await zoneContext(userId)
    const built = runs.map(r => ({ ...buildRun(r, profile, zs), updated_at: new Date().toISOString() }))
    const { error } = await supabase.from('runs').upsert(built, { onConflict: 'user_id,source,external_id' })
    if (error) throw new Error(`runs: ${error.message}`)
  }
  return rows.length
}

/**
 * Heart-rate samples in a time window from any Apple Health source (Garmin,
 * Apple Watch, …). Used to give runs recorded without the ring a heart rate.
 */
export async function heartRateBetween(from: Date, to: Date): Promise<HrSample[]> {
  const mod = healthkit()
  if (!mod) return []
  try {
    const samples = await mod.queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', {
      limit: 0, ascending: true, unit: 'count/min',
      filter: { date: { startDate: from, endDate: to } },
    })
    return samples.map(s => ({ t: new Date(s.startDate).getTime(), bpm: Math.round(s.quantity) }))
  } catch (e) {
    console.warn('HealthKit heart rate query failed', e)
    return []
  }
}

// ─── Public entry point ───

export interface HealthSyncResult { days: number; nights: number; workouts: number }

let inFlight: Promise<HealthSyncResult> | null = null

/** Sync the last `days` days (first run: 60). Concurrent calls share one run. */
export function syncHealth(userId: string, days?: number): Promise<HealthSyncResult> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const mod = healthkit()
    if (!mod) throw new Error('Apple Health is not available in this build')
    const last = await lastHealthSync()
    const span = days ?? (last ? 7 : 60)
    const to = new Date()
    const from = startOfDay(addDays(to, -span + 1))
    const [d, n, w] = await Promise.all([
      syncDailyMetrics(mod, userId, from, to),
      syncSleep(mod, userId, from, to),
      syncWorkouts(mod, userId, from, to),
    ])
    await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString())
    return { days: d, nights: n, workouts: w }
  })().finally(() => { inFlight = null })
  return inFlight
}

/** Sync if authorized and the last sync is older than `maxAgeMin`. */
export async function syncHealthIfStale(userId: string, maxAgeMin = 15): Promise<boolean> {
  if (!isHealthAvailable() || !(await hasRequestedHealthAccess())) return false
  const last = await lastHealthSync()
  if (last && Date.now() - new Date(last).getTime() < maxAgeMin * 60_000) return false
  await syncHealth(userId)
  return true
}

// Readiness: one 0-100 number for "how ready is my body today", built from
// parts you can each see and argue with. Pure (unit-tested).
//
//   Sleep        30 %  duration vs target, efficiency, deep + REM share
//   HRV          25 %  vs your own baseline (or typical for your age while calibrating)
//   Resting HR   15 %  vs your own baseline (or a general healthy range while calibrating)
//   Skin temp    10 %  distance from your usual night temperature, either direction
//   Food         10 %  yesterday's food quality
//   Load         10 %  training fatigue vs fitness
//
// Missing parts drop out and the rest renormalize. Parts measured against a
// general norm instead of your own baseline count half, and say so.

import { avg, localIso } from './format'
import { formRatio, LoadDay } from './run/load'
import type { DailyMetrics, SleepSession } from './types'

export type ReadinessKey = 'sleep' | 'hrv' | 'rhr' | 'temp' | 'food' | 'load'

export interface ReadinessPart {
  key: ReadinessKey
  label: string
  score: number
  weight: number
  detail: string
  /** Scored against a general norm while your personal baseline builds. */
  provisional?: boolean
}

export interface Readiness {
  score: number | null
  parts: ReadinessPart[]
  /** Nights of history still needed before every part uses your own baseline. */
  calibratingNights: number
}

export interface ReadinessExtra {
  /** Yesterday's food quality, 0-100 (null when fewer than two meals were logged). */
  foodQuality?: number | null
  age?: number | null
}

const BASELINE_NIGHTS = 5
const WEIGHTS: Record<ReadinessKey, number> = { sleep: 0.3, hrv: 0.25, rhr: 0.15, temp: 0.1, food: 0.1, load: 0.1 }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
export const ramp = (v: number, zero: number, full: number) => Math.round(clamp01((v - zero) / (full - zero)) * 100)

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`

/** Typical nightly RMSSD for an age: roughly 55-60 ms in the 20s, falling ~8 ms a decade. */
export const typicalRmssd = (age: number | null | undefined) =>
  Math.max(25, Math.min(60, 70 - 0.8 * (age && age > 10 ? age : 30)))

export function sleepScore(night: SleepSession, targetMin: number): { score: number; detail: string } {
  const duration = ramp(night.asleep_min / targetMin, 0.55, 1)
  const efficiency = ramp(night.asleep_min / Math.max(1, night.in_bed_min), 0.75, 0.9)
  const staged = night.deep_min + night.rem_min + night.core_min > 0
  if (!staged) {
    return {
      score: Math.round(duration * 0.8 + efficiency * 0.2),
      detail: `${hm(night.asleep_min)} of ${Math.round(targetMin / 60)}h`,
    }
  }
  const restorativeShare = (night.deep_min + night.rem_min) / Math.max(1, night.asleep_min)
  const restorative = ramp(restorativeShare, 0.2, 0.4)
  return {
    score: Math.round(duration * 0.6 + efficiency * 0.15 + restorative * 0.25),
    detail: `${hm(night.asleep_min)} · ${Math.round(restorativeShare * 100)}% deep + REM`,
  }
}

export function readiness(
  lastNight: SleepSession | undefined,
  metrics: DailyMetrics[],
  sleepTargetMin: number,
  today = localIso(),
  /** Training load for `today` (see lib/run/load.ts). */
  load?: LoadDay,
  extra: ReadinessExtra = {},
): Readiness {
  const parts: ReadinessPart[] = []
  const add = (p: Omit<ReadinessPart, 'weight'>) =>
    parts.push({ ...p, weight: WEIGHTS[p.key] * (p.provisional ? 0.5 : 1) })

  if (lastNight) {
    const s = sleepScore(lastNight, sleepTargetMin)
    add({ key: 'sleep', label: 'Sleep', score: s.score, detail: s.detail })
  }

  const todayRow = metrics.find(m => m.date === today)
  const history = metrics.filter(m => m.date !== today)

  // HRV: only compare values measured the same way (ring RMSSD vs Apple SDNN).
  const hrvHistory = history.filter(m => m.hrv_ms != null && m.hrv_kind === todayRow?.hrv_kind)
  const hrvBase = avg(hrvHistory.map(m => m.hrv_ms))
  if (todayRow?.hrv_ms && hrvBase && hrvHistory.length >= BASELINE_NIGHTS) {
    add({
      key: 'hrv', label: 'HRV', score: ramp(todayRow.hrv_ms / hrvBase, 0.75, 1.08),
      detail: `${Math.round(todayRow.hrv_ms)} ms vs ${Math.round(hrvBase)} ms baseline`,
    })
  } else if (todayRow?.hrv_ms && todayRow.hrv_kind !== 'sdnn') {
    const norm = typicalRmssd(extra.age)
    add({
      key: 'hrv', label: 'HRV', provisional: true, score: ramp(todayRow.hrv_ms / norm, 0.6, 1),
      detail: `${Math.round(todayRow.hrv_ms)} ms · typical for your age ~${Math.round(norm)}`,
    })
  }

  const rhrHistory = history.filter(m => m.resting_hr != null)
  const rhrBase = avg(rhrHistory.map(m => m.resting_hr))
  if (todayRow?.resting_hr && rhrBase && rhrHistory.length >= BASELINE_NIGHTS) {
    const diff = todayRow.resting_hr - rhrBase
    add({
      key: 'rhr', label: 'Resting HR', score: ramp(-diff, -6, 1),
      detail: `${Math.round(todayRow.resting_hr)} bpm, ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} vs baseline`,
    })
  } else if (todayRow?.resting_hr) {
    add({
      key: 'rhr', label: 'Resting HR', provisional: true, score: ramp(-todayRow.resting_hr, -80, -55),
      detail: `${Math.round(todayRow.resting_hr)} bpm`,
    })
  }

  // Skin temperature: deviations either way (fever, luteal phase, alcohol,
  // late meals) reduce readiness; within ±0.3 °C is normal night-to-night noise.
  const dt = todayRow?.skin_temp_delta_c
  if (dt != null) {
    add({
      key: 'temp', label: 'Skin temp', score: ramp(-Math.abs(dt), -1.2, -0.3),
      detail: `${dt >= 0 ? '+' : ''}${dt.toFixed(2)} °C vs your usual`,
    })
  }

  if (extra.foodQuality != null) {
    add({
      key: 'food', label: 'Food', score: Math.round(Math.max(0, Math.min(100, extra.foodQuality))),
      detail: `yesterday's quality ${Math.round(extra.foodQuality)}`,
    })
  }

  // Training load: form (TSB) relative to fitness (CTL). Carrying some fatigue
  // is normal; a spike well above fitness lowers readiness.
  const form = formRatio(load)
  if (load && form != null) {
    add({
      key: 'load', label: 'Training load', score: ramp(form, -0.6, -0.05),
      detail: `form ${load.tsb >= 0 ? '+' : ''}${Math.round(load.tsb)} · fitness ${Math.round(load.ctl)}`,
    })
  }

  const calibratingNights = Math.max(0, BASELINE_NIGHTS - Math.min(hrvHistory.length, rhrHistory.length))
  if (!parts.length) return { score: null, parts, calibratingNights }
  const w = parts.reduce((a, p) => a + p.weight, 0)
  return { score: Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / w), parts, calibratingNights }
}

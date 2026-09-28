// Sleep need, sleep debt and consistency. Pure (unit-tested).
//
// Modelled on WHOOP's published approach: need = baseline + strain + debt − naps.
//   baseline  your sleep target from Settings
//   strain    a hard day costs more sleep: nothing below strain 8, then 6 min
//             per point, up to +60 min at strain 18
//   debt      30 % of the last 7 nights' shortfall against baseline is added
//             back tonight, capped at 90 min, so one bad week doesn't turn
//             into an impossible 11-hour target
//   naps      minus the time napped since the last wake-up (lib/naps.ts)
//
// Consistency compares bed and wake times over the last 4 nights: the mean
// drift between consecutive nights, turned into 0-100 (30 min drift ≈ 92,
// 1 hour ≈ 83).

import type { SleepSession } from './types'

export interface SleepNeed {
  needMin: number
  baselineMin: number
  strainMin: number
  debtMin: number
  napMin: number
  /** Total shortfall over the last 7 nights. */
  weekShortfallMin: number
}

const DEBT_SHARE = 0.3
const DEBT_CAP_MIN = 90

export function strainSleepMin(strain: number | null | undefined): number {
  if (strain == null) return 0
  return Math.round(Math.max(0, Math.min(60, (strain - 8) * 6)))
}

/**
 * Need for the night ending on `night` (the date you woke up). `previous`
 * are earlier nights; only the 7 before `night` count toward debt.
 */
export function sleepNeed(o: {
  baselineMin: number
  night: string
  previous: SleepSession[]
  /** Strain of the day before the night. */
  strain?: number | null
  /** Minutes napped before this night (lib/naps.ts napCreditMin). */
  napMin?: number
}): SleepNeed {
  const before = o.previous
    .filter(n => n.night < o.night)
    .sort((a, b) => b.night.localeCompare(a.night))
    .slice(0, 7)
  const weekShortfallMin = before.reduce((a, n) => a + Math.max(0, o.baselineMin - n.asleep_min), 0)
  const debtMin = Math.round(Math.min(DEBT_CAP_MIN, weekShortfallMin * DEBT_SHARE))
  const strainMin = strainSleepMin(o.strain)
  const napMin = Math.max(0, Math.round(o.napMin ?? 0))
  return {
    // A nap never takes need below two-thirds of baseline.
    needMin: Math.max(Math.round(o.baselineMin * 0.67), o.baselineMin + strainMin + debtMin - napMin),
    napMin,
    baselineMin: o.baselineMin,
    strainMin,
    debtMin,
    weekShortfallMin: Math.round(weekShortfallMin),
  }
}

/** Minutes after noon, so 23:30 and 00:30 are an hour apart, not 23. */
function minutesFromNoon(iso: string): number {
  const d = new Date(iso)
  const m = d.getHours() * 60 + d.getMinutes() - 12 * 60
  return m < 0 ? m + 24 * 60 : m
}

/** 0-100 from bed and wake time drift across the last 4 nights (including `night`). */
export function sleepConsistency(nights: SleepSession[], night: string): number | null {
  const window = nights
    .filter(n => n.night <= night)
    .sort((a, b) => a.night.localeCompare(b.night))
    .slice(-4)
  if (window.length < 2) return null
  const drift: number[] = []
  for (let i = 1; i < window.length; i++) {
    drift.push(Math.abs(minutesFromNoon(window[i].start_at) - minutesFromNoon(window[i - 1].start_at)))
    drift.push(Math.abs(minutesFromNoon(window[i].end_at) - minutesFromNoon(window[i - 1].end_at)))
  }
  const mean = drift.reduce((a, b) => a + b, 0) / drift.length
  return Math.round(Math.max(0, Math.min(100, 100 - mean * 0.28)))
}

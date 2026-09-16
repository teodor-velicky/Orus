// Training load across runs, gym and other workouts: fitness (CTL),
// fatigue (ATL) and form (TSB). Pure.

import { addDays, fromIso, localIso } from '../format'

export interface LoadEvent { date: string; load: number }

export interface LoadDay { date: string; load: number; atl: number; ctl: number; tsb: number }

/**
 * Load estimate for a run without heart rate: minutes × an intensity factor
 * from speed relative to threshold speed, calibrated so it lands on the same
 * scale as TRIMP (easy hour ≈ 80, threshold hour ≈ 190).
 */
export function runLoadNoHr(durationS: number, paceS: number, thresholdPaceS: number | null): number {
  const min = durationS / 60
  if (!thresholdPaceS || !paceS) return Math.round(min * 1.4)
  const r = thresholdPaceS / paceS // speed ratio
  const f = 0.9 + 2.3 * Math.max(0, Math.min(1, (r - 0.7) / 0.3)) ** 1.6
  return Math.round(min * f)
}

/** Strength sessions: ~1 load/min (moderate), capped; falls back to set count. */
export function gymLoad(durationS: number | null, sets: number): number {
  if (durationS && durationS > 300) return Math.round(Math.min(120, durationS / 60))
  return Math.round(sets * 2.5)
}

/**
 * Daily EWMA: ATL over 7 days, CTL over 42. Starts from zero at the first
 * date, so pass ≥ 6 weeks of history for a meaningful CTL.
 */
export function fitnessSeries(events: LoadEvent[], from: string, to: string): LoadDay[] {
  const byDate = new Map<string, number>()
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.load)
  const ka = 1 - Math.exp(-1 / 7)
  const kc = 1 - Math.exp(-1 / 42)
  const out: LoadDay[] = []
  let atl = 0, ctl = 0
  for (let d = fromIso(from); localIso(d) <= to; d = addDays(d, 1)) {
    const date = localIso(d)
    const load = byDate.get(date) ?? 0
    // Form is yesterday's fitness minus yesterday's fatigue (before today's load).
    const tsb = ctl - atl
    atl += (load - atl) * ka
    ctl += (load - ctl) * kc
    out.push({ date, load, atl: Math.round(atl * 10) / 10, ctl: Math.round(ctl * 10) / 10, tsb: Math.round(tsb * 10) / 10 })
  }
  return out
}

/** TSB normalised by fitness; ≈ 0 fresh-ish, < −0.3 loaded, < −0.5 overreaching. */
export function formRatio(day: LoadDay | undefined): number | null {
  if (!day || day.ctl < 5) return null
  return Math.round((day.tsb / Math.max(day.ctl, 15)) * 100) / 100
}

export function formLabel(ratio: number | null): { label: string; detail: string } {
  if (ratio == null) return { label: 'Building', detail: 'A few weeks of training history unlocks fitness and form.' }
  if (ratio > 0.25) return { label: 'Fresh', detail: 'Well rested — good for a race or a key session. Long stretches here lose fitness.' }
  if (ratio > -0.1) return { label: 'Balanced', detail: 'Training and recovery are in balance.' }
  if (ratio > -0.35) return { label: 'Productive', detail: 'Carrying useful fatigue — this is where fitness is built.' }
  if (ratio > -0.55) return { label: 'Loaded', detail: 'Fatigue is high. Keep easy days easy and sleep well.' }
  return { label: 'Overreaching', detail: 'Load has spiked above fitness. Take 1–2 easy days.' }
}

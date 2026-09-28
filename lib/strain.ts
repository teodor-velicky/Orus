// Day strain on WHOOP's 0-21 scale, and a strain target from readiness.
// Pure (unit-tested).
//
// Cardiovascular load is Banister TRIMP from the ring's heart rate over the
// whole day, so a walk to work and a busy afternoon count, not only logged
// workouts. Strength sessions add their load (the ring can't see muscular
// work in heart rate), and runs or workouts recorded by another device add
// theirs when the ring has no heart rate for that time.
//
// TRIMP maps to 0-21 on a log curve, like WHOOP's: every point is harder to
// earn than the last. Calibrated so an easy hour's run (~80 TRIMP) is ~12
// and a very hard day (~400) is ~19.5.

import type { Sex } from './nutrients'

export interface StrainMinute {
  minute: string
  hr_avg: number | null
}

export interface StrainEvent {
  start: number
  end: number
  load: number
  /** Strength work: its load is muscular, so heart rate never covers it. */
  muscular?: boolean
}

export interface DayStrain {
  strain: number
  cardioLoad: number
  otherLoad: number
  /** Minutes spent above 50 % of heart-rate reserve. */
  activeMin: number
}

const A = 4.886
const B = 7.5

export const strainFromLoad = (load: number) =>
  Math.round(Math.min(21, Math.max(0, A * Math.log(1 + Math.max(0, load) / B))) * 10) / 10

/**
 * Heart-rate reserve below which time doesn't count. Sitting and ordinary
 * daily life sit around 10-20 % of reserve; summing TRIMP over a whole day of
 * that makes a desk day look like a workout. 30 % is roughly a brisk walk,
 * which is where WHOOP's first heart-rate zone starts to count too.
 */
const MIN_HRR = 0.3

/** Longest a single heart-rate sample is allowed to stand for. */
const MAX_SAMPLE_MIN = 10

export function dayStrain(o: {
  minutes: StrainMinute[]
  events?: StrainEvent[]
  restingHr: number
  maxHr: number
  sex: Sex | null | undefined
  dayStart: Date
  now?: Date
}): DayStrain {
  const start = o.dayStart.getTime()
  const end = Math.min(start + 86_400_000, (o.now ?? new Date()).getTime())
  const [a, b] = o.sex === 'female' ? [0.86, 1.67] : [0.64, 1.92]
  const samples = o.minutes
    .filter(m => m.hr_avg != null && m.hr_avg > 30 && m.hr_avg < 230)
    .map(m => ({ t: new Date(m.minute).getTime(), hr: m.hr_avg! }))
    .filter(s => s.t >= start && s.t < end)
    .sort((x, y) => x.t - y.t)

  let cardioLoad = 0, activeMin = 0
  samples.forEach((s, i) => {
    const next = samples[i + 1]?.t ?? Math.min(end, s.t + 5 * 60_000)
    const dur = Math.min(MAX_SAMPLE_MIN, Math.max(1, (next - s.t) / 60_000))
    const hrr = Math.max(0, Math.min(1, (s.hr - o.restingHr) / (o.maxHr - o.restingHr)))
    if (hrr >= MIN_HRR) cardioLoad += dur * hrr * a * Math.exp(b * hrr)
    if (hrr >= 0.5) activeMin += dur
  })

  // Ring coverage of an event: share of its 5-minute slots with a heart-rate sample.
  const covered = (e: StrainEvent) => {
    const slots = Math.max(1, Math.round((e.end - e.start) / 300_000))
    const hit = new Set(samples.filter(s => s.t >= e.start && s.t < e.end).map(s => Math.floor((s.t - e.start) / 300_000)))
    return hit.size / slots
  }
  const otherLoad = (o.events ?? [])
    .filter(e => e.start >= start && e.start < end)
    .filter(e => e.muscular || covered(e) < 0.5)
    .reduce((acc, e) => acc + e.load, 0)

  return {
    strain: strainFromLoad(cardioLoad + otherLoad),
    cardioLoad: Math.round(cardioLoad),
    otherLoad: Math.round(otherLoad),
    activeMin: Math.round(activeMin),
  }
}

export interface StrainTarget {
  lo: number
  hi: number
  label: string
  detail: string
}

/** WHOOP's colour bands: 67+ green, 34-66 yellow, 33 and under red. */
export function strainTarget(readiness: number | null): StrainTarget | null {
  if (readiness == null) return null
  if (readiness >= 67) return { lo: 14, hi: 18, label: 'Push', detail: 'Recovered: a hard session or a long day is well within reach.' }
  if (readiness >= 34) return { lo: 10, hi: 14, label: 'Maintain', detail: 'Train as planned but keep the intensity honest.' }
  return { lo: 0, hi: 10, label: 'Restore', detail: 'Keep it light. Walking and mobility help more than a workout today.' }
}

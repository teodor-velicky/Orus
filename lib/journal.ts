// Behaviour journal: what you did on a day, and what it did to the night
// after. Pure (unit-tested).
//
// Some behaviours you answer (alcohol, late caffeine...). Others Orus reads
// from data it already has: a meal logged within two hours of bed, training
// within three hours of bed, a high-strain day.
//
// Effects compare the nights after "yes" days with the nights after "no" days:
// next-morning HRV, resting heart rate, sleep duration and deep + REM share.
// A behaviour needs at least 3 of each before Orus says anything, and an
// effect is only called out when it's big enough to matter (HRV ±8 %,
// resting HR ±2 bpm, sleep ±20 min, deep + REM ±3 points).

import { addDays, avg, fromIso, localIso } from './format'
import type { DailyMetrics, SleepSession } from './types'

export type BehaviorKey =
  | 'alcohol' | 'late_caffeine' | 'stress' | 'screens_in_bed' | 'ill' | 'travel' | 'sauna' | 'meditation'
  | 'late_meal' | 'late_training' | 'high_strain'

export interface Behavior {
  key: BehaviorKey
  label: string
  /** Ionicons name */
  icon: string
  /** Answered by you, or worked out from your data. */
  auto: boolean
}

export const BEHAVIORS: Behavior[] = [
  { key: 'alcohol', label: 'Alcohol', icon: 'wine-outline', auto: false },
  { key: 'late_caffeine', label: 'Caffeine after 2 pm', icon: 'cafe-outline', auto: false },
  { key: 'stress', label: 'High stress', icon: 'thunderstorm-outline', auto: false },
  { key: 'screens_in_bed', label: 'Phone in bed', icon: 'phone-portrait-outline', auto: false },
  { key: 'ill', label: 'Feeling ill', icon: 'thermometer-outline', auto: false },
  { key: 'travel', label: 'Travelled', icon: 'airplane-outline', auto: false },
  { key: 'sauna', label: 'Sauna or hot bath', icon: 'flame-outline', auto: false },
  { key: 'meditation', label: 'Meditation or breathwork', icon: 'leaf-outline', auto: false },
  { key: 'late_meal', label: 'Ate within 2 h of bed', icon: 'restaurant-outline', auto: true },
  { key: 'late_training', label: 'Trained within 3 h of bed', icon: 'barbell-outline', auto: true },
  { key: 'high_strain', label: 'Strain above 14', icon: 'flash-outline', auto: true },
]

export const MANUAL_BEHAVIORS = BEHAVIORS.filter(b => !b.auto)
export const behaviorLabel = (k: BehaviorKey) => BEHAVIORS.find(b => b.key === k)?.label ?? k

export type Answers = Partial<Record<BehaviorKey, boolean>>

export interface AutoDetail { value: boolean; detail: string }

/**
 * Behaviours Orus can work out for `date`. `bedtime` is when the night after
 * started (null if it hasn't happened yet: nothing "late" can be known then).
 */
export function autoBehaviors(o: {
  mealTimes: number[]
  trainingEnds: number[]
  bedtime: number | null
  strain: number | null
}): Partial<Record<BehaviorKey, AutoDetail>> {
  const out: Partial<Record<BehaviorKey, AutoDetail>> = {}
  const clock = (t: number) => {
    const d = new Date(t)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (o.bedtime != null) {
    const lastMeal = o.mealTimes.filter(t => t < o.bedtime!).sort((a, b) => b - a)[0]
    if (lastMeal != null) {
      const gap = (o.bedtime - lastMeal) / 60_000
      out.late_meal = { value: gap < 120, detail: `last meal ${clock(lastMeal)}, ${Math.round(gap / 6) / 10} h before bed` }
    }
    const lastTraining = o.trainingEnds.filter(t => t < o.bedtime!).sort((a, b) => b - a)[0]
    out.late_training = lastTraining != null
      ? { value: (o.bedtime - lastTraining) / 60_000 < 180, detail: `finished ${clock(lastTraining)}` }
      : { value: false, detail: 'no training' }
  }
  if (o.strain != null) out.high_strain = { value: o.strain > 14, detail: `strain ${o.strain.toFixed(1)}` }
  return out
}

export interface DayRecord {
  date: string
  answers: Answers
}

export interface Outcome {
  metric: 'hrv' | 'rhr' | 'sleep' | 'restorative'
  label: string
  yes: number
  no: number
  diff: number
  diffText: string
  /** Whether "yes" nights were better on this metric. */
  better: boolean
  notable: boolean
}

export interface Effect {
  key: BehaviorKey
  label: string
  yesN: number
  noN: number
  outcomes: Outcome[]
  /** e.g. "HRV 14% lower, resting HR 4 bpm higher" — only notable outcomes. */
  summary: string | null
  /** Net direction across notable outcomes: helps, hurts, or no clear effect. */
  verdict: 'hurts' | 'helps' | 'neutral'
}

const MIN_EACH = 3

export function journalEffects(o: {
  days: DayRecord[]
  nights: SleepSession[]
  metrics: DailyMetrics[]
}): Effect[] {
  const nightAfter = (d: string) => localIso(addDays(fromIso(d), 1))
  const kind = [...o.metrics].reverse().find(m => m.hrv_ms != null)?.hrv_kind
  const outcomesFor = (d: string) => {
    const next = nightAfter(d)
    const m = o.metrics.find(x => x.date === next)
    const n = o.nights.find(x => x.night === next)
    return {
      hrv: m?.hrv_ms != null && m.hrv_kind === kind ? m.hrv_ms : null,
      rhr: m?.resting_hr ?? null,
      sleep: n?.asleep_min ?? null,
      restorative: n && n.deep_min + n.rem_min + n.core_min > 0 ? ((n.deep_min + n.rem_min) / Math.max(1, n.asleep_min)) * 100 : null,
    }
  }

  const effects: Effect[] = []
  for (const b of BEHAVIORS) {
    const yes = o.days.filter(d => d.answers[b.key] === true)
    const no = o.days.filter(d => d.answers[b.key] === false)
    if (yes.length < MIN_EACH || no.length < MIN_EACH) continue
    const oy = yes.map(d => outcomesFor(d.date))
    const on = no.map(d => outcomesFor(d.date))

    const outcomes: Outcome[] = []
    const add = (metric: Outcome['metric'], label: string, higherIsBetter: boolean, threshold: number,
      text: (diff: number, y: number, n: number) => string, relative = false) => {
      const ys = oy.map(x => x[metric]).filter((v): v is number => v != null)
      const ns = on.map(x => x[metric]).filter((v): v is number => v != null)
      if (ys.length < MIN_EACH || ns.length < MIN_EACH) return
      const y = avg(ys)!, n = avg(ns)!
      const diff = y - n
      const size = relative ? (Math.abs(diff) / Math.max(1e-9, n)) * 100 : Math.abs(diff)
      outcomes.push({ metric, label, yes: y, no: n, diff, diffText: text(diff, y, n), better: (diff > 0) === higherIsBetter, notable: size >= threshold })
    }
    add('hrv', 'HRV', true, 8, (d, _y, n) => `HRV ${Math.round((Math.abs(d) / n) * 100)}% ${d < 0 ? 'lower' : 'higher'}`, true)
    add('rhr', 'Resting HR', false, 2, d => `resting HR ${Math.abs(d).toFixed(1)} bpm ${d > 0 ? 'higher' : 'lower'}`)
    add('sleep', 'Sleep', true, 20, d => `${Math.round(Math.abs(d))} min ${d < 0 ? 'less' : 'more'} sleep`)
    add('restorative', 'Deep + REM', true, 3, d => `${Math.round(Math.abs(d))} points ${d < 0 ? 'less' : 'more'} deep + REM`)
    if (!outcomes.length) continue

    const notable = outcomes.filter(x => x.notable)
    const score = notable.reduce((a, x) => a + (x.better ? 1 : -1), 0)
    effects.push({
      key: b.key, label: b.label, yesN: yes.length, noN: no.length, outcomes,
      summary: notable.length ? notable.map(x => x.diffText).join(', ') : null,
      verdict: score < 0 ? 'hurts' : score > 0 ? 'helps' : 'neutral',
    })
  }
  // Clearest effects first.
  const weight = (e: Effect) => e.outcomes.filter(x => x.notable).length
  return effects.sort((a, b) => weight(b) - weight(a))
}

/** How many more answered days a behaviour needs before it can be analysed. */
export function daysUntilInsight(days: DayRecord[], key: BehaviorKey): number {
  const yes = days.filter(d => d.answers[key] === true).length
  const no = days.filter(d => d.answers[key] === false).length
  return Math.max(0, MIN_EACH - yes) + Math.max(0, MIN_EACH - no)
}

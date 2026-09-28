// This week vs last week, and a few plain-language notes. Pure (unit-tested).
//
// Every note comes from a threshold you can read below, not from a model, so
// the same numbers always produce the same advice.

import { addDays, avg, fromIso, localIso } from './format'
import type { DailyMetrics, SleepSession } from './types'

export type TrendKey = 'rhr' | 'hrv' | 'sleep' | 'steps' | 'food'

export interface Trend {
  key: TrendKey
  label: string
  current: number | null
  previous: number | null
  /** current - previous, in the metric's own unit. */
  delta: number | null
  /** true when the change is an improvement, false when worse, null when flat or unknown. */
  better: boolean | null
  text: string
  deltaText: string | null
}

export interface HealthNote {
  tone: 'good' | 'watch' | 'info'
  text: string
}

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`

/** Dates [from, to] inclusive, `days` long, ending `endOffset` days before `today`. */
function span(today: string, days: number, endOffset: number) {
  const end = addDays(fromIso(today), -endOffset)
  return { from: localIso(addDays(end, -(days - 1))), to: localIso(end) }
}

const inSpan = (d: string, s: { from: string; to: string }) => d >= s.from && d <= s.to

export function weeklyTrends(o: {
  metrics: DailyMetrics[]
  nights: SleepSession[]
  /** Food quality per day (only days with at least one meal). */
  food: { date: string; quality: number }[]
  today?: string
}): Trend[] {
  const today = o.today ?? localIso()
  const cur = span(today, 7, 0)
  const prev = span(today, 7, 7)
  const kind = [...o.metrics].reverse().find(m => m.hrv_ms != null)?.hrv_kind

  const mean = (rows: (number | null | undefined)[]) => {
    const v = avg(rows)
    return v == null ? null : v
  }
  const pick = <T,>(rows: T[], date: (r: T) => string, s: { from: string; to: string }) => rows.filter(r => inSpan(date(r), s))

  const trend = (key: TrendKey, label: string, c: number | null, p: number | null, o2: {
    higherIsBetter: boolean; flat: number; fmt: (v: number) => string; fmtDelta: (d: number) => string
  }): Trend => {
    const delta = c != null && p != null ? c - p : null
    const better = delta == null || Math.abs(delta) < o2.flat ? null : (delta > 0) === o2.higherIsBetter
    return {
      key, label, current: c, previous: p, delta, better,
      text: c != null ? o2.fmt(c) : '—',
      deltaText: delta != null && Math.abs(delta) >= o2.flat ? o2.fmtDelta(delta) : delta != null ? 'steady' : null,
    }
  }
  const signed = (d: number, unit: string, digits = 0) => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}${unit}`

  const rhrC = mean(pick(o.metrics, m => m.date, cur).map(m => m.resting_hr))
  const rhrP = mean(pick(o.metrics, m => m.date, prev).map(m => m.resting_hr))
  const hrvRows = o.metrics.filter(m => m.hrv_kind === kind)
  const hrvC = mean(pick(hrvRows, m => m.date, cur).map(m => m.hrv_ms))
  const hrvP = mean(pick(hrvRows, m => m.date, prev).map(m => m.hrv_ms))
  const sleepC = mean(pick(o.nights, n => n.night, cur).map(n => n.asleep_min))
  const sleepP = mean(pick(o.nights, n => n.night, prev).map(n => n.asleep_min))
  const stepsC = mean(pick(o.metrics, m => m.date, cur).map(m => m.steps))
  const stepsP = mean(pick(o.metrics, m => m.date, prev).map(m => m.steps))
  const foodC = mean(pick(o.food, f => f.date, cur).map(f => f.quality))
  const foodP = mean(pick(o.food, f => f.date, prev).map(f => f.quality))

  return [
    trend('rhr', 'Resting HR', rhrC, rhrP, { higherIsBetter: false, flat: 1, fmt: v => `${Math.round(v)} bpm`, fmtDelta: d => signed(d, ' bpm') }),
    trend('hrv', 'HRV', hrvC, hrvP, { higherIsBetter: true, flat: 2, fmt: v => `${Math.round(v)} ms`, fmtDelta: d => signed(d, ' ms') }),
    trend('sleep', 'Sleep', sleepC, sleepP, { higherIsBetter: true, flat: 10, fmt: hm, fmtDelta: d => `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d))}m` }),
    trend('steps', 'Steps', stepsC, stepsP, {
      higherIsBetter: true, flat: 500, fmt: v => Math.round(v).toLocaleString('en-US'),
      fmtDelta: d => signed(d / 1000, 'k', 1),
    }),
    trend('food', 'Food quality', foodC, foodP, { higherIsBetter: true, flat: 3, fmt: v => String(Math.round(v)), fmtDelta: d => signed(d, '') }),
  ]
}

/** Up to three notes, concerns first. */
export function healthNotes(trends: Trend[], o: { sleepTargetMin: number; stepsTarget?: number }): HealthNote[] {
  const t = Object.fromEntries(trends.map(x => [x.key, x])) as Record<TrendKey, Trend>
  const notes: HealthNote[] = []

  if (t.rhr.delta != null && t.rhr.delta >= 3) {
    notes.push({ tone: 'watch', text: `Resting heart rate is ${Math.round(t.rhr.delta)} bpm above last week. Common causes: hard training, poor sleep, alcohol, stress or an oncoming cold. An easy day helps you tell which.` })
  }
  if (t.hrv.delta != null && t.hrv.previous && t.hrv.delta / t.hrv.previous <= -0.1) {
    notes.push({ tone: 'watch', text: `HRV is ${Math.round((-t.hrv.delta / t.hrv.previous) * 100)}% below last week, a sign your body is under more strain than usual.` })
  }
  if (t.sleep.current != null && t.sleep.current < o.sleepTargetMin - 45) {
    notes.push({ tone: 'watch', text: `Averaging ${hm(t.sleep.current)} a night, ${hm(o.sleepTargetMin - t.sleep.current)} short of your target. Sleep is the biggest single lever on readiness.` })
  }
  if (t.hrv.delta != null && t.hrv.previous && t.hrv.delta / t.hrv.previous >= 0.1 && (t.rhr.delta ?? 0) <= 0) {
    notes.push({ tone: 'good', text: `HRV is up ${Math.round((t.hrv.delta / t.hrv.previous) * 100)}% on last week with resting heart rate steady or lower. You are recovering well.` })
  }
  if (t.food.current != null && t.food.current >= 75) {
    notes.push({ tone: 'good', text: `Food quality is averaging ${Math.round(t.food.current)} this week. Keep the variety up.` })
  } else if (t.food.current != null && t.food.current < 55) {
    notes.push({ tone: 'watch', text: `Food quality is averaging ${Math.round(t.food.current)}. More whole foods and plants would lift it and your gut and metabolic scores with it.` })
  }
  const stepsTarget = o.stepsTarget ?? 8000
  if (t.steps.current != null && t.steps.current < stepsTarget * 0.6) {
    notes.push({ tone: 'info', text: `About ${Math.round(t.steps.current).toLocaleString('en-US')} steps a day. A 20-minute walk adds roughly 2,500.` })
  }

  const order = { watch: 0, good: 1, info: 2 }
  return notes.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 3)
}

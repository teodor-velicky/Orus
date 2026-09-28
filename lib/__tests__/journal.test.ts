import assert from 'node:assert/strict'
import { detectNaps, mergeNaps, napCreditMin } from '../naps'
import { sleepNeed } from '../sleep'
import { autoBehaviors, daysUntilInsight, DayRecord, journalEffects } from '../journal'
import type { DailyMetrics, SleepSession } from '../types'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name) }

const day = new Date(2026, 8, 27)
const at = (h: number, m = 0) => day.getTime() + (h * 60 + m) * 60_000
const iso = (t: number) => new Date(t).toISOString()

// ─── Naps ───

test('a 40-minute afternoon stretch at sleeping heart rate is a nap', () => {
  const minutes = [
    ...Array.from({ length: 12 }, (_, i) => ({ minute: iso(at(13) + i * 5 * 60_000), hr_avg: 72, steps: null })),
    ...Array.from({ length: 8 }, (_, i) => ({ minute: iso(at(14) + i * 5 * 60_000), hr_avg: 54, steps: null })),
    ...Array.from({ length: 6 }, (_, i) => ({ minute: iso(at(14, 40) + i * 5 * 60_000), hr_avg: 75, steps: null })),
  ]
  const naps = detectNaps(minutes, 52, day)
  assert.equal(naps.length, 1)
  assert.equal(naps[0].start, at(14))
  assert.equal((naps[0].end - naps[0].start) / 60_000, 40)
})

test('not a nap: calm heart rate while walking, a short dip, or at night', () => {
  const walking: { minute: string; hr_avg: number | null; steps: number | null }[] = Array.from({ length: 8 }, (_, i) => ({ minute: iso(at(15) + i * 5 * 60_000), hr_avg: 54, steps: null }))
  walking.push({ minute: iso(at(15, 15)), hr_avg: null, steps: 400 })
  assert.equal(detectNaps(walking, 52, day).length, 0)
  const short = Array.from({ length: 3 }, (_, i) => ({ minute: iso(at(15) + i * 5 * 60_000), hr_avg: 54, steps: null }))
  assert.equal(detectNaps(short, 52, day).length, 0)
  const night = Array.from({ length: 12 }, (_, i) => ({ minute: iso(at(2) + i * 5 * 60_000), hr_avg: 50, steps: null }))
  assert.equal(detectNaps(night, 52, day).length, 0)
  assert.equal(detectNaps(walking, null, day).length, 0)
})

test('naps from the ring and by hand merge; credit is capped at 90 minutes', () => {
  const merged = mergeNaps([{ start: at(14), end: at(14, 40) }, { start: at(14, 30), end: at(15) }])
  assert.deepEqual(merged, [{ start: at(14), end: at(15) }])
  assert.equal(napCreditMin(merged, at(7), at(23)), 60)
  assert.equal(napCreditMin([{ start: at(12), end: at(15) }], at(7), at(23)), 90)
  // A nap after bedtime belongs to the next night, not this one
  assert.equal(napCreditMin([{ start: at(14), end: at(15) }], at(7), at(13)), 0)
})

test('a nap lowers that night\'s sleep need, never below two thirds of baseline', () => {
  assert.equal(sleepNeed({ baselineMin: 480, night: '2026-09-28', previous: [], napMin: 30 }).needMin, 450)
  assert.equal(sleepNeed({ baselineMin: 480, night: '2026-09-28', previous: [], napMin: 300 }).needMin, 322)
})

// ─── Journal ───

test('late meal, late training and high strain are detected from data', () => {
  const a = autoBehaviors({ mealTimes: [at(12), at(21, 40)], trainingEnds: [at(18)], bedtime: at(23), strain: 15.2 })
  assert.equal(a.late_meal!.value, true)
  assert.match(a.late_meal!.detail, /21:40, 1.3 h before bed/)
  assert.equal(a.late_training!.value, false)
  assert.equal(a.high_strain!.value, true)
  // Before the night has happened, nothing can be "late" yet
  assert.equal(autoBehaviors({ mealTimes: [at(21)], trainingEnds: [], bedtime: null, strain: null }).late_meal, undefined)
})

const metric = (date: string, hrv: number, rhr: number): DailyMetrics => ({
  user_id: 'u', date, steps: null, active_kcal: null, basal_kcal: null, exercise_min: null, distance_m: null,
  resting_hr: rhr, hr_avg: null, hr_min: null, hr_max: null, hrv_ms: hrv, hrv_kind: 'rmssd', respiratory_rate: null,
  spo2_pct: null, vo2max: null, weight_kg: null, body_fat_pct: null, sources: [],
})
const sleepOn = (date: string, asleep: number, deep: number): SleepSession => ({
  user_id: 'u', night: date, source: 'R09', start_at: '', end_at: '', in_bed_min: asleep + 15, asleep_min: asleep,
  awake_min: 15, core_min: asleep - deep - 90, deep_min: deep, rem_min: 90, stages: [],
})

test('alcohol nights show lower HRV and higher resting HR', () => {
  // Days 1-10 of September: alcohol on 2, 4, 6, 8; nights after show the hit
  const days: DayRecord[] = []
  const metrics: DailyMetrics[] = []
  const nights: SleepSession[] = []
  for (let d = 1; d <= 10; d++) {
    const date = `2026-09-${String(d).padStart(2, '0')}`
    const next = `2026-09-${String(d + 1).padStart(2, '0')}`
    const drank = d % 2 === 0 && d <= 8
    days.push({ date, answers: { alcohol: drank, meditation: d <= 2 } })
    metrics.push(metric(next, drank ? 44 : 58, drank ? 57 : 52))
    nights.push(sleepOn(next, drank ? 410 : 450, drank ? 50 : 80))
  }
  const effects = journalEffects({ days, nights, metrics })
  const alcohol = effects.find(e => e.key === 'alcohol')!
  assert.equal(alcohol.yesN, 4)
  assert.equal(alcohol.noN, 6)
  assert.equal(alcohol.verdict, 'hurts')
  assert.match(alcohol.summary!, /HRV 24% lower/)
  assert.match(alcohol.summary!, /resting HR 5.0 bpm higher/)
  // Meditation has only 2 "yes" days: not enough to say anything yet
  assert.equal(effects.find(e => e.key === 'meditation'), undefined)
  assert.equal(daysUntilInsight(days, 'meditation'), 1)
})

console.log(`\n${passed} passed`)

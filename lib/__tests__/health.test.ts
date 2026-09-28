import assert from 'node:assert/strict'
import { bmr, energyForDay, keytelPerMinute } from '../energy'
import { readiness, sleepScore, typicalRmssd } from '../readiness'
import { healthNotes, weeklyTrends } from '../insights'
import type { DailyMetrics, SleepSession } from '../types'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name) }

const body = { weightKg: 78, heightCm: 182, age: 27, sex: 'male' as const }

// ─── Energy ───

test('BMR (Mifflin-St Jeor)', () => {
  assert.equal(bmr(body), 1788)
  assert.equal(bmr({ weightKg: 60, heightCm: 168, age: 25, sex: 'female' }), 1364)
})

test('a quiet day burns about the BMR', () => {
  const dayStart = new Date(2026, 8, 27)
  const minutes = Array.from({ length: 288 }, (_, i) => ({
    minute: new Date(dayStart.getTime() + i * 5 * 60_000).toISOString(), hr_avg: 62, steps: null,
  }))
  const e = energyForDay({ minutes, body, restingHr: 55, dayStart, now: new Date(dayStart.getTime() + 86_400_000) })
  assert.equal(e.active, 0)
  assert.equal(e.total, 1788)
  assert.equal(e.hrCoverage, 1)
})

test('a hard half hour counts from heart rate, not twice with steps', () => {
  const dayStart = new Date(2026, 8, 27)
  const runStart = dayStart.getTime() + 18 * 3600_000
  const minutes = [
    // 30 minutes at 150 bpm, logged every 5 minutes
    ...Array.from({ length: 6 }, (_, i) => ({ minute: new Date(runStart + i * 5 * 60_000).toISOString(), hr_avg: 150, steps: null })),
    // The ring's step history for the same two quarter hours
    { minute: new Date(runStart).toISOString(), hr_avg: null, steps: 2400 },
    { minute: new Date(runStart + 15 * 60_000).toISOString(), hr_avg: null, steps: 2400 },
  ]
  const e = energyForDay({ minutes, body, restingHr: 55, dayStart, now: new Date(dayStart.getTime() + 86_400_000) })
  const perMin = keytelPerMinute(150, body) - 1788 / 1440
  assert.ok(Math.abs(e.fromHr - perMin * 30) < 2, `fromHr ${e.fromHr}`)
  assert.ok(e.fromSteps > 0 && e.fromSteps < e.fromHr)
  // Active takes the larger per window, it doesn't add them
  assert.equal(e.active, e.fromHr)
  assert.equal(e.steps, 4800)
})

test('walking without a raised heart rate counts from steps', () => {
  const dayStart = new Date(2026, 8, 27)
  const t = dayStart.getTime() + 10 * 3600_000
  const e = energyForDay({
    minutes: [{ minute: new Date(t).toISOString(), hr_avg: 85, steps: 1500 }],
    body, restingHr: 55, dayStart, now: new Date(dayStart.getTime() + 86_400_000),
  })
  assert.equal(e.fromHr, 0)
  assert.equal(e.active, Math.round(1500 * 0.00057 * 78))
})

test('today is prorated: basal so far only', () => {
  const dayStart = new Date(2026, 8, 27)
  const e = energyForDay({ minutes: [], body, restingHr: 55, dayStart, now: new Date(dayStart.getTime() + 12 * 3600_000) })
  assert.equal(e.basal, 894)
})

// ─── Readiness ───

const day = (date: string, o: Partial<DailyMetrics> = {}): DailyMetrics => ({
  user_id: 'u', date, steps: null, active_kcal: null, basal_kcal: null, exercise_min: null, distance_m: null,
  resting_hr: null, hr_avg: null, hr_min: null, hr_max: null, hrv_ms: null, respiratory_rate: null, spo2_pct: null,
  vo2max: null, weight_kg: null, body_fat_pct: null, sources: [], ...o,
})

const night = (o: Partial<SleepSession> = {}): SleepSession => ({
  user_id: 'u', night: '2026-09-28', source: 'R09', start_at: '', end_at: '',
  in_bed_min: 500, asleep_min: 460, awake_min: 40, core_min: 280, deep_min: 80, rem_min: 100, stages: [], ...o,
})

test('sleep score rewards duration, efficiency and deep + REM', () => {
  const good = sleepScore(night(), 480).score
  const short = sleepScore(night({ asleep_min: 272, in_bed_min: 300, deep_min: 40, rem_min: 50, core_min: 182 }), 480).score
  assert.ok(good >= 90, `good ${good}`)
  assert.ok(short < 40, `short ${short}`)
})

test('a new user still gets HRV and resting HR, marked as provisional', () => {
  const r = readiness(night(), [day('2026-09-28', { hrv_ms: 52, hrv_kind: 'rmssd', resting_hr: 54 })], 480, '2026-09-28', undefined, { age: 27 })
  const hrv = r.parts.find(p => p.key === 'hrv')!
  const rhr = r.parts.find(p => p.key === 'rhr')!
  assert.equal(hrv.provisional, true)
  assert.equal(rhr.provisional, true)
  assert.equal(hrv.weight, 0.125)
  assert.equal(r.calibratingNights, 5)
  assert.ok(r.score! > 60)
  assert.equal(typicalRmssd(27), 48.4)
})

test('with five nights of history the personal baseline takes over', () => {
  const hist = ['22', '23', '24', '25', '26', '27'].map(d => day(`2026-09-${d}`, { hrv_ms: 60, hrv_kind: 'rmssd', resting_hr: 52 }))
  const r = readiness(night(), [...hist, day('2026-09-28', { hrv_ms: 45, hrv_kind: 'rmssd', resting_hr: 58 })], 480, '2026-09-28')
  const hrv = r.parts.find(p => p.key === 'hrv')!
  assert.equal(hrv.provisional, undefined)
  assert.equal(hrv.weight, 0.25)
  assert.ok(hrv.score < 10, `hrv ${hrv.score}`) // 75 % of baseline
  assert.ok(r.parts.find(p => p.key === 'rhr')!.score < 20)
  assert.equal(r.calibratingNights, 0)
})

test('food quality and skin temperature feed readiness', () => {
  const r = readiness(undefined, [day('2026-09-28', { skin_temp_delta_c: 0.9 })], 480, '2026-09-28', undefined, { foodQuality: 82 })
  assert.equal(r.parts.find(p => p.key === 'food')!.score, 82)
  assert.ok(r.parts.find(p => p.key === 'temp')!.score < 40)
  // Apple Health SDNN is never judged against the RMSSD age norm
  const sdnn = readiness(undefined, [day('2026-09-28', { hrv_ms: 30, hrv_kind: 'sdnn' })], 480, '2026-09-28', undefined, { age: 27 })
  assert.equal(sdnn.parts.find(p => p.key === 'hrv'), undefined)
})

// ─── Insights ───

test('weekly trends and notes', () => {
  const metrics = [
    ...['14', '15', '16', '17', '18', '19', '20'].map(d => day(`2026-09-${d}`, { resting_hr: 52, hrv_ms: 60, hrv_kind: 'rmssd', steps: 9000 })),
    ...['21', '22', '23', '24', '25', '26', '27'].map(d => day(`2026-09-${d}`, { resting_hr: 57, hrv_ms: 50, hrv_kind: 'rmssd', steps: 4000 })),
  ]
  const nights = ['21', '22', '23', '24', '25', '26', '27'].map(d => night({ night: `2026-09-${d}`, asleep_min: 330 }))
  const trends = weeklyTrends({ metrics, nights, food: [{ date: '2026-09-25', quality: 81 }], today: '2026-09-27' })
  const rhr = trends.find(t => t.key === 'rhr')!
  assert.equal(rhr.delta, 5)
  assert.equal(rhr.better, false)
  assert.equal(rhr.deltaText, '+5 bpm')
  assert.equal(trends.find(t => t.key === 'hrv')!.better, false)
  assert.equal(trends.find(t => t.key === 'steps')!.deltaText, '−5.0k')

  const notes = healthNotes(trends, { sleepTargetMin: 480 })
  assert.equal(notes.length, 3)
  assert.ok(notes.every(n => n.tone === 'watch'), JSON.stringify(notes))
  assert.match(notes[0].text, /Resting heart rate is 5 bpm above/)
})

console.log(`\n${passed} passed`)

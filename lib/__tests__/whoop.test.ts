import assert from 'node:assert/strict'
import { sleepConsistency, sleepNeed, strainSleepMin } from '../sleep'
import { dayStrain, strainFromLoad, strainTarget } from '../strain'
import { sleepScore } from '../readiness'
import type { SleepSession } from '../types'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name) }

const night = (date: string, asleep: number, bed: string, wake: string, o: Partial<SleepSession> = {}): SleepSession => {
  const [y, m, d] = date.split('-').map(Number)
  const [bh, bm] = bed.split(':').map(Number)
  const [wh, wm] = wake.split(':').map(Number)
  const start = new Date(y, m - 1, bh >= 12 ? d - 1 : d, bh, bm)
  const end = new Date(y, m - 1, d, wh, wm)
  return {
    user_id: 'u', night: date, source: 'R09', start_at: start.toISOString(), end_at: end.toISOString(),
    in_bed_min: asleep + 20, asleep_min: asleep, awake_min: 20, core_min: asleep * 0.6, deep_min: asleep * 0.18, rem_min: asleep * 0.22, stages: [], ...o,
  }
}

// ─── Sleep need ───

test('strain adds up to an hour of sleep need', () => {
  assert.equal(strainSleepMin(6), 0)
  assert.equal(strainSleepMin(12), 24)
  assert.equal(strainSleepMin(20), 60)
})

test('sleep debt is repaid at 30 %, capped at 90 minutes', () => {
  const short = ['21', '22', '23', '24', '25', '26', '27'].map(d => night(`2026-09-${d}`, 380, '23:30', '06:30'))
  const n = sleepNeed({ baselineMin: 480, night: '2026-09-28', previous: short, strain: 12 })
  assert.equal(n.weekShortfallMin, 700)
  assert.equal(n.debtMin, 90)
  assert.equal(n.strainMin, 24)
  assert.equal(n.needMin, 480 + 24 + 90)
  // A fully rested week adds nothing
  const rested = ['21', '22', '23'].map(d => night(`2026-09-${d}`, 490, '23:00', '07:10'))
  assert.equal(sleepNeed({ baselineMin: 480, night: '2026-09-28', previous: rested }).needMin, 480)
})

test('sleep consistency falls as bed and wake times drift', () => {
  const steady = ['25', '26', '27', '28'].map(d => night(`2026-09-${d}`, 440, '23:00', '07:00'))
  assert.equal(sleepConsistency(steady, '2026-09-28'), 100)
  // Bedtime swings an hour either side of midnight every night
  const wild = [
    night('2026-09-25', 440, '23:00', '07:00'),
    night('2026-09-26', 440, '01:00', '08:30'),
    night('2026-09-27', 440, '23:15', '07:00'),
    night('2026-09-28', 440, '02:28', '07:00'),
  ]
  const c = sleepConsistency(wild, '2026-09-28')!
  // ~100 min average drift: about 28 points off, in line with WHOOP (15-20 points per hour)
  assert.ok(c >= 65 && c <= 78, `consistency ${c}`)
  assert.equal(sleepConsistency([steady[0]], '2026-09-25'), null)
})

test('sleep score: 4h 32m against an 8h 30m need is poor even with good stages', () => {
  const n = night('2026-09-28', 272, '02:28', '07:00', { in_bed_min: 272, deep_min: 49, rem_min: 48, core_min: 175 })
  const s = sleepScore(n, 510, 45)
  assert.ok(s.score < 35, `score ${s.score}`)
  assert.match(s.detail, /4h 32m of 8h 30m needed/)
  const good = sleepScore(night('2026-09-28', 500, '23:00', '07:40'), 480, 95)
  assert.ok(good.score >= 90, `good ${good.score}`)
})

// ─── Strain ───

test('strain is logarithmic on the 0-21 scale', () => {
  assert.equal(strainFromLoad(0), 0)
  assert.ok(Math.abs(strainFromLoad(80) - 12) < 0.2)
  assert.ok(strainFromLoad(400) > 19 && strainFromLoad(400) < 20)
  assert.equal(strainFromLoad(100000), 21)
  // Each point costs more than the last
  assert.ok(strainFromLoad(160) - strainFromLoad(80) < strainFromLoad(80) - strainFromLoad(0))
})

test('a day of resting heart rate is near zero strain; a run is not', () => {
  const dayStart = new Date(2026, 8, 27)
  const quiet = Array.from({ length: 288 }, (_, i) => ({ minute: new Date(dayStart.getTime() + i * 300_000).toISOString(), hr_avg: 58 }))
  const q = dayStrain({ minutes: quiet, restingHr: 55, maxHr: 190, sex: 'male', dayStart, now: new Date(dayStart.getTime() + 86_400_000) })
  assert.equal(q.strain, 0)
  const runStart = dayStart.getTime() + 18 * 3600_000
  const withRun = quiet.map(m => {
    const t = new Date(m.minute).getTime()
    return t >= runStart && t < runStart + 3600_000 ? { ...m, hr_avg: 150 } : m
  })
  const r = dayStrain({ minutes: withRun, restingHr: 55, maxHr: 190, sex: 'male', dayStart, now: new Date(dayStart.getTime() + 86_400_000) })
  assert.ok(r.strain > 11 && r.strain < 15, `run ${r.strain}`)
  assert.equal(r.activeMin, 60)
})

test('strength sessions add load; runs the ring already saw do not double count', () => {
  const dayStart = new Date(2026, 8, 27)
  const t = dayStart.getTime() + 18 * 3600_000
  const minutes = Array.from({ length: 12 }, (_, i) => ({ minute: new Date(t + i * 300_000).toISOString(), hr_avg: 150 }))
  const base = { minutes, restingHr: 55, maxHr: 190, sex: 'male' as const, dayStart, now: new Date(dayStart.getTime() + 86_400_000) }
  const runSeen = dayStrain({ ...base, events: [{ start: t, end: t + 3600_000, load: 90 }] })
  assert.equal(runSeen.otherLoad, 0)
  const gym = dayStrain({ ...base, events: [{ start: t - 7200_000, end: t - 3600_000, load: 60, muscular: true }] })
  assert.equal(gym.otherLoad, 60)
  const garminRun = dayStrain({ ...base, minutes: [], events: [{ start: t, end: t + 3600_000, load: 90 }] })
  assert.equal(garminRun.otherLoad, 90)
})

test('strain target follows readiness bands', () => {
  assert.equal(strainTarget(80)!.label, 'Push')
  assert.equal(strainTarget(50)!.lo, 10)
  assert.equal(strainTarget(20)!.hi, 10)
  assert.equal(strainTarget(null), null)
})

console.log(`\n${passed} passed`)

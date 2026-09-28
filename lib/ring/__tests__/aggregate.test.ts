// Run: npm run test:ring
import * as assert from 'assert'
import { MinuteAggregator, rmssd, rollupDay, tempDeviation, enmo, MinuteRow } from '../aggregate'
import { checksum, makePacket, isValidPacket } from '../packet'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const T0 = Date.UTC(2026, 8, 14, 23, 0, 0)

test('packet checksum matches reference framing', () => {
  const p = makePacket(105, [1, 1])
  assert.strictEqual(p.length, 16)
  assert.strictEqual(p[15], (105 + 1 + 1) & 0xff)
  assert.ok(isValidPacket(p))
  p[3] = 9
  assert.ok(!isValidPacket(p))
  assert.strictEqual(checksum(makePacket(3)), 3)
})

test('minute buckets average HR and drop implausible values', () => {
  const agg = new MinuteAggregator()
  agg.add({ type: 'hr', at: T0 + 1000, bpm: 60 })
  agg.add({ type: 'hr', at: T0 + 30000, bpm: 70 })
  agg.add({ type: 'hr', at: T0 + 40000, bpm: 255 })
  agg.add({ type: 'hr', at: T0 + 61000, bpm: 80 })
  const rows = agg.drainMinutes(T0 + 10 * 60000)
  assert.strictEqual(rows.length, 2)
  assert.deepStrictEqual([rows[0].hr_avg, rows[0].hr_min, rows[0].hr_max], [65, 60, 70])
  assert.strictEqual(agg.pendingMinutes, 0)
})

test('current minute is kept until it closes', () => {
  const agg = new MinuteAggregator()
  agg.add({ type: 'hr', at: T0 + 5000, bpm: 60 })
  assert.strictEqual(agg.drainMinutes(T0 + 20000).length, 0)
  assert.strictEqual(agg.drainMinutes(T0 + 20000, true).length, 1)
})

test('RMSSD from RR intervals, artifacts rejected', () => {
  const rr = [800, 820, 790, 810, 800, 830, 790, 805, 815, 795, 810, 2500, 800]
  const v = rmssd(rr)!
  assert.ok(v > 10 && v < 40, `rmssd ${v}`)
  assert.strictEqual(rmssd([800, 810]), null)
})

test('accelerometer reduces to ENMO motion, gravity removed', () => {
  assert.strictEqual(enmo([0, 0, 1]), 0)
  const agg = new MinuteAggregator()
  agg.add({ type: 'accel', at: T0, hz: 2, samples: [[0, 0, 1], [0, 0, 1.5], [0, 0, 1], [0, 0, 1.5]] })
  const [row] = agg.drainMinutes(T0 + 120000)
  assert.strictEqual(row.motion_g, 0.25)
})

test('resting HR uses the lowest 30-min window during sleep', () => {
  const minutes: MinuteRow[] = []
  for (let i = 0; i < 480; i++) {
    const hr = i >= 200 && i < 240 ? 48 : 58
    minutes.push({ minute: new Date(T0 + i * 60000).toISOString(), hr_avg: hr, hr_min: hr, hr_max: hr, hrv_ms: 50, skin_temp_c: 34, spo2_pct: 97, motion_g: 0, steps: null })
  }
  // A calm-but-awake daytime minute block should not win when sleep exists.
  const day = rollupDay('2026-09-15', minutes, { start: T0, end: T0 + 480 * 60000 })
  assert.strictEqual(day.resting_hr, 48)
  assert.strictEqual(day.hrv_rmssd_ms, 50)
  assert.strictEqual(day.skin_temp_c, 34)
})

test('skin temp ignores daytime readings; steps come from quarter-hour slots', () => {
  // 30 minutes at 12:00 local on the 15th: daytime, so no nightly temperature.
  const noon = new Date(2026, 8, 15, 12, 0, 0).getTime()
  const minutes: MinuteRow[] = Array.from({ length: 30 }, (_, i) => ({
    minute: new Date(noon + i * 60000).toISOString(), hr_avg: null, hr_min: null, hr_max: null,
    hrv_ms: null, skin_temp_c: 31, spo2_pct: null, motion_g: null, steps: 10,
  }))
  const day = rollupDay('2026-09-15', minutes)
  assert.strictEqual(day.skin_temp_c, null)
  // Only 12:00 and 12:15 are history slots; the rest are stale live deltas.
  assert.strictEqual(day.steps, 20)
})

test('without a ring sleep session, skin temp uses the small hours', () => {
  const start = new Date(2026, 8, 15, 1, 0, 0).getTime()
  // History: one reading every 30 minutes, 01:00-03:00
  const minutes: MinuteRow[] = Array.from({ length: 5 }, (_, i) => ({
    minute: new Date(start + i * 30 * 60000).toISOString(), hr_avg: null, hr_min: null, hr_max: null,
    hrv_ms: null, skin_temp_c: 34 + i * 0.1, spo2_pct: null, motion_g: null, steps: null,
  }))
  assert.strictEqual(rollupDay('2026-09-15', minutes).skin_temp_c, 34.2)
})

test('resting HR from the 5-minute ring log', () => {
  // Overnight log: one sample every 5 minutes for 6 hours, calmest hour ~50 bpm
  const start = new Date(2026, 8, 15, 0, 0, 0).getTime()
  const minutes: MinuteRow[] = Array.from({ length: 72 }, (_, i) => {
    const hr = i >= 30 && i < 42 ? 50 : 60
    return { minute: new Date(start + i * 5 * 60000).toISOString(), hr_avg: hr, hr_min: hr, hr_max: hr, hrv_ms: null, skin_temp_c: null, spo2_pct: null, motion_g: null, steps: null }
  })
  assert.strictEqual(rollupDay('2026-09-15', minutes).resting_hr, 50)
})

test('live step deltas are not summed into minutes', () => {
  const agg = new MinuteAggregator()
  agg.add({ type: 'steps', at: T0, count: 40, live: true })
  agg.add({ type: 'steps', at: T0, count: 25 })
  const [row] = agg.drainMinutes(T0 + 120000)
  assert.strictEqual(row.steps, 25)
})

test('temperature deviation vs median baseline', () => {
  assert.strictEqual(tempDeviation(34.6, [34.0, 34.1, 33.9, 36.5]), 0.55)
  assert.strictEqual(tempDeviation(34.6, [34.0]), null)
})

test('sleep segments are drained separately', () => {
  const agg = new MinuteAggregator()
  agg.add({ type: 'sleep_segment', start: T0, end: T0 + 3600000, stage: 'deep' })
  assert.strictEqual(agg.drainSleep().length, 1)
  assert.strictEqual(agg.drainSleep().length, 0)
})

console.log(`\n${passed} tests passed`)

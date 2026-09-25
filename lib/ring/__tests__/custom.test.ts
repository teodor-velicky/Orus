// Decoder tests with byte-exact packets built from the documented layouts.
// Run: npm run test:ring
import * as assert from 'assert'
import {
  custom, parseActivity, parseHeartRateLog, parseHrvLog, parseMeasurement, parseRawMotion, parseTemperatureHistory, resetBeatStream,
  parseSleep, parseSpo2History, requests, BIG_DATA,
} from '../custom'
import { makePacket, isValidPacket } from '../packet'
import type { RingEvent } from '../types'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const midnight = (daysAgo = 0) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

function bigFrame(type: number, payload: number[]): Uint8Array {
  const len = payload.length
  return Uint8Array.from([0xbc, type, len & 0xff, len >> 8, 0x00, 0x00, ...payload])
}

test('request packets are framed and checksummed', () => {
  for (const p of [requests.activity(3), requests.heartRate(1), requests.hrv(2), requests.measureStart(0x0b), requests.rawMotionOn()]) {
    assert.ok(isValidPacket(p.bytes), `invalid ${Array.from(p.bytes)}`)
  }
  assert.deepStrictEqual(Array.from(requests.rawMotionOn().bytes), [0xa1, 0x04, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xa9])
  assert.deepStrictEqual(Array.from(requests.measureStart(0x0b).bytes).slice(0, 3).concat(requests.measureStart(0x0b).bytes[15]), [0x69, 0x0b, 0x01, 0x75])
  assert.deepStrictEqual(Array.from(requests.sleep().bytes), [0xbc, 0x27, 0x01, 0x00, 0xff, 0x00, 0xff])
  assert.strictEqual(requests.sleep().channel, BIG_DATA.id)
})

test('HR history: 9 values in packet 1, 13 per later packet, 5-min slots', () => {
  const day = midnight(1)
  const p1 = makePacket(0x15, [1, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0, 61])
  const r1 = parseHeartRateLog(p1, day)
  assert.strictEqual(r1.events.length, 2)
  assert.strictEqual((r1.events[1] as Extract<RingEvent, { type: 'hr' }>).at, day.getTime() + 40 * 60_000)
  const p2 = makePacket(0x15, [2, 55])
  const r2 = parseHeartRateLog(p2, day)
  assert.strictEqual(r2.events[0].type === 'hr' && r2.events[0].at, day.getTime() + 45 * 60_000)
  assert.strictEqual(parseHeartRateLog(makePacket(0x15, [0, 25]), day).total, 25)
})

test('HRV history: 30-min slots, packet 1 starts at byte 3', () => {
  const day = midnight(0)
  const r = parseHrvLog(makePacket(0x39, [1, 0, 42]), day)
  assert.deepStrictEqual(r.events, [{ type: 'hrv', at: day.getTime(), ms: 42 }])
  const r2 = parseHrvLog(makePacket(0x39, [2, 38]), day)
  assert.strictEqual(r2.events[0].type === 'hrv' && r2.events[0].at, day.getTime() + 360 * 60_000)
})

test('activity: BCD date, quarter-hour slot, steps u16 LE, last-packet flag', () => {
  const p = makePacket(0x43, [0x26, 0x09, 0x14, 32, 0, 2, 0, 0, 0x10, 0x27])
  const r = parseActivity(p)
  assert.deepStrictEqual(r.events, [{ type: 'steps', at: new Date(2026, 8, 14, 8, 0).getTime(), count: 10000 }])
  assert.strictEqual(r.last, false)
  assert.strictEqual(parseActivity(makePacket(0x43, [0x26, 0x09, 0x14, 33, 1, 2])).last, true)
  assert.strictEqual(parseActivity(makePacket(0x43, [0xff])).empty, true)
})

test('sleep big data: pre-midnight start, stage mapping, durations', () => {
  const start = 23 * 60, end = 7 * 60
  const frame = bigFrame(0x27, [1, 0, 10, start & 0xff, start >> 8, end & 0xff, end >> 8, 2, 120, 3, 60, 4, 240, 5, 60])
  const events = parseSleep(frame) as Extract<RingEvent, { type: 'sleep_segment' }>[]
  assert.deepStrictEqual(events.map(e => e.stage), ['core', 'deep', 'rem'])
  assert.strictEqual(events[0].start, midnight(0).getTime() - 60 * 60_000)
  assert.strictEqual(events[2].end, midnight(0).getTime() + 360 * 60_000)
})

test('SpO₂ big data: hourly min/max averaged, zero hours skipped', () => {
  const hours = Array.from({ length: 24 }, (_, h) => (h === 3 ? [95, 99] : [0, 0])).flat()
  const events = parseSpo2History(bigFrame(0x2a, [0, ...hours]))
  assert.deepStrictEqual(events, [{ type: 'spo2', at: midnight(0).getTime() + 3 * 3600_000, pct: 97 }])
})

test('live measurements: temperature raw/10+20, wear error → notice', () => {
  assert.deepStrictEqual(parseMeasurement(makePacket(0x69, [0x0b, 0, 154]), 1), [{ type: 'skin_temp', at: 1, celsius: 35.4 }])
  assert.deepStrictEqual(parseMeasurement(makePacket(0x69, [0x0b, 0, 5]), 1), [])
  assert.strictEqual(parseMeasurement(makePacket(0x69, [0x01, 1, 0]), 1)[0].type, 'notice')
  assert.deepStrictEqual(parseMeasurement(makePacket(0x69, [0x0a, 0, 48]), 1), [{ type: 'hrv', at: 1, ms: 48 }])
})

test('raw motion: packed 12-bit Y/Z/X, sign-extended, 512 LSB/g', () => {
  const enc = (v: number) => { const u = v < 0 ? v + 4096 : v; return [(u >> 4) & 0xff, u & 0x0f] }
  const p = makePacket(0xa1, [0x03, ...enc(-256), ...enc(512), ...enc(0)])
  assert.deepStrictEqual(parseRawMotion(p), [0, -0.5, 1])
})

test('history runs one request at a time and reports completion', () => {
  const sent: number[][] = []
  const emitted: RingEvent[] = []
  custom.attach({ send: async (ps) => { ps.forEach(p => sent.push(Array.from(p.bytes))) }, emit: (e) => emitted.push(...e) })
  custom.reset()

  const first = custom.historyRequests(new Date())
  assert.strictEqual(first.length, 1)
  assert.strictEqual(first[0].bytes[0], 0x43)

  custom.decode('uart', makePacket(0x43, [0xff]), Date.now())
  assert.strictEqual(sent.pop()![0], 0x15) // → heart rate

  custom.decode('uart', makePacket(0x15, [0, 2]), Date.now())
  const hr = custom.decode('uart', makePacket(0x15, [1, 0, 0, 0, 0, 70]), Date.now())!
  assert.strictEqual(hr[0].type, 'hr')
  assert.deepStrictEqual(sent.pop()!.slice(0, 2), [0xbc, 0x2a]) // → SpO₂

  // SpO₂ frame split across two notifications must reassemble.
  const spo2 = bigFrame(0x2a, [0, ...Array(48).fill(0)])
  assert.deepStrictEqual(custom.decode(BIG_DATA.id, spo2.slice(0, 10), Date.now()), [])
  custom.decode(BIG_DATA.id, spo2.slice(10), Date.now())
  assert.deepStrictEqual(sent.pop()!.slice(0, 2), [0xbc, 0x27]) // → sleep

  custom.decode(BIG_DATA.id, bigFrame(0x27, [0]), Date.now())
  assert.deepStrictEqual(sent.pop()!.slice(0, 2), [0xbc, 0x25]) // → temperature

  custom.decode(BIG_DATA.id, bigFrame(0x25, [0, 0x1e, ...Array(48).fill(0)]), Date.now())
  assert.strictEqual(sent.pop()![0], 0x39) // → HRV

  const done = custom.decode('uart', makePacket(0x39, [0xff]), Date.now())!
  assert.strictEqual(done[done.length - 1].type, 'history_done')
  custom.reset()
})

test('live step notifications become deltas', () => {
  custom.reset()
  assert.deepStrictEqual(custom.decode('uart', makePacket(0x73, [0x12, 0, 0x03, 0xe8]), 1), [])
  assert.deepStrictEqual(custom.decode('uart', makePacket(0x73, [0x12, 0, 0x04, 0x00]), 2), [{ type: 'steps', at: 2, count: 24 }])
  custom.reset()
})

// Real frames captured from an R09 (R09_CB01) with the ring worn.
const hex = (h: string) => new Uint8Array(h.split(' ').map(x => parseInt(x, 16)))
const beatFrame = (ms: number) => {
  const b = new Uint8Array(16)
  b[0] = 0x69
  b[1] = 0x0a
  b[6] = ms & 0xff
  b[7] = ms >> 8
  return b
}

test('kind 0x0a streams beat-to-beat intervals, not a single HRV value', () => {
  resetBeatStream()
  // 0x02c8 = 712 ms = 84 bpm
  const first = parseMeasurement(hex('69 0a 00 00 00 00 c8 02 00 00 00 00 00 00 00 3d'), 1000)
  assert.deepStrictEqual(first[0], { type: 'rr', at: 1000, intervalsMs: [712] })
  assert.deepStrictEqual(first[1], { type: 'hr', at: 1000, bpm: 84 })

  // The ring repeats each frame; the same value within a second is one beat.
  assert.deepStrictEqual(parseMeasurement(hex('69 0a 00 00 00 00 c8 02 00 00 00 00 00 00 00 3d'), 1300), [])

  // Heart rate follows the median of recent beats, so one odd interval can't spike it.
  let last: RingEvent[] = []
  const series = [714, 730, 748, 770, 800, 923, 836]
  series.forEach((ms, i) => { last = parseMeasurement(beatFrame(ms), 2000 + i * 1000) })
  const hr = last.find(e => e.type === 'hr') as { bpm: number }
  assert.ok(hr.bpm >= 72 && hr.bpm <= 84, 'bpm ' + hr.bpm)

  // Noise outside 300-2000 ms is ignored
  resetBeatStream()
  assert.deepStrictEqual(parseMeasurement(beatFrame(16), 1), [])
})

test('temperature history: two readings an hour, raw/10 + 20 °C', () => {
  // One day: [daysAgo, 0x1e] then 24 hours x (on the hour, half past)
  const day = [0, 0x1e, ...Array(48).fill(0)]
  day[2 + 3 * 2] = 162 // 03:00 → 36.2 °C
  day[2 + 3 * 2 + 1] = 158 // 03:30 → 35.8 °C
  const now = new Date(2026, 8, 26, 12, 0, 0)
  const events = parseTemperatureHistory(new Uint8Array(bigFrame(0x25, day)), now)
  assert.strictEqual(events.length, 2)
  const first = events[0] as { type: string; at: number; celsius: number }
  assert.strictEqual(first.type, 'skin_temp')
  assert.strictEqual(Math.round(first.celsius * 10) / 10, 36.2)
  assert.strictEqual(new Date(first.at).getHours(), 3)
  assert.strictEqual(new Date((events[1] as { at: number }).at).getMinutes(), 30)

  // Short frames (no data recorded) are ignored
  assert.deepStrictEqual(parseTemperatureHistory(new Uint8Array(bigFrame(0x25, [0, 0x1e])), now), [])
})

test('spo2 sends zeros while measuring, then the reading', () => {
  assert.deepStrictEqual(parseMeasurement(hex('69 03 00 00 00 00 00 00 00 00 00 00 00 00 00 6c'), 1), [])
  assert.deepStrictEqual(parseMeasurement(hex('69 03 00 61 01 00 00 00 00 00 00 00 00 00 00 ce'), 1), [{ type: 'spo2', at: 1, pct: 97 }])
})

console.log(`\n${passed} tests passed`)

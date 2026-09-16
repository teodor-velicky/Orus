// ─────────────────────────────────────────────────────────────────────────
// Colmi R09 decoder — the documented protocol.
//
// Sources (protocol facts only; no code copied):
//   · Gadgetbridge Colmi R0x support: history sync for HR, activity, HRV,
//     SpO₂ and sleep; big-data framing; notifications; preferences.
//   · tahnok/colmi_r02_client: packet framing, HR log layout.
//   · mk590901/colmi-r09-r12: live measurement kinds incl. temperature
//     (kind 0x0B, °C = raw / 10 + 20) on an actual R09.
//   · Nosh118/colmi-ring-tools + denisboborukhin accelerometer research:
//     raw motion (A1 04 04 on / A1 02 off, A1 03 packed 12-bit Y/Z/X, raw/512 g).
//
// NOT publicly documented yet — marked VERIFY/TODO below:
//   · Skin-temperature HISTORY (only live spot readings are known).
//   · Accelerometer format on R09 hardware (decoded as the R02 "legacy12"
//     layout — check that a ring lying still reads ≈ 1 g).
//   · Beat-to-beat RR intervals (not exposed; the ring reports HRV itself).
// ─────────────────────────────────────────────────────────────────────────

import type { Outgoing, RingChannel, RingEvent, RingIO } from './types'
import { isValidPacket, makePacket, u16 } from './packet'

// Helpers for further decoding work
export * from './packet'

/** Second GATT service: "big data" history (and DFU — never send 0xBC 0x01-0x05). */
export const BIG_DATA: RingChannel = {
  id: 'bigdata',
  service: 'DE5BF728-D711-4E47-AF26-65E3012A5DC7',
  write: 'DE5BF72A-D711-4E47-AF26-65E3012A5DC7',
  notify: 'DE5BF729-D711-4E47-AF26-65E3012A5DC7',
}

const UART = 'uart'

export const CMD = {
  SYNC_HR: 0x15,
  HR_LOG_PREF: 0x16,
  SPO2_PREF: 0x2c,
  HRV_PREF: 0x38,
  SYNC_HRV: 0x39,
  SYNC_ACTIVITY: 0x43,
  MEASURE: 0x69,
  MEASURE_STOP: 0x6a,
  NOTIFY: 0x73,
  RAW: 0xa1,
  BIG_DATA: 0xbc,
} as const

export const KIND = { HR: 0x01, SPO2: 0x03, STRESS: 0x04, HRV: 0x0a, TEMP: 0x0b } as const
const ACTION = { START: 0x01, CONTINUE: 0x03 } as const
const BIG = { SLEEP: 0x27, SPO2: 0x2a } as const
const PREF_WRITE = 0x02

const SLEEP_STAGE: Record<number, 'core' | 'deep' | 'rem' | 'awake'> = { 2: 'core', 3: 'deep', 4: 'rem', 5: 'awake' }

// ─── Tunables ───

/** Ring logs HR every N minutes (5–60, multiples of 5). Lower = better data, more battery. */
export const HR_LOG_INTERVAL_MIN = 5
/** Stream raw motion during live mode. Stock firmware also starts optical raw producers → battery cost. */
export const LIVE_RAW_MOTION = true
/** VERIFY on R09: legacy R02 layout is ±4 g over 12 bits → 512 LSB/g. */
export const ACCEL_LSB_PER_G = 512
/** Give up on a history step after this much silence (old firmware skips some). */
const STEP_TIMEOUT_MS = 10_000
/**
 * Live mode rotates through spot measurements — the ring runs one optical
 * measurement at a time. HR gets most of the time; the others refresh the tiles.
 */
const LIVE_PLAN: { kind: number; ms: number }[] = [
  { kind: KIND.HR, ms: 90_000 },
  { kind: KIND.TEMP, ms: 30_000 },
  { kind: KIND.HRV, ms: 45_000 },
  { kind: KIND.SPO2, ms: 35_000 },
]

/** During a run only heart rate matters — no rotation, so there are no HR gaps. */
const WORKOUT_PLAN: { kind: number; ms: number }[] = [{ kind: KIND.HR, ms: Infinity }]
let plan = LIVE_PLAN

// ─── Time helpers (the ring keeps LOCAL wall-clock time) ───

function midnightDaysAgo(daysAgo: number, now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

const bcdToInt = (b: number) => ((b >> 4) & 0x0f) * 10 + (b & 0x0f)

function le32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
}

/** Local wall-clock time expressed as epoch seconds (what the ring expects). */
function ringSeconds(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 1000)
}

const uart = (bytes: Uint8Array) => ({ channel: UART, bytes })
const big = (bytes: number[]) => ({ channel: BIG_DATA.id, bytes: Uint8Array.from(bytes) })

// ─── Request builders ───

export const requests = {
  activity: (daysAgo: number) => uart(makePacket(CMD.SYNC_ACTIVITY, [daysAgo, 0x0f, 0x00, 0x5f, 0x01])),
  heartRate: (daysAgo: number, now = new Date()) =>
    uart(makePacket(CMD.SYNC_HR, le32(ringSeconds(daysAgo === 0 ? now : midnightDaysAgo(daysAgo, now))))),
  hrv: (daysAgo: number) => uart(makePacket(CMD.SYNC_HRV, le32(daysAgo))),
  spo2: () => big([CMD.BIG_DATA, BIG.SPO2, 0x01, 0x00, 0xff, 0x00, 0xff]),
  sleep: () => big([CMD.BIG_DATA, BIG.SLEEP, 0x01, 0x00, 0xff, 0x00, 0xff]),
  measureStart: (kind: number) => uart(makePacket(CMD.MEASURE, [kind, ACTION.START])),
  measureContinue: (kind: number) => uart(makePacket(CMD.MEASURE, [kind, ACTION.CONTINUE])),
  measureStop: (kind: number) => uart(makePacket(CMD.MEASURE_STOP, [kind, 0x00, 0x00])),
  rawMotionOn: () => uart(makePacket(CMD.RAW, [0x04, 0x04])),
  rawMotionOff: () => uart(makePacket(CMD.RAW, [0x02])),
  hrLogInterval: (minutes: number) =>
    uart(makePacket(CMD.HR_LOG_PREF, [PREF_WRITE, minutes > 0 ? 0x01 : 0x02, Math.min(60, Math.max(0, minutes))])),
  spo2AllDay: (on: boolean) => uart(makePacket(CMD.SPO2_PREF, [PREF_WRITE, on ? 0x01 : 0x00])),
  hrvAllDay: (on: boolean) => uart(makePacket(CMD.HRV_PREF, [PREF_WRITE, on ? 0x01 : 0x00])),
}

// ─── Pure parsers (exported for tests) ───

/** HR log packet. Packet 1: timestamp in 2..5, 9 values from byte 6; later packets: 13 values from byte 2. 5-min slots. */
export function parseHeartRateLog(b: Uint8Array, day: Date): { events: RingEvent[]; nr: number; total?: number } {
  const nr = b[1]
  if (nr === 0xff) return { events: [], nr }
  if (nr === 0) return { events: [], nr, total: b[2] }
  const start = nr === 1 ? 6 : 2
  const before = nr === 1 ? 0 : 9 * 5 + (nr - 2) * 13 * 5
  const events: RingEvent[] = []
  for (let i = start; i < 15; i++) {
    if (!b[i]) continue
    const minute = before + (i - start) * 5
    if (minute >= 1440) break
    events.push({ type: 'hr', at: day.getTime() + minute * 60_000, bpm: b[i] })
  }
  return { events, nr }
}

/** HRV log packet. Packet 1: values from byte 3 (12); later packets: 13 values from byte 2. 30-min slots. */
export function parseHrvLog(b: Uint8Array, day: Date): { events: RingEvent[]; nr: number; total?: number } {
  const nr = b[1]
  if (nr === 0xff) return { events: [], nr }
  if (nr === 0) return { events: [], nr, total: b[2] }
  const start = nr === 1 ? 3 : 2
  const before = nr === 1 ? 0 : 12 * 30 + (nr - 2) * 13 * 30
  const events: RingEvent[] = []
  for (let i = start; i < 15; i++) {
    if (!b[i]) continue
    const minute = before + (i - start) * 30
    if (minute >= 1440) break
    events.push({ type: 'hrv', at: day.getTime() + minute * 60_000, ms: b[i] })
  }
  return { events, nr }
}

/** Activity packet: BCD date in 1..3, quarter-of-day in 4, packet idx/count 5/6, steps u16 LE at 9. */
export function parseActivity(b: Uint8Array): { events: RingEvent[]; empty: boolean; last: boolean } {
  if (b[1] === 0xff) return { events: [], empty: true, last: true }
  if (b[1] === 0xf0) return { events: [], empty: false, last: false }
  const at = new Date(2000 + bcdToInt(b[1]), bcdToInt(b[2]) - 1, bcdToInt(b[3]), 0, b[4] * 15).getTime()
  const steps = u16(b, 9)
  return {
    events: steps > 0 ? [{ type: 'steps', at, count: steps }] : [],
    empty: false,
    last: b[5] === b[6] - 1,
  }
}

/** Big-data sleep: [6]=days, then per day: daysAgo, dayBytes, start u16, end u16 (min after midnight), (stage, minutes)… */
export function parseSleep(v: Uint8Array, now = new Date()): RingEvent[] {
  const length = u16(v, 2)
  if (length < 2) return []
  const days = v[6]
  const events: RingEvent[] = []
  let index = 7
  for (let d = 0; d < days && index + 5 < v.length; d++) {
    const daysAgo = v[index++]
    const dayBytes = v[index++]
    const startMin = u16(v, index); index += 2
    const endMin = u16(v, index); index += 2
    const midnight = midnightDaysAgo(daysAgo, now).getTime()
    // Start after end ⇒ fell asleep before midnight on the previous day.
    let cursor = midnight + (startMin > endMin ? startMin - 1440 : startMin) * 60_000
    for (let j = 4; j < dayBytes && index + 1 < v.length; j += 2) {
      const stage = SLEEP_STAGE[v[index]] ?? 'asleep'
      const minutes = v[index + 1]
      if (minutes > 0) {
        events.push({ type: 'sleep_segment', start: cursor, end: cursor + minutes * 60_000, stage })
        cursor += minutes * 60_000
      }
      index += 2
    }
  }
  return events
}

/** Big-data SpO₂: from byte 6, per day: daysAgo, then 24 × (min, max) hourly. Ends after day 0. */
export function parseSpo2History(v: Uint8Array, now = new Date()): RingEvent[] {
  const length = u16(v, 2)
  const events: RingEvent[] = []
  let index = 6
  let daysAgo = -1
  while (daysAgo !== 0 && index - 6 < length && index < v.length) {
    daysAgo = v[index++]
    const midnight = midnightDaysAgo(daysAgo, now).getTime()
    for (let hour = 0; hour < 24 && index + 1 < v.length; hour++) {
      const min = v[index++]
      const max = v[index++]
      if (min > 0 && max > 0) {
        events.push({ type: 'spo2', at: midnight + hour * 3600_000, pct: Math.round((min + max) / 2) })
      }
      if (index - 6 >= length) break
    }
  }
  return events
}

/** Live measurement response: [0x69, kind, error, value]. */
export function parseMeasurement(b: Uint8Array, at: number): RingEvent[] {
  const kind = b[1]
  const error = b[2]
  const value = b[3]
  if (error === 1) return [{ type: 'notice', at, message: 'Ring not worn correctly — adjust the fit' }]
  if (error !== 0 || value === 0) return []
  switch (kind) {
    case KIND.HR: return [{ type: 'hr', at, bpm: value }]
    case KIND.SPO2: return [{ type: 'spo2', at, pct: value }]
    case KIND.HRV: return [{ type: 'hrv', at, ms: value }]
    case KIND.TEMP: return value < 11 ? [] : [{ type: 'skin_temp', at, celsius: value / 10 + 20 }]
    default: return []
  }
}

function axis12(high: number, low: number): number {
  const v = ((high << 4) | (low & 0x0f)) & 0x0fff
  return v > 2047 ? v - 4096 : v
}

/** Raw motion A1 03: packed signed 12-bit Y, Z, X → g. */
export function parseRawMotion(b: Uint8Array): [number, number, number] | null {
  if (b.length < 8 || b[0] !== CMD.RAW || b[1] !== 0x03) return null
  const y = axis12(b[2], b[3])
  const z = axis12(b[4], b[5])
  const x = axis12(b[6], b[7])
  return [x / ACCEL_LSB_PER_G, y / ACCEL_LSB_PER_G, z / ACCEL_LSB_PER_G]
}

// ─── Stateful decoder ───

type StepKind = 'activity' | 'hr' | 'spo2' | 'sleep' | 'hrv'
interface Step { kind: StepKind; daysAgo: number; packet: Outgoing[number] }

let io: RingIO | null = null
let queue: Step[] = []
let current: Step | null = null
let stepTimer: ReturnType<typeof setTimeout> | null = null
let logTotal = 0
let bigBuffer: Uint8Array | null = null
let lastLiveSteps: number | null = null
let lastAccelAt = 0
let accelHz = 0
let livePhase = 0
let livePhaseStart = 0

function armTimer() {
  if (stepTimer) clearTimeout(stepTimer)
  stepTimer = setTimeout(() => {
    stepTimer = null
    const done = finishStep()
    if (done.length) io?.emit(done)
  }, STEP_TIMEOUT_MS)
}

function beginStep(step: Step): Outgoing {
  current = step
  logTotal = 0
  armTimer()
  return [step.packet]
}

/** Current step answered: send the next one, or report the whole sync done. */
function finishStep(): RingEvent[] {
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null }
  const next = queue.shift()
  if (next) {
    io?.send(beginStep(next)).catch(() => {})
    return []
  }
  const wasRunning = current !== null
  current = null
  return wasRunning ? [{ type: 'history_done', at: Date.now(), kind: 'all' }] : []
}

const stepDay = () => midnightDaysAgo(current?.daysAgo ?? 0)

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function decodeBigData(bytes: Uint8Array): RingEvent[] {
  let v = bigBuffer ? concat(bigBuffer, bytes) : bytes
  bigBuffer = null
  if (v.length < 6 || v[0] !== CMD.BIG_DATA) return []
  const length = u16(v, 2)
  if (v.length < length + 6) {
    bigBuffer = v // wait for the rest
    if (current) armTimer()
    return []
  }
  let events: RingEvent[] = []
  if (v[1] === BIG.SLEEP) events = parseSleep(v)
  else if (v[1] === BIG.SPO2) events = parseSpo2History(v)
  // TODO(temperature history): unknown big-data types land here — log
  // `hex(v)` while syncing in QRing to find the temperature record type.
  const answers = (v[1] === BIG.SLEEP && current?.kind === 'sleep') || (v[1] === BIG.SPO2 && current?.kind === 'spo2')
  return answers ? [...events, ...finishStep()] : events
}

function decodeUart(b: Uint8Array, at: number): RingEvent[] | null {
  switch (b[0]) {
    case CMD.MEASURE:
      return isValidPacket(b) ? parseMeasurement(b, at) : []

    case CMD.RAW: {
      const g = parseRawMotion(b)
      if (!g) return []
      if (lastAccelAt) {
        const dt = at - lastAccelAt
        if (dt > 0 && dt < 2000) accelHz = accelHz ? accelHz * 0.9 + (1000 / dt) * 0.1 : 1000 / dt
      }
      lastAccelAt = at
      return [{ type: 'accel', at, hz: Math.max(1, Math.round(accelHz || 1)), samples: [g] }]
    }

    case CMD.SYNC_HR: {
      if (!isValidPacket(b) || current?.kind !== 'hr') return []
      const r = parseHeartRateLog(b, stepDay())
      if (r.total !== undefined) logTotal = r.total
      if (r.nr === 0xff || (r.nr > 0 && logTotal > 0 && r.nr >= logTotal - 1)) return [...r.events, ...finishStep()]
      armTimer()
      return r.events
    }

    case CMD.SYNC_HRV: {
      if (!isValidPacket(b) || current?.kind !== 'hrv') return []
      const r = parseHrvLog(b, stepDay())
      if (r.total !== undefined) logTotal = r.total
      const lastNr = logTotal > 0 ? logTotal - 1 : 4
      if (r.nr === 0xff || (r.nr > 0 && r.nr >= lastNr)) return [...r.events, ...finishStep()]
      armTimer()
      return r.events
    }

    case CMD.SYNC_ACTIVITY: {
      if (!isValidPacket(b) || current?.kind !== 'activity') return []
      const r = parseActivity(b)
      if (r.last) return [...r.events, ...finishStep()]
      armTimer()
      return r.events
    }

    case CMD.NOTIFY: {
      if (!isValidPacket(b)) return []
      if (b[1] === 0x12) {
        // Live activity: today's running step total, 3 bytes big-endian.
        const total = (b[2] << 16) | (b[3] << 8) | b[4]
        const prev = lastLiveSteps
        lastLiveSteps = total
        return prev !== null && total > prev ? [{ type: 'steps', at, count: total - prev }] : []
      }
      if (b[1] === 0x0c) return [{ type: 'battery', at, pct: b[2], charging: b[3] === 1 }]
      // 0x01 / 0x03 / 0x04: new HR / SpO₂ / steps data available on the ring.
      return []
    }

    case CMD.HR_LOG_PREF:
    case CMD.SPO2_PREF:
    case CMD.HRV_PREF:
    case CMD.MEASURE_STOP:
      return [] // acknowledgements

    default:
      return null // battery, set-time… handled by the built-in decoder
  }
}

export const custom = {
  extraChannels: [BIG_DATA] as RingChannel[],

  attach(ringIO: RingIO) {
    io = ringIO
  },

  reset() {
    if (stepTimer) clearTimeout(stepTimer)
    stepTimer = null
    queue = []
    current = null
    bigBuffer = null
    lastLiveSteps = null
    lastAccelAt = 0
    accelHz = 0
  },

  matches(deviceName: string): boolean {
    return /^R09_/i.test(deviceName)
  },

  /** Make sure the ring is actually logging what Orus needs between syncs. */
  onConnect(_now: Date): Outgoing {
    return [
      requests.hrLogInterval(HR_LOG_INTERVAL_MIN),
      requests.spo2AllDay(true),
      requests.hrvAllDay(true),
    ]
  },

  /**
   * One request at a time — responses don't say which day they belong to.
   * Order: activity → heart rate → SpO₂ → sleep → HRV (last: old firmware may never answer).
   */
  historyRequests(since: Date, now = new Date()): Outgoing {
    const days = Math.max(0, Math.min(6,
      Math.round((midnightDaysAgo(0, now).getTime() - midnightDaysAgo(0, since).getTime()) / 86400_000)))
    const range = Array.from({ length: days + 1 }, (_, i) => days - i) // oldest first
    const steps: Step[] = [
      ...range.map(d => ({ kind: 'activity' as const, daysAgo: d, packet: requests.activity(d) })),
      ...range.map(d => ({ kind: 'hr' as const, daysAgo: d, packet: requests.heartRate(d, now) })),
      { kind: 'spo2', daysAgo: 0, packet: requests.spo2() },
      { kind: 'sleep', daysAgo: 0, packet: requests.sleep() },
      ...range.map(d => ({ kind: 'hrv' as const, daysAgo: d, packet: requests.hrv(d) })),
    ]
    queue = steps.slice(1)
    return beginStep(steps[0])
  },

  liveStart(mode: 'vitals' | 'workout' = 'vitals'): Outgoing {
    plan = mode === 'workout' ? WORKOUT_PLAN : LIVE_PLAN
    livePhase = 0
    livePhaseStart = Date.now()
    return [
      ...(LIVE_RAW_MOTION ? [requests.rawMotionOn()] : []),
      requests.measureStart(plan[0].kind),
    ]
  },

  liveKeepAlive(): Outgoing {
    const phase = plan[livePhase]
    if (Date.now() - livePhaseStart < phase.ms) {
      return phase.kind === KIND.HR ? [requests.measureContinue(KIND.HR)] : []
    }
    livePhase = (livePhase + 1) % plan.length
    livePhaseStart = Date.now()
    return [requests.measureStop(phase.kind), requests.measureStart(plan[livePhase].kind)]
  },

  liveStop(): Outgoing {
    return [
      requests.measureStop(plan[livePhase].kind),
      ...(LIVE_RAW_MOTION ? [requests.rawMotionOff()] : []),
    ]
  },

  decode(channel: string, bytes: Uint8Array, receivedAt: number): RingEvent[] | null {
    if (channel === BIG_DATA.id) return decodeBigData(bytes)
    if (channel !== UART) return null
    return decodeUart(bytes, receivedAt)
  },
}

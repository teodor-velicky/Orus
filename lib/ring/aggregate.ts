// Pure data reduction for ring events — no React Native imports, unit-tested
// with node (lib/ring/__tests__). Raw streams never leave the phone: they are
// reduced to one row per minute, and minutes to one row per day.

import type { RingEvent } from './types'

export interface MinuteRow {
  minute: string // ISO, floored to the minute
  hr_avg: number | null
  hr_min: number | null
  hr_max: number | null
  hrv_ms: number | null
  skin_temp_c: number | null
  spo2_pct: number | null
  motion_g: number | null
  steps: number | null
}

export interface SleepSegment {
  start: number
  end: number
  stage: 'core' | 'deep' | 'rem' | 'awake' | 'asleep'
}

interface Bucket {
  hrSum: number; hrN: number; hrMin: number; hrMax: number
  hrv: number[]; rr: number[]; temp: number[]; spo2: number[]
  motionSum: number; motionN: number; steps: number
}

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** RMSSD over beat-to-beat intervals with basic artifact rejection. */
export function rmssd(intervalsMs: number[]): number | null {
  const rr = intervalsMs.filter(x => x >= 300 && x <= 2000)
  const diffs: number[] = []
  for (let i = 1; i < rr.length; i++) {
    const d = rr[i] - rr[i - 1]
    if (Math.abs(d) <= rr[i - 1] * 0.2) diffs.push(d * d)
  }
  if (diffs.length < 10) return null
  return Math.sqrt(diffs.reduce((a, b) => a + b, 0) / diffs.length)
}

/** Euclidean-norm-minus-one: movement intensity in g, gravity removed. */
export function enmo([x, y, z]: [number, number, number]): number {
  return Math.max(0, Math.sqrt(x * x + y * y + z * z) - 1)
}

export class MinuteAggregator {
  private buckets = new Map<number, Bucket>()
  private sleep: SleepSegment[] = []

  private bucket(at: number): Bucket {
    const key = Math.floor(at / 60000)
    let b = this.buckets.get(key)
    if (!b) {
      b = { hrSum: 0, hrN: 0, hrMin: Infinity, hrMax: -Infinity, hrv: [], rr: [], temp: [], spo2: [], motionSum: 0, motionN: 0, steps: 0 }
      this.buckets.set(key, b)
    }
    return b
  }

  add(e: RingEvent): void {
    switch (e.type) {
      case 'hr': {
        if (e.bpm < 25 || e.bpm > 230) return
        const b = this.bucket(e.at)
        b.hrSum += e.bpm; b.hrN++
        b.hrMin = Math.min(b.hrMin, e.bpm); b.hrMax = Math.max(b.hrMax, e.bpm)
        return
      }
      case 'hrv':
        if (e.ms > 0 && e.ms < 300) this.bucket(e.at).hrv.push(e.ms)
        return
      case 'rr':
        this.bucket(e.at).rr.push(...e.intervalsMs)
        return
      case 'skin_temp':
        if (e.celsius > 20 && e.celsius < 45) this.bucket(e.at).temp.push(e.celsius)
        return
      case 'spo2':
        if (e.pct >= 70 && e.pct <= 100) this.bucket(e.at).spo2.push(e.pct)
        return
      case 'accel': {
        const step = 1000 / Math.max(1, e.hz)
        e.samples.forEach((s, i) => {
          const b = this.bucket(e.at + i * step)
          b.motionSum += enmo(s); b.motionN++
        })
        return
      }
      case 'steps':
        // Live deltas would double count: the history sync delivers the same steps.
        if (e.count > 0 && !e.live) this.bucket(e.at).steps += e.count
        return
      case 'sleep_segment':
        if (e.end > e.start) this.sleep.push({ start: e.start, end: e.end, stage: e.stage })
        return
      default:
        return
    }
  }

  get pendingMinutes(): number {
    return this.buckets.size
  }

  /** Remove and return finished minutes (all minutes if `includeCurrent`). */
  drainMinutes(now = Date.now(), includeCurrent = false): MinuteRow[] {
    const current = Math.floor(now / 60000)
    const rows: MinuteRow[] = []
    for (const [key, b] of [...this.buckets.entries()].sort((a, c) => a[0] - c[0])) {
      if (!includeCurrent && key >= current) continue
      this.buckets.delete(key)
      const hrv = mean(b.hrv) ?? rmssd(b.rr)
      rows.push({
        minute: new Date(key * 60000).toISOString(),
        hr_avg: b.hrN ? round(b.hrSum / b.hrN, 1) : null,
        hr_min: b.hrN ? b.hrMin : null,
        hr_max: b.hrN ? b.hrMax : null,
        hrv_ms: hrv != null ? round(hrv, 1) : null,
        skin_temp_c: b.temp.length ? round(mean(b.temp)!, 2) : null,
        spo2_pct: b.spo2.length ? round(mean(b.spo2)!, 1) : null,
        motion_g: b.motionN ? round(b.motionSum / b.motionN, 4) : null,
        steps: b.steps || null,
      })
    }
    return rows
  }

  drainSleep(): SleepSegment[] {
    const s = this.sleep
    this.sleep = []
    return s
  }
}

// ─── Daily rollup ───

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface RingDay {
  date: string
  resting_hr: number | null
  hr_avg: number | null
  hr_min: number | null
  hr_max: number | null
  hrv_rmssd_ms: number | null
  skin_temp_c: number | null
  spo2_pct: number | null
  steps: number | null
  sleep_minutes_with_hr: number
}

export function rollupDay(
  date: string,
  minutes: MinuteRow[],
  sleepWindow?: { start: number; end: number },
  /** Deep-sleep periods of that night, from the ring's sleep stages. */
  deepWindows: { start: number; end: number }[] = [],
): RingDay {
  const inSleep = (m: MinuteRow) => {
    if (!sleepWindow) return false
    const t = new Date(m.minute).getTime()
    return t >= sleepWindow.start && t < sleepWindow.end
  }
  const sleepMin = minutes.filter(inSleep)
  const hrMinutes = minutes.filter(m => m.hr_avg != null)
  const sleepHr = sleepMin.filter(m => m.hr_avg != null)

  // Resting HR = lowest 30-minute rolling mean, preferring the sleep window.
  // The ring logs heart rate every 5 minutes, so a full 30-minute window holds
  // about 6 samples; 4 (20 minutes of coverage) is enough to trust it. Live
  // streaming fills every minute, which easily clears the same bar.
  const MIN_WINDOW_SAMPLES = 4
  const lowestRolling = (rows: MinuteRow[]) => {
    const sorted = [...rows].sort((a, b) => a.minute.localeCompare(b.minute))
    if (sorted.length < MIN_WINDOW_SAMPLES) return null
    let best: number | null = null
    let lo = 0
    for (let hi = 0; hi < sorted.length; hi++) {
      const tHi = new Date(sorted[hi].minute).getTime()
      while (tHi - new Date(sorted[lo].minute).getTime() >= 30 * 60000) lo++
      const win = sorted.slice(lo, hi + 1)
      if (win.length < MIN_WINDOW_SAMPLES) continue
      const m = mean(win.map(w => w.hr_avg!))!
      best = best == null ? m : Math.min(best, m)
    }
    return best
  }

  const pick = <T,>(sleepVals: T[], allVals: T[]) => (sleepVals.length ? sleepVals : allVals)
  // HRV is steadiest in deep sleep: no movement, no dreaming, parasympathetic
  // tone at its clearest. WHOOP weights its nightly HRV toward slow-wave sleep
  // for the same reason. A reading counts if its 30-minute slot overlaps a
  // deep period; with fewer than two, fall back to the whole night.
  const inDeep = (m: MinuteRow) => {
    const t = new Date(m.minute).getTime()
    return deepWindows.some(w => t < w.end && t + 30 * 60_000 > w.start)
  }
  const deepHrv = minutes.filter(inDeep).map(m => m.hrv_ms).filter((v): v is number => v != null)
  const hrvVals = deepHrv.length >= 2
    ? deepHrv
    : pick(sleepMin, minutes).map(m => m.hrv_ms).filter((v): v is number => v != null)
  // Skin temperature is only meaningful at night; daytime readings track the room.
  // Without a ring sleep session, use 00:00-06:00 local time for the date.
  const smallHours = (m: MinuteRow) => {
    const d = new Date(m.minute)
    return localDate(d) === date && d.getHours() < 6
  }
  const nightMin = sleepWindow ? sleepMin : minutes.filter(smallHours)
  const tempVals = nightMin.map(m => m.skin_temp_c).filter((v): v is number => v != null)
  const spo2Vals = sleepMin.map(m => m.spo2_pct).filter((v): v is number => v != null)
  const rhr = lowestRolling(sleepHr.length >= MIN_WINDOW_SAMPLES ? sleepHr : hrMinutes)
  const steps = minutes
    .filter(m => new Date(m.minute).getMinutes() % 15 === 0)
    .reduce((a, m) => a + (m.steps ?? 0), 0)

  return {
    date,
    resting_hr: rhr != null ? round(rhr, 1) : null,
    hr_avg: hrMinutes.length ? round(mean(hrMinutes.map(m => m.hr_avg!))!, 1) : null,
    hr_min: hrMinutes.length ? Math.min(...hrMinutes.map(m => m.hr_min ?? m.hr_avg!)) : null,
    hr_max: hrMinutes.length ? Math.max(...hrMinutes.map(m => m.hr_max ?? m.hr_avg!)) : null,
    hrv_rmssd_ms: hrvVals.length ? round(mean(hrvVals)!, 1) : null,
    skin_temp_c: tempVals.length >= 3 ? round(mean(tempVals)!, 2) : null,
    spo2_pct: spo2Vals.length ? round(mean(spo2Vals)!, 1) : null,
    steps: steps || null,
    sleep_minutes_with_hr: sleepHr.length,
  }
}

/** Deviation from the median of the previous nights — robust to one odd night. */
export function tempDeviation(today: number | null, previous: (number | null)[]): number | null {
  const prev = previous.filter((v): v is number => v != null).sort((a, b) => a - b)
  if (today == null || prev.length < 3) return null
  const mid = Math.floor(prev.length / 2)
  const median = prev.length % 2 ? prev[mid] : (prev[mid - 1] + prev[mid]) / 2
  return round(today - median, 2)
}

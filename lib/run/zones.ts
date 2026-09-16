// Heart-rate zones, time-in-zone, TRIMP and aerobic decoupling. Pure.

import type { HrSample } from './geo'

export interface Zone {
  /** 1–5 */
  n: number
  name: string
  purpose: string
  lo: number
  hi: number
}

const ZONE_META = [
  { name: 'Recovery', purpose: 'Very easy. Blood flow, warm-ups, recovery jogs.' },
  { name: 'Aerobic', purpose: 'Easy running. Builds the aerobic base — most of your weekly volume.' },
  { name: 'Tempo', purpose: 'Steady, comfortably hard. Marathon-ish effort.' },
  { name: 'Threshold', purpose: 'Hard but sustainable ~30–60 min. Raises lactate threshold.' },
  { name: 'VO₂ max', purpose: 'Very hard intervals. Raises top-end aerobic power.' },
]

/** Tanaka et al. (2001): 208 − 0.7 × age. Better than 220 − age across ages. */
export function estimateMaxHr(age: number | null | undefined): number {
  return Math.round(208 - 0.7 * (age && age > 10 && age < 100 ? age : 30))
}

/**
 * Karvonen (heart-rate reserve) zones: 50–60–70–80–90–100 % HRR above
 * resting. Personal resting HR makes zones far more accurate than %max.
 */
export function hrZones(maxHr: number, restingHr: number | null | undefined): Zone[] {
  const rest = restingHr && restingHr > 30 && restingHr < maxHr - 40 ? restingHr : 60
  const hrr = maxHr - rest
  const at = (pct: number) => Math.round(rest + hrr * pct)
  const bounds = [0.5, 0.6, 0.7, 0.8, 0.9, 1]
  return ZONE_META.map((m, i) => ({ n: i + 1, ...m, lo: at(bounds[i]), hi: at(bounds[i + 1]) }))
}

/** Zone number (0 = below zone 1) for a bpm. */
export function zoneOf(bpm: number, zones: Zone[]): number {
  if (bpm < zones[0].lo) return 0
  for (let i = zones.length - 1; i >= 0; i--) if (bpm >= zones[i].lo) return zones[i].n
  return 0
}

/**
 * Seconds in each zone [z1..z5]. Each sample holds until the next one,
 * capped at `maxGapS` so dropouts don't inflate a zone. Below-z1 time is
 * folded into z1.
 */
export function timeInZones(hr: HrSample[], zones: Zone[], maxGapS = 15): number[] {
  const out = [0, 0, 0, 0, 0]
  const s = [...hr].sort((a, b) => a.t - b.t)
  for (let i = 0; i < s.length; i++) {
    const dt = i < s.length - 1 ? Math.min(maxGapS, (s[i + 1].t - s[i].t) / 1000) : Math.min(maxGapS, 5)
    if (dt <= 0) continue
    out[Math.max(1, zoneOf(s[i].bpm, zones)) - 1] += dt
  }
  return out.map(Math.round)
}

/**
 * Banister TRIMP: Σ minutes × HRr × 0.64·e^(1.92·HRr) (men) or
 * 0.86·e^(1.67·HRr) (women). A standard 1 h easy run ≈ 60–90.
 */
export function trimp(hr: HrSample[], restingHr: number, maxHr: number, sex: 'male' | 'female' | null | undefined): number {
  const [a, b] = sex === 'female' ? [0.86, 1.67] : [0.64, 1.92]
  const s = [...hr].sort((x, y) => x.t - y.t)
  let total = 0
  for (let i = 0; i < s.length - 1; i++) {
    const min = Math.min(15, (s[i + 1].t - s[i].t) / 1000) / 60
    const r = Math.max(0, Math.min(1, (s[i].bpm - restingHr) / (maxHr - restingHr)))
    total += min * r * a * Math.exp(b * r)
  }
  return Math.round(total)
}

/** TRIMP estimate from average HR only (imported workouts without samples). */
export function trimpFromAverage(durationS: number, avgHr: number, restingHr: number, maxHr: number, sex: 'male' | 'female' | null | undefined): number {
  const [a, b] = sex === 'female' ? [0.86, 1.67] : [0.64, 1.92]
  const r = Math.max(0, Math.min(1, (avgHr - restingHr) / (maxHr - restingHr)))
  return Math.round((durationS / 60) * r * a * Math.exp(b * r))
}

/**
 * Aerobic decoupling (Pa:HR): how much the speed-per-heartbeat ratio drops
 * from the first half to the second. < 5 % on a steady run = good aerobic
 * durability. Needs aligned speed and HR series.
 */
export function decoupling(speed: (number | null)[], hr: (number | null)[]): number | null {
  const n = Math.min(speed.length, hr.length)
  if (n < 10) return null
  const half = Math.floor(n / 2)
  const ratio = (from: number, to: number) => {
    let s = 0, h = 0, c = 0
    for (let i = from; i < to; i++) {
      if (speed[i] == null || hr[i] == null) continue
      s += speed[i]!
      h += hr[i]!
      c++
    }
    return c >= 3 && h > 0 ? s / h : null
  }
  const r1 = ratio(0, half)
  const r2 = ratio(half, n)
  if (r1 == null || r2 == null) return null
  return Math.round(((r1 - r2) / r1) * 1000) / 10
}

/** What the run trained, from its zone distribution. */
export function trainingEffect(zoneSeconds: number[]): { label: string; detail: string } | null {
  const total = zoneSeconds.reduce((a, b) => a + b, 0)
  if (total < 120) return null
  const p = zoneSeconds.map(s => s / total)
  if (p[4] >= 0.12) return { label: 'VO₂ max', detail: 'Hard intervals — raises your aerobic ceiling. Follow with 1–2 easy days.' }
  if (p[3] >= 0.25) return { label: 'Threshold', detail: 'Sustained hard effort — pushes lactate threshold. Recovery takes ~48 h.' }
  if (p[2] + p[3] >= 0.4) return { label: 'Tempo', detail: 'Steady, moderately hard. Good for race-specific endurance; easy to overdo.' }
  if (p[0] + p[1] >= 0.75) return { label: 'Base', detail: 'Mostly easy aerobic running — the foundation of every goal.' }
  return { label: 'Mixed', detail: 'A blend of easy and moderate running.' }
}

/** Share of time that was easy (z1–z2) — the 80/20 check. */
export function easyShare(zoneSeconds: number[]): number | null {
  const total = zoneSeconds.reduce((a, b) => a + b, 0)
  return total > 0 ? Math.round(((zoneSeconds[0] + zoneSeconds[1]) / total) * 100) : null
}

// Calories burned from the ring's heart rate and steps. Pure (unit-tested).
//
// Total = basal (Mifflin-St Jeor BMR, prorated through the day) + active.
// Active energy is worked out per 15-minute window, from whichever signal
// saw more of the effort:
//   heart rate  Keytel et al. (2005) for minutes clearly above resting, minus
//               the basal share so it isn't counted twice
//   steps       ~0.57 kcal per 1000 steps per kg of body weight
// Taking the larger of the two, rather than the sum, keeps a run (high heart
// rate and many steps) from being counted twice.

import type { Sex } from './nutrients'

export interface EnergyMinute {
  minute: string
  hr_avg: number | null
  steps: number | null
}

export interface EnergyBody {
  weightKg: number | null | undefined
  heightCm: number | null | undefined
  age: number | null | undefined
  sex: Sex | null | undefined
}

export interface EnergyDay {
  /** Full-day BMR. */
  bmr: number
  /** BMR for the part of the day that has passed. */
  basal: number
  active: number
  total: number
  fromHr: number
  fromSteps: number
  /** Share of elapsed 15-minute windows with any heart-rate reading, 0-1. */
  hrCoverage: number
  steps: number
}

const WINDOW_MIN = 15

export function bmr(b: EnergyBody): number {
  const w = b.weightKg && b.weightKg > 30 ? b.weightKg : b.sex === 'female' ? 62 : 75
  const h = b.heightCm && b.heightCm > 120 ? b.heightCm : b.sex === 'female' ? 166 : 178
  const a = b.age && b.age > 10 ? b.age : 30
  return Math.round(10 * w + 6.25 * h - 5 * a + (b.sex === 'female' ? -161 : 5))
}

/** Keytel gross energy expenditure in kcal per minute at a given heart rate. */
export function keytelPerMinute(hr: number, b: EnergyBody): number {
  const w = b.weightKg && b.weightKg > 30 ? b.weightKg : b.sex === 'female' ? 62 : 75
  const a = b.age && b.age > 10 ? b.age : 30
  const kj = b.sex === 'female'
    ? -20.4022 + 0.4472 * hr - 0.1263 * w + 0.074 * a
    : -55.0969 + 0.6309 * hr + 0.1988 * w + 0.2017 * a
  return Math.max(0, kj / 4.184)
}

export const kcalPerStep = (b: EnergyBody) =>
  0.00057 * (b.weightKg && b.weightKg > 30 ? b.weightKg : b.sex === 'female' ? 62 : 75)

/**
 * Energy for one local day. `dayStart` is local midnight; `now` caps the
 * prorated basal and the windows counted, so today shows "so far".
 */
export function energyForDay(o: {
  minutes: EnergyMinute[]
  body: EnergyBody
  restingHr: number | null | undefined
  dayStart: Date
  now?: Date
}): EnergyDay {
  const start = o.dayStart.getTime()
  const end = start + 1440 * 60_000
  const now = Math.min(end, (o.now ?? new Date()).getTime())
  const elapsedMin = Math.max(0, (now - start) / 60_000)
  const dayBmr = bmr(o.body)
  const basalPerMin = dayBmr / 1440
  // Keytel isn't meant for sitting still; only clearly elevated minutes count.
  const threshold = Math.max((o.restingHr ?? 60) + 20, 90)
  const perStep = kcalPerStep(o.body)

  const windows = new Map<number, { hr: number[]; steps: number }>()
  for (const m of o.minutes) {
    const t = new Date(m.minute).getTime()
    if (t < start || t >= now) continue
    const key = Math.floor((t - start) / (WINDOW_MIN * 60_000))
    const w = windows.get(key) ?? { hr: [], steps: 0 }
    if (m.hr_avg != null && m.hr_avg > 30 && m.hr_avg < 230) w.hr.push(m.hr_avg)
    // Ring steps live on the quarter-hour history slots (see lib/ring/aggregate.ts).
    if (m.steps && new Date(m.minute).getMinutes() % WINDOW_MIN === 0) w.steps += m.steps
    windows.set(key, w)
  }

  let fromHr = 0, fromSteps = 0, active = 0, steps = 0, withHr = 0
  for (const w of windows.values()) {
    steps += w.steps
    // Each sample stands for its share of the window (5-minute log → 3 samples).
    const hrKcal = w.hr.length
      ? (w.hr.reduce((a, hr) => a + (hr >= threshold ? Math.max(0, keytelPerMinute(hr, o.body) - basalPerMin) : 0), 0) / w.hr.length) * WINDOW_MIN
      : 0
    const stepKcal = w.steps * perStep
    if (w.hr.length) withHr++
    fromHr += hrKcal
    fromSteps += stepKcal
    active += Math.max(hrKcal, stepKcal)
  }

  const elapsedWindows = Math.max(1, Math.ceil(elapsedMin / WINDOW_MIN))
  const basal = Math.round(basalPerMin * elapsedMin)
  return {
    bmr: dayBmr,
    basal,
    active: Math.round(active),
    total: Math.round(basal + active),
    fromHr: Math.round(fromHr),
    fromSteps: Math.round(fromSteps),
    hrCoverage: Math.round((withHr / elapsedWindows) * 100) / 100,
    steps,
  }
}

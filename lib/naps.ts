// Naps: detection from ring data and their effect on sleep need. Pure (unit-tested).
//
// Detection looks for a daytime stretch (10:00-20:00) where heart rate sits
// within 4 bpm of your sleeping resting rate and the ring counted no steps,
// lasting at least 20 minutes. Awake-but-still heart rate is usually 8+ bpm
// above sleeping resting rate, which is what separates a nap from a sofa.
//
// Following WHOOP, a nap reduces that night's sleep need by the time napped,
// capped at 90 minutes (a nap never replaces a night).

export interface NapMinute {
  minute: string
  hr_avg: number | null
  steps: number | null
}

export interface Nap {
  start: number
  end: number
}

const MIN_NAP_MIN = 20
const MAX_GAP_MIN = 10
const HR_MARGIN = 4
const DAY_FROM_H = 10
const DAY_TO_H = 20

export function detectNaps(minutes: NapMinute[], restingHr: number | null | undefined, dayStart: Date): Nap[] {
  if (!restingHr) return []
  const from = dayStart.getTime() + DAY_FROM_H * 3600_000
  const to = dayStart.getTime() + DAY_TO_H * 3600_000

  // Quarter-hours with any steps are awake.
  const moving = new Set<number>()
  for (const m of minutes) {
    if (m.steps && m.steps > 0) moving.add(Math.floor(new Date(m.minute).getTime() / 900_000))
  }

  const samples = minutes
    .filter(m => m.hr_avg != null)
    .map(m => ({ t: new Date(m.minute).getTime(), hr: m.hr_avg! }))
    .filter(s => s.t >= from && s.t < to)
    .sort((a, b) => a.t - b.t)

  const naps: Nap[] = []
  let run: { t: number; hr: number }[] = []
  const close = () => {
    if (run.length >= 2) {
      const start = run[0].t
      // The last sample stands for the few minutes after it.
      const end = run[run.length - 1].t + 5 * 60_000
      if ((end - start) / 60_000 >= MIN_NAP_MIN) naps.push({ start, end })
    }
    run = []
  }
  for (const s of samples) {
    const calm = s.hr <= restingHr + HR_MARGIN && !moving.has(Math.floor(s.t / 900_000))
    const prev = run[run.length - 1]
    if (calm && (!prev || (s.t - prev.t) / 60_000 <= MAX_GAP_MIN)) run.push(s)
    else {
      close()
      if (calm) run.push(s)
    }
  }
  close()
  return naps
}

/** Merge overlapping naps (ring + manual for the same nap). */
export function mergeNaps(naps: Nap[]): Nap[] {
  const sorted = [...naps].sort((a, b) => a.start - b.start)
  const out: Nap[] = []
  for (const n of sorted) {
    const last = out[out.length - 1]
    if (last && n.start <= last.end) last.end = Math.max(last.end, n.end)
    else out.push({ ...n })
  }
  return out
}

export const NAP_CREDIT_CAP_MIN = 90

/**
 * Minutes a night's need is reduced by: naps after the previous wake-up and
 * before this sleep started. `after`/`before` bound that window.
 */
export function napCreditMin(naps: Nap[], after: number, before: number): number {
  const total = mergeNaps(naps)
    .filter(n => n.start >= after && n.end <= before)
    .reduce((a, n) => a + (n.end - n.start) / 60_000, 0)
  return Math.round(Math.min(NAP_CREDIT_CAP_MIN, total))
}

// VDOT fitness, race prediction, training paces and run recommendations.
// Pure and deterministic — an LLM can later rephrase the output, but the
// numbers come from here (Jack Daniels' running formula).

import { addDays, fromIso, localIso } from '../format'
import { paceText, raceTime } from './geo'
import type { Workout, WorkoutStep } from './workout'

// ─── VDOT ───

const vo2AtSpeed = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v // v in m/min
const fractionAtDuration = (tMin: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin)

/** Daniels VDOT for a race-effort performance. */
export function vdot(distanceM: number, timeS: number): number {
  const tMin = timeS / 60
  if (tMin <= 0 || distanceM <= 0) return 0
  return vo2AtSpeed(distanceM / tMin) / fractionAtDuration(tMin)
}

/** Equivalent race time for a VDOT (bisection — vdot() falls as time grows). */
export function timeForVdot(v: number, distanceM: number): number {
  let lo = distanceM / 7 // 7 m/s — faster than any human
  let hi = distanceM / 1.2
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (vdot(distanceM, mid) > v) lo = mid
    else hi = mid
  }
  return Math.round((lo + hi) / 2)
}

/** Seconds per km at a given fraction of VO₂max for this VDOT. */
function paceAtFraction(v: number, fraction: number): number {
  const vo2 = v * fraction
  const a = 0.000104, b = 0.182258, c = -(4.6 + vo2)
  const speed = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a) // m/min
  return Math.round(60_000 / speed)
}

export interface TrainingPaces {
  easy: [number, number]
  marathon: number
  threshold: number
  interval: number
  repetition: number
}

export function trainingPaces(v: number): TrainingPaces {
  const interval = paceAtFraction(v, 0.98)
  return {
    easy: [paceAtFraction(v, 0.72), paceAtFraction(v, 0.62)],
    marathon: Math.round(timeForVdot(v, 42195) / 42.195),
    threshold: paceAtFraction(v, 0.88),
    interval,
    repetition: interval - 12,
  }
}

// ─── Goals ───

export const GOAL_DISTANCES = [
  { m: 5000, label: '5K' },
  { m: 10000, label: '10K' },
  { m: 21097.5, label: 'Half' },
  { m: 42195, label: 'Marathon' },
] as const

export const distanceLabel = (m: number) =>
  GOAL_DISTANCES.find(d => Math.abs(d.m - m) < 1)?.label ?? `${(m / 1000).toFixed(1)} km`

export interface RunGoal { distanceM: number; targetS: number; raceDate?: string | null }

export interface GoalAssessment {
  title: string
  goalVdot: number
  currentVdot: number | null
  predictedS: number | null
  /** 0–100: how close current fitness is (goal − 8 VDOT = 0). */
  progress: number | null
  weeksLeft: number | null
  status: 'achieved' | 'on_track' | 'stretch' | 'long_term' | 'unknown'
  headline: string
  detail: string
  goalPaceS: number
}

/** Realistic VDOT gain for a consistent runner, per week of training. */
const VDOT_PER_WEEK = 0.3

export function assessGoal(goal: RunGoal, currentVdot: number | null, today = localIso()): GoalAssessment {
  const goalVdot = vdot(goal.distanceM, goal.targetS)
  const title = `Sub ${raceTime(goal.targetS)} ${distanceLabel(goal.distanceM)}`
  const weeksLeft = goal.raceDate
    ? Math.max(0, Math.round((fromIso(goal.raceDate).getTime() - fromIso(today).getTime()) / (7 * 86400_000)))
    : null
  const goalPaceS = Math.round(goal.targetS / (goal.distanceM / 1000))
  if (currentVdot == null) {
    return {
      title, goalVdot, currentVdot, predictedS: null, progress: null, weeksLeft, status: 'unknown', goalPaceS,
      headline: 'Run to calibrate',
      detail: 'Log a few runs of 3 km or more — your fitness estimate comes from your fastest recent efforts.',
    }
  }
  const predictedS = timeForVdot(currentVdot, goal.distanceM)
  const gap = goalVdot - currentVdot
  const progress = Math.round(Math.max(0, Math.min(100, ((currentVdot - (goalVdot - 8)) / 8) * 100)))
  const needWeeks = Math.ceil(Math.max(0, gap) / VDOT_PER_WEEK)
  let status: GoalAssessment['status']
  let headline: string
  let detail: string
  if (gap <= 0) {
    status = 'achieved'
    headline = 'Fitness is there'
    detail = `Your recent efforts predict ${raceTime(predictedS)}. Sharpen with race-pace work and taper into a time trial.`
  } else if (weeksLeft == null ? needWeeks <= 12 : gap <= weeksLeft * VDOT_PER_WEEK) {
    status = 'on_track'
    headline = 'On track'
    detail = `${raceTime(predictedS - goal.targetS)} to find — about ${needWeeks} week${needWeeks === 1 ? '' : 's'} of consistent training at this rate.`
  } else if (weeksLeft == null ? needWeeks <= 24 : gap <= weeksLeft * VDOT_PER_WEEK * 1.7) {
    status = 'stretch'
    headline = 'Stretch goal'
    detail = `Predicted ${raceTime(predictedS)} now. Reachable with a focused block${weeksLeft != null ? ' if every week counts' : ` of ~${needWeeks} weeks`}.`
  } else {
    status = 'long_term'
    headline = 'Long-term goal'
    detail = `Predicted ${raceTime(predictedS)} now. Set an intermediate target around ${raceTime(timeForVdot(currentVdot + 3, goal.distanceM))} first.`
  }
  return { title, goalVdot, currentVdot, predictedS, progress, weeksLeft, status, headline, detail, goalPaceS }
}

// ─── Fitness from history ───

export type RunKind = 'recovery' | 'easy' | 'long' | 'tempo' | 'intervals' | 'race'

export interface RunForPlan {
  date: string
  distanceM: number
  durationS: number
  kind: RunKind
  /** Fastest efforts found in the GPS track, keyed by metres. */
  bestEfforts?: Record<string, number> | null
}

/**
 * Current VDOT = best of the last 8 weeks, from GPS best efforts ≥ 3 km or
 * whole runs ≥ 3 km. Easy runs underestimate fitness, so taking the max
 * lets one honest hard effort set the level.
 */
export function currentVdot(runs: RunForPlan[], today = localIso(), windowDays = 56): number | null {
  const from = localIso(addDays(fromIso(today), -windowDays))
  let best = 0
  for (const r of runs) {
    if (r.date < from || r.date > today) continue
    if (r.distanceM >= 3000 && r.durationS > 0) best = Math.max(best, vdot(r.distanceM, r.durationS))
    for (const [d, s] of Object.entries(r.bestEfforts ?? {})) {
      if (Number(d) >= 3000) best = Math.max(best, vdot(Number(d), s))
    }
  }
  return best > 20 ? Math.round(best * 10) / 10 : null
}

/** Classify a run from its zone distribution, or pace vs threshold without HR. */
export function classifyRun(
  distanceM: number, durationS: number, zoneSeconds: number[] | null, paces: TrainingPaces | null, typicalKm: number,
): RunKind {
  const pace = durationS / Math.max(0.1, distanceM / 1000)
  const total = zoneSeconds?.reduce((a, b) => a + b, 0) ?? 0
  const longish = distanceM / 1000 >= Math.max(12, typicalKm * 1.5)
  if (zoneSeconds && total > 300) {
    const p = zoneSeconds.map(s => s / total)
    if (p[4] >= 0.12) return 'intervals'
    if (p[3] >= 0.25 || p[2] + p[3] >= 0.45) return longish ? 'long' : 'tempo'
    if (p[0] >= 0.7) return 'recovery'
    return longish ? 'long' : 'easy'
  }
  if (paces) {
    if (pace <= paces.threshold + 8) return durationS > 20 * 60 ? 'tempo' : 'intervals'
    if (pace >= paces.easy[1] + 25) return 'recovery'
  }
  return longish ? 'long' : 'easy'
}

// ─── Recommendations ───

export type SessionKind = 'rest' | 'recovery' | 'easy' | 'long' | 'tempo' | 'intervals' | 'race_pace' | 'marathon_pace'

export interface PlannedRun {
  date: string
  kind: SessionKind
  title: string
  detail: string
  distanceKm: number | null
  pace: string | null
  zone: string | null
  key: boolean
  done: boolean
  /** Step-by-step version the recorder can guide you through; null on rest days. */
  workout: Workout | null
  /** Why today's session differs from the plan (readiness, recent hard day…). */
  reason?: string
}

export interface PlanInput {
  today?: string
  goal: RunGoal | null
  vdot: number | null
  runs: RunForPlan[]
  /** Today's readiness 0–100. */
  readiness: number | null
  /** Training-stress balance ÷ fitness (see load.ts). */
  form: number | null
}

const HARD: RunKind[] = ['tempo', 'intervals', 'race', 'long']
const KEY: SessionKind[] = ['tempo', 'intervals', 'race_pace', 'marathon_pace', 'long']

/** Weekday template (0 = Mon). null = rest. Two key sessions + long run. */
function template(goalM: number | null): (SessionKind | null)[] {
  if (goalM != null && goalM <= 5000) return [null, 'intervals', 'easy', null, 'tempo', 'easy', 'long']
  if (goalM != null && goalM <= 10000) return [null, 'tempo', 'easy', null, 'intervals', 'easy', 'long']
  if (goalM != null && goalM <= 21100) return [null, 'tempo', 'easy', null, 'race_pace', 'easy', 'long']
  if (goalM != null) return [null, 'tempo', 'easy', null, 'marathon_pace', 'easy', 'long']
  return [null, 'easy', 'tempo', null, 'easy', null, 'long']
}

const MIN_WEEK_KM = (goalM: number | null) => (goalM == null ? 15 : goalM <= 5000 ? 25 : goalM <= 10000 ? 32 : goalM <= 21100 ? 42 : 55)
const MAX_LONG_KM = (goalM: number | null) => (goalM == null ? 14 : goalM <= 5000 ? 14 : goalM <= 10000 ? 18 : goalM <= 21100 ? 22 : 32)

const round1 = (x: number) => Math.round(x * 2) / 2
const weekIndex = (iso: string) => Math.floor(fromIso(iso).getTime() / (7 * 86400_000))
const weekday = (iso: string) => (fromIso(iso).getDay() + 6) % 7

function describe(kind: SessionKind, weekKm: number, goal: RunGoal | null, p: TrainingPaces | null, week: number): Omit<PlannedRun, 'date' | 'done' | 'key'> {
  const easy = p ? `${paceText(p.easy[0])}–${paceText(p.easy[1])}` : null
  const goalPace = goal ? Math.round(goal.targetS / (goal.distanceM / 1000)) : null
  // Easy running only warns when too fast; quality work warns both ways.
  const easyPace = p ? { fast: p.easy[0] - 10, slow: p.easy[1] + 30 } : undefined
  const around = (x: number | null | undefined, tol: number) => (x ? { fast: x - tol, slow: x + tol } : undefined)
  const warm = (m = 2000): WorkoutStep => ({ kind: 'warmup', label: 'Warm-up', distanceM: m, pace: easyPace, alert: 'fast' })
  const cool = (m = 1500): WorkoutStep => ({ kind: 'cooldown', label: 'Cool-down', distanceM: m, pace: easyPace, alert: 'none' })
  const repeat = (n: number, work: Omit<WorkoutStep, 'kind' | 'rep'>, rec: Omit<WorkoutStep, 'kind'>): WorkoutStep[] =>
    Array.from({ length: n }, (_, i) => [
      { ...work, kind: 'work' as const, rep: { n: i + 1, of: n } },
      ...(i < n - 1 ? [{ ...rec, kind: 'recovery' as const }] : []),
    ]).flat()

  switch (kind) {
    case 'rest':
      return { kind, title: 'Rest', detail: 'Full rest or 20–30 min walking. Adaptation happens now.', distanceKm: null, pace: null, zone: null, workout: null }
    case 'recovery': {
      const title = 'Recovery jog'
      return {
        kind, title, detail: '25–35 min truly easy. If legs feel heavy, walk instead.', distanceKm: 4, pace: p ? paceText(p.easy[1] + 20) : null, zone: 'Z1',
        workout: { title, kind, steps: [{ kind: 'steady', label: 'Easy jog', durationS: 30 * 60, pace: p ? { fast: p.easy[1], slow: p.easy[1] + 60 } : undefined, alert: 'fast' }] },
      }
    }
    case 'easy': {
      const d = Math.max(4, round1(weekKm * 0.17))
      const title = 'Easy run'
      return {
        kind, title, detail: `${d} km conversational. Finish with 4–6 × 20 s relaxed strides.`, distanceKm: d, pace: easy, zone: 'Z2',
        workout: { title, kind, steps: [
          { kind: 'steady', label: 'Easy', distanceM: d * 1000, pace: easyPace, alert: 'fast' },
          ...repeat(5, { label: 'Stride', durationS: 20 }, { label: 'Walk back', durationS: 60 }),
        ] },
      }
    }
    case 'long': {
      const d = Math.max(8, Math.min(MAX_LONG_KM(goal?.distanceM ?? null), round1(weekKm * 0.3)))
      const title = 'Long run'
      return {
        kind, title, detail: `${d} km steady and easy. Fuel if over 75 min.`, distanceKm: d, pace: easy, zone: 'Z2',
        workout: { title, kind, steps: [{ kind: 'steady', label: 'Long & easy', distanceM: d * 1000, pace: easyPace, alert: 'fast' }] },
      }
    }
    case 'tempo': {
      const t = Math.max(3, Math.min(8, round1(weekKm * 0.1)))
      const title = 'Threshold'
      return {
        kind, title, detail: `2 km warm-up · ${t} km @ ${p ? paceText(p.threshold) : 'comfortably hard'} /km · 1.5 km cool-down.`,
        distanceKm: t + 3.5, pace: p ? paceText(p.threshold) : null, zone: 'Z4',
        workout: { title, kind, steps: [
          warm(),
          { kind: 'work', label: 'Threshold', distanceM: t * 1000, pace: around(p?.threshold, 6), alert: 'both' },
          cool(),
        ] },
      }
    }
    case 'intervals': {
      const reps = Math.max(3, Math.min(6, Math.floor(weekKm * 0.08)))
      if (week % 2 === 0 || !goalPace) {
        const title = 'VO₂ intervals'
        return {
          kind, title, detail: `2 km warm-up · ${reps} × 1 km @ ${p ? paceText(p.interval) : 'hard'} /km, 2:30 jog · 1.5 km cool-down.`,
          distanceKm: reps + reps * 0.4 + 3.5, pace: p ? paceText(p.interval) : null, zone: 'Z5',
          workout: { title, kind, steps: [
            warm(),
            ...repeat(reps, { label: '1 km hard', distanceM: 1000, pace: around(p?.interval, 5), alert: 'both' }, { label: 'Jog', durationS: 150, alert: 'none' }),
            cool(),
          ] },
        }
      }
      const r = reps + 2
      const title = 'Race-pace 800s'
      return {
        kind, title, detail: `2 km warm-up · ${r} × 800 m @ ${paceText(goalPace)} /km goal pace, 90 s jog · 1.5 km cool-down.`,
        distanceKm: round1(r * 0.8 + r * 0.25 + 3.5), pace: paceText(goalPace), zone: 'Z4–5',
        workout: { title, kind, steps: [
          warm(),
          ...repeat(r, { label: '800 m @ goal pace', distanceM: 800, pace: around(goalPace, 4), alert: 'both' }, { label: 'Jog', durationS: 90, alert: 'none' }),
          cool(),
        ] },
      }
    }
    case 'race_pace': {
      const reps = Math.max(3, Math.min(5, Math.floor(weekKm / 10)))
      const title = 'Race-pace blocks'
      return {
        kind, title, detail: `2 km warm-up · ${reps} × 2 km @ ${goalPace ? paceText(goalPace) : 'goal pace'} /km, 2 min jog · 1.5 km cool-down.`,
        distanceKm: reps * 2 + reps * 0.4 + 3.5, pace: goalPace ? paceText(goalPace) : null, zone: 'Z3–4',
        workout: { title, kind, steps: [
          warm(),
          ...repeat(reps, { label: '2 km @ goal pace', distanceM: 2000, pace: around(goalPace, 5), alert: 'both' }, { label: 'Jog', durationS: 120, alert: 'none' }),
          cool(),
        ] },
      }
    }
    case 'marathon_pace': {
      const d = Math.max(6, Math.min(16, round1(weekKm * 0.2)))
      const mp = goalPace ?? p?.marathon ?? null
      const title = 'Marathon pace'
      return {
        kind, title, detail: `2 km easy · ${d} km @ ${mp ? paceText(mp) : 'goal pace'} /km · 1 km easy.`,
        distanceKm: d + 3, pace: mp ? paceText(mp) : null, zone: 'Z3',
        workout: { title, kind, steps: [
          warm(),
          { kind: 'work', label: 'Marathon pace', distanceM: d * 1000, pace: around(mp, 8), alert: 'both' },
          cool(1000),
        ] },
      }
    }
  }
}

/**
 * The next 7 days, starting today. Weekly volume grows ~8 %/week from the
 * last 4 weeks' average toward the goal's minimum. Today's session is
 * adjusted for readiness, form and yesterday's training.
 */
export function planWeek(input: PlanInput): { days: PlannedRun[]; weekKm: number; baseKm: number; paces: TrainingPaces | null } {
  const today = input.today ?? localIso()
  const goalM = input.goal?.distanceM ?? null
  const from28 = localIso(addDays(fromIso(today), -28))
  const recent = input.runs.filter(r => r.date >= from28 && r.date <= today)
  const baseKm = recent.reduce((a, r) => a + r.distanceM, 0) / 1000 / 4
  const weekKm = Math.round(Math.max(12, Math.min(baseKm * 1.08, baseKm + 6), Math.min(MIN_WEEK_KM(goalM), Math.max(12, baseKm + 4))))
  const paces = input.vdot ? trainingPaces(input.vdot) : null
  const tpl = template(goalM)

  const days: PlannedRun[] = []
  for (let i = 0; i < 7; i++) {
    const date = localIso(addDays(fromIso(today), i))
    const ran = input.runs.filter(r => r.date === date)
    let kind: SessionKind = tpl[weekday(date)] ?? 'rest'
    let reason: string | undefined

    if (i === 0) {
      const yesterday = localIso(addDays(fromIso(today), -1))
      const hardYesterday = input.runs.some(r => r.date === yesterday && HARD.includes(r.kind))
      if (input.readiness != null && input.readiness < 40) {
        kind = 'rest'
        reason = `Readiness ${input.readiness} — recovery comes first today.`
      } else if (input.form != null && input.form < -0.5) {
        kind = KEY.includes(kind) ? 'recovery' : kind === 'rest' ? 'rest' : 'recovery'
        reason = 'Training stress is well above your fitness — back off before it becomes fatigue.'
      } else if (KEY.includes(kind) && hardYesterday) {
        kind = 'easy'
        reason = 'Hard session yesterday — key work moves later in the week.'
      } else if (KEY.includes(kind) && kind !== 'long' && input.readiness != null && input.readiness < 55) {
        kind = 'easy'
        reason = `Readiness ${input.readiness} — swap intensity for an easy run.`
      }
    }

    const d = describe(kind, weekKm, input.goal, paces, weekIndex(date))
    days.push({ ...d, date, key: KEY.includes(kind), done: ran.length > 0, reason })
  }
  return { days, weekKm, baseKm: Math.round(baseKm * 10) / 10, paces }
}

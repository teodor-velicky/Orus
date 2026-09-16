// Structured workouts: steps with distance/time and pace targets, progress
// through them during a run, and pace feedback. Pure (unit-tested).

import { paceText } from './geo'

export type StepKind = 'warmup' | 'work' | 'recovery' | 'cooldown' | 'steady'

export interface WorkoutStep {
  kind: StepKind
  label: string
  /** Exactly one of distanceM / durationS; neither = open-ended. */
  distanceM?: number
  durationS?: number
  /** Target pace window in s/km: `fast` is the quicker bound. */
  pace?: { fast: number; slow: number }
  /** Which deviations to call out. Easy running only warns when too fast. */
  alert?: 'both' | 'fast' | 'none'
  /** e.g. rep 3 of 5 */
  rep?: { n: number; of: number }
}

export interface Workout {
  title: string
  kind: string
  steps: WorkoutStep[]
}

export interface StepState {
  index: number
  /** Distance and active seconds when the current step started. */
  startM: number
  startS: number
  /** All steps finished — the run continues as a free run. */
  complete: boolean
}

export const initialStep = (): StepState => ({ index: 0, startM: 0, startS: 0, complete: false })

export interface StepProgress {
  step: WorkoutStep | null
  next: WorkoutStep | null
  index: number
  /** 0–1 */
  fraction: number
  /** Remaining metres or seconds in the step (whichever it's measured in). */
  remaining: number | null
  unit: 'm' | 's' | null
  doneM: number
  doneS: number
  complete: boolean
}

export function progress(w: Workout, st: StepState, distanceM: number, activeS: number): StepProgress {
  const step = st.complete ? null : w.steps[st.index] ?? null
  const doneM = distanceM - st.startM
  const doneS = activeS - st.startS
  let fraction = 0, remaining: number | null = null, unit: StepProgress['unit'] = null
  if (step?.distanceM) {
    fraction = Math.min(1, doneM / step.distanceM)
    remaining = Math.max(0, step.distanceM - doneM)
    unit = 'm'
  } else if (step?.durationS) {
    fraction = Math.min(1, doneS / step.durationS)
    remaining = Math.max(0, step.durationS - doneS)
    unit = 's'
  }
  return {
    step, next: st.complete ? null : w.steps[st.index + 1] ?? null, index: st.index,
    fraction, remaining, unit, doneM, doneS, complete: st.complete,
  }
}

/** Move to the next step when the current one is finished (or `force`, the skip button). */
export function advance(w: Workout, st: StepState, distanceM: number, activeS: number, force = false): StepState {
  if (st.complete) return st
  const step = w.steps[st.index]
  if (!step) return { ...st, complete: true }
  const finished = force
    || (step.distanceM != null && distanceM - st.startM >= step.distanceM)
    || (step.durationS != null && activeS - st.startS >= step.durationS)
  if (!finished) return st
  const index = st.index + 1
  return { index, startM: distanceM, startS: activeS, complete: index >= w.steps.length }
}

export type PaceStatus = 'fast' | 'slow' | 'on' | null

/**
 * Compare current pace against the step target. Ignores the first 20 s of a
 * step (accelerating / slowing down) and steps without a target.
 */
export function paceStatus(step: WorkoutStep | null, paceS: number | null, stepElapsedS: number): PaceStatus {
  if (!step?.pace || paceS == null || step.alert === 'none' || stepElapsedS < 20) return null
  if (paceS < step.pace.fast) return step.alert === 'both' || step.alert === 'fast' ? 'fast' : 'on'
  if (paceS > step.pace.slow) return step.alert === 'both' ? 'slow' : 'on'
  return 'on'
}

const dist = (m: number) => (m >= 1000 ? `${Number((m / 1000).toFixed(1))} km` : `${Math.round(m)} m`)
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s} s`)

export const stepAmount = (s: WorkoutStep) =>
  s.distanceM ? dist(s.distanceM) : s.durationS ? dur(s.durationS) : 'open'

export const paceRange = (s: WorkoutStep) =>
  s.pace ? (s.pace.fast === s.pace.slow ? paceText(s.pace.fast) : `${paceText(s.pace.fast)}–${paceText(s.pace.slow)}`) : null

function spokenAmount(s: WorkoutStep): string {
  if (s.distanceM) return s.distanceM >= 1000 ? `${Number((s.distanceM / 1000).toFixed(1))} kilometres` : `${Math.round(s.distanceM)} metres`
  if (s.durationS) {
    const m = Math.floor(s.durationS / 60), sec = s.durationS % 60
    return [m ? `${m} minute${m === 1 ? '' : 's'}` : '', sec ? `${sec} seconds` : ''].filter(Boolean).join(' ')
  }
  return ''
}

/** What the voice says when a step starts. */
export function stepCue(s: WorkoutStep): string {
  const rep = s.rep ? `Rep ${s.rep.n} of ${s.rep.of}. ` : ''
  const amount = spokenAmount(s)
  switch (s.kind) {
    case 'work': {
      const target = s.pace ? ` at ${spokenPace(Math.round((s.pace.fast + s.pace.slow) / 2))} per kilometre` : ''
      return `${rep}Go. ${amount}${target}.`
    }
    case 'recovery': return `Recover. Easy jog for ${amount}.`
    case 'warmup': return `Warm up. ${amount} easy.`
    case 'cooldown': return `Cool down. ${amount} easy.`
    default: return `${s.label}. ${amount}${s.pace && s.alert === 'fast' ? `, no faster than ${spokenPace(s.pace.fast)} per kilometre` : ''}.`
  }
}

export function paceCue(status: PaceStatus, s: WorkoutStep): string | null {
  if (!s.pace) return null
  if (status === 'fast') return `Too fast. Ease back to ${spokenPace(s.pace.fast)}.`
  if (status === 'slow') return `A bit slow. Pick it up to ${spokenPace(s.pace.slow)}.`
  return null
}

function spokenPace(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return sec === 0 ? `${m} minutes` : `${m} ${String(sec).padStart(2, '0')}`
}

// ─── Live guidance view model ───

const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

const STEP_NAME: Record<StepKind, string> = { warmup: 'Warm-up', work: 'Run', recovery: 'Recover', cooldown: 'Cool-down', steady: 'Run' }

export function guideModel(w: Workout, st: StepState, distanceM: number, activeS: number, paceS: number | null) {
  const pr = progress(w, st, distanceM, activeS)
  const step = pr.step
  const status = paceStatus(step, paceS, pr.doneS)
  const target = step?.pace
    ? status === 'fast' ? paceText(step.pace.fast)
      : status === 'slow' ? paceText(step.pace.slow)
        : paceRange(step)
    : null
  return {
    title: w.title,
    stepKind: step?.kind ?? 'steady',
    stepLabel: step ? (step.kind === 'work' || step.kind === 'steady' ? step.label : STEP_NAME[step.kind]) : '',
    counter: step?.rep ? `Rep ${step.rep.n} of ${step.rep.of}`
      : step?.kind === 'recovery' && w.steps[pr.index - 1]?.rep ? `Rep ${w.steps[pr.index - 1].rep!.n} of ${w.steps[pr.index - 1].rep!.of} done`
        : `Step ${Math.min(pr.index + 1, w.steps.length)} of ${w.steps.length}`,
    remainingText: pr.remaining == null ? null
      : pr.unit === 's' ? clockText(pr.remaining)
        : pr.remaining >= 1000 ? (pr.remaining / 1000).toFixed(2) : String(Math.round(pr.remaining / 10) * 10),
    remainingUnit: pr.remaining == null ? null : pr.unit === 's' ? 'left' : pr.remaining >= 1000 ? 'km left' : 'm left',
    target,
    fraction: pr.fraction,
    status: step?.alert === 'none' ? null : status,
    nextText: pr.next ? `${pr.next.kind === 'recovery' ? 'Recover' : pr.next.label} · ${stepAmount(pr.next)}${pr.next.pace && pr.next.kind === 'work' ? ` @ ${paceRange(pr.next)}` : ''}` : pr.complete ? null : 'Finish',
    complete: pr.complete,
  }
}

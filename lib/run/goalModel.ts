// Goal editor state → RunGoalModel. Pure.

import { addDays, fromIso, localIso } from '../format'
import { raceTime } from './geo'
import { assessGoal, GOAL_DISTANCES, timeForVdot, trainingPaces, vdot } from './plan'
import type { RunGoalModel } from '../../components/views/RunGoalView'

export interface GoalDraft { distance: string; h: string; m: string; s: string; weeks: number | null }

export const WEEK_OPTIONS = [null, 6, 8, 12, 16, 24]

export const draftSeconds = (d: GoalDraft) =>
  (Number(d.h) || 0) * 3600 + (Number(d.m) || 0) * 60 + (Number(d.s) || 0)

export function draftFromSeconds(distance: string, seconds: number, weeks: number | null): GoalDraft {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return { distance, h: h ? String(h) : '', m: String(m).padStart(2, '0'), s: String(s).padStart(2, '0'), weeks }
}

export const raceDateFor = (weeks: number | null, today = localIso()) =>
  weeks == null ? null : localIso(addDays(fromIso(today), weeks * 7))

export const weeksUntil = (date: string | null, today = localIso()) => {
  if (!date) return null
  const w = Math.round((fromIso(date).getTime() - fromIso(today).getTime()) / (7 * 86400_000))
  return WEEK_OPTIONS.reduce<number | null>((best, o) => (o != null && (best == null || Math.abs(o - w) < Math.abs(best - w)) ? o : best), null)
}

/** Round targets around the current prediction: a realistic, a stretch and a bold one. */
function quickTargets(distanceM: number, currentVdot: number | null): { label: string; seconds: number }[] {
  const step = distanceM <= 5000 ? 60 : distanceM <= 10000 ? 120 : distanceM <= 21100 ? 300 : 600
  const base = currentVdot ? timeForVdot(currentVdot, distanceM) : distanceM <= 5000 ? 1500 : distanceM <= 10000 ? 3300 : distanceM <= 21100 ? 7200 : 14400
  const first = Math.floor(base / step) * step
  return [0, 1, 2, 3].map(k => first - k * step).filter(s => s > 0).map(s => ({ label: `Sub ${raceTime(s)}`, seconds: s }))
}

export function goalModel(d: GoalDraft, currentVdot: number | null, o: { hasGoal: boolean; saving: boolean }): RunGoalModel {
  const distanceM = Number(d.distance)
  const seconds = draftSeconds(d)
  // Sanity: faster than ~2:00/km or slower than 12:00/km isn't a race goal.
  const pace = seconds / (distanceM / 1000)
  const valid = seconds > 0 && pace >= 150 && pace <= 720
  const assessment = valid ? assessGoal({ distanceM, targetS: seconds, raceDate: raceDateFor(d.weeks) }, currentVdot) : null
  return {
    distance: d.distance,
    distances: GOAL_DISTANCES.map(x => ({ value: String(x.m), label: x.label })),
    h: d.h, m: d.m, s: d.s,
    showHours: distanceM > 10000,
    weeks: d.weeks,
    weekOptions: WEEK_OPTIONS,
    quickTargets: quickTargets(distanceM, currentVdot),
    assessment,
    goalPaces: valid ? trainingPaces(vdot(distanceM, seconds)) : null,
    hasGoal: o.hasGoal,
    saving: o.saving,
    valid,
  }
}

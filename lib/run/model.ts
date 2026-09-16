// Raw training data → the Running tab and calendar models. Pure, so the
// live screen and the design preview share it.

import { addDays, duration, fromIso, localIso, shortDate } from '../format'
import type { DailyMetrics, GymSession, GymSet, Profile, Run, RunGoalRow, Workout } from '../types'
import type { RunningModel } from '../../components/views/RunningView'
import type { CalendarActivity } from '../../components/run'
import { paceText, raceTime } from './geo'
import { assessGoal, currentVdot, distanceLabel, planWeek } from './plan'
import { fitnessSeries, formLabel, formRatio, LoadDay } from './load'
import { easyShare } from './zones'
import { deriveRun, isRunWorkout, kmByDay, runDate, toPlanRuns, trainingEvents, ZoneSettings } from './training'
import { trainingPaces } from './plan'

type SessionWithSets = GymSession & { sets: GymSet[] }

export interface TrainingData {
  runs: Run[]
  sessions: SessionWithSets[]
  workouts: Workout[]
  metrics: DailyMetrics[]
  goal: RunGoalRow | null
  profile: Profile | null
  zs: ZoneSettings
}

/** Derive every run once (zones, kind, splits) with the current settings. */
export function prepareRuns(runs: Run[], zs: ZoneSettings, sex: Profile['sex']): Run[] {
  const vdot = currentVdot(toPlanRuns(runs))
  const paces = vdot ? trainingPaces(vdot) : null
  const recent = runs.slice(0, 20)
  const typicalKm = recent.length ? recent.reduce((a, r) => a + r.distance_m, 0) / recent.length / 1000 : 7
  return runs.map(r => deriveRun(r, zs, sex, typicalKm, paces))
}

/** Daily load + fitness/fatigue/form through `today`. */
export function loadSeries(d: TrainingData, today = localIso(), days = 90): LoadDay[] {
  const events = trainingEvents({ runs: d.runs, sessions: d.sessions, workouts: d.workouts, zs: d.zs, sex: d.profile?.sex ?? null })
  return fitnessSeries(events, localIso(addDays(fromIso(today), -days)), today)
}

const SOURCE_LABEL: Record<Run['source'], string> = { orus: 'Orus', apple_health: 'Health', strava: 'Strava' }

export function runningModel(d: TrainingData, o: {
  isMe: boolean
  readiness: number | null
  today?: string
  recording?: RunningModel['recording']
  ring?: { name: string; connected: boolean } | null
  healthAvailable: boolean
  previews?: Record<string, [number, number][]>
}): RunningModel {
  const today = o.today ?? localIso()
  const plans = toPlanRuns(d.runs)
  const vdot = currentVdot(plans, today)
  const series = loadSeries(d, today)
  const todayLoad = series[series.length - 1]
  const form = formRatio(todayLoad)
  const plan = planWeek({
    today, vdot, runs: plans, readiness: o.readiness, form,
    goal: d.goal ? { distanceM: d.goal.distance_m, targetS: d.goal.target_s, raceDate: d.goal.race_date } : null,
  })

  // This week = Monday → today
  const monday = localIso(addDays(fromIso(today), -((fromIso(today).getDay() + 6) % 7)))
  const week = d.runs.filter(r => runDate(r) >= monday && runDate(r) <= today)
  const weekKm = week.reduce((a, r) => a + r.distance_m, 0) / 1000
  const weekTime = week.reduce((a, r) => a + (r.moving_s ?? r.duration_s), 0)

  // 12 weeks of distance, Monday-aligned
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = localIso(addDays(fromIso(monday), (i - 11) * 7))
    const end = localIso(addDays(fromIso(start), 6))
    return {
      km: d.runs.filter(r => runDate(r) >= start && runDate(r) <= end).reduce((a, r) => a + r.distance_m, 0) / 1000,
      label: i === 11 ? 'NOW' : String(fromIso(start).getDate()),
    }
  })

  const from28 = localIso(addDays(fromIso(today), -28))
  const zoneSeconds = [0, 0, 0, 0, 0]
  for (const r of d.runs) {
    if (runDate(r) < from28 || !r.zones) continue
    r.zones.forEach((s, i) => { zoneSeconds[i] += s })
  }

  // Best efforts: GPS segments, or whole runs of (almost exactly) that distance.
  const records: RunningModel['records'] = []
  for (const dist of [1000, 5000, 10000, 21097.5]) {
    let best: { timeS: number; run: Run } | null = null
    for (const r of d.runs) {
      const seg = r.best_efforts?.[String(dist)]
      const whole = Math.abs(r.distance_m - dist) / dist < 0.03 ? (r.moving_s ?? r.duration_s) * (dist / r.distance_m) : null
      const t = seg ?? whole
      if (t && (!best || t < best.timeS)) best = { timeS: Math.round(t), run: r }
    }
    if (best) records.push({ label: dist === 1000 ? '1K' : distanceLabel(dist), timeS: best.timeS, date: shortDate(best.run.start_at), runId: best.run.id })
  }

  return {
    isMe: o.isMe,
    recording: o.recording,
    hrSource: o.ring ? 'ring' : o.healthAvailable ? 'health' : 'none',
    ringName: o.ring?.name,
    goal: d.goal ? assessGoal({ distanceM: d.goal.distance_m, targetS: d.goal.target_s, raceDate: d.goal.race_date }, vdot, today) : null,
    plan: { days: plan.days, weekKm: plan.weekKm, baseKm: plan.baseKm },
    paces: plan.paces,
    vdot,
    week: { km: weekKm, runs: week.length, timeS: weekTime, paceS: weekKm > 0 ? Math.round(weekTime / weekKm) : null },
    weeks: { km: weeks.map(w => Math.round(w.km * 10) / 10), labels: weeks.map(w => w.label) },
    load: todayLoad && todayLoad.ctl >= 1 ? {
      ctl: todayLoad.ctl, atl: todayLoad.atl, tsb: todayLoad.tsb,
      ctlSeries: series.slice(-42).map(x => x.ctl), form: formLabel(form),
    } : null,
    zones: {
      zones: d.zs.zones, seconds: zoneSeconds, easyPct: easyShare(zoneSeconds),
      maxHr: d.zs.maxHr, restingHr: d.zs.restingHr, estimated: d.zs.maxEstimated,
    },
    records,
    runs: d.runs.slice(0, 15).map(r => {
      const moving = r.moving_s ?? r.duration_s
      return {
        id: r.id, title: r.name ?? 'Run', when: shortDate(r.start_at), km: r.distance_m / 1000, durationS: moving,
        paceS: r.distance_m > 0 ? Math.round(moving / (r.distance_m / 1000)) : null,
        avgHr: r.avg_hr ? Math.round(r.avg_hr) : null, kind: r.kind, source: SOURCE_LABEL[r.source],
        route: o.previews?.[r.id] ?? null,
      }
    }),
  }
}

/** Every training activity for the calendar. Running workouts are covered by `runs`. */
export function calendarActivities(d: Pick<TrainingData, 'runs' | 'sessions' | 'workouts'>, setVolume: (s: GymSet) => number): CalendarActivity[] {
  const out: CalendarActivity[] = []
  for (const r of d.runs) {
    const moving = r.moving_s ?? r.duration_s
    out.push({
      key: `r-${r.id}`, date: runDate(r), kind: 'run', title: r.name ?? 'Run', km: r.distance_m / 1000,
      sub: [`${(r.distance_m / 1000).toFixed(2)} km`, raceTime(moving), r.distance_m > 0 ? `${paceText(moving / (r.distance_m / 1000))} /km` : null, r.kind].filter(Boolean).join(' · '),
      runId: r.lite ? undefined : r.id,
    })
  }
  for (const s of d.sessions) {
    const done = s.sets.filter(x => x.completed && !x.is_warmup)
    const dur = s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000 : null
    out.push({
      key: `g-${s.id}`, date: localIso(new Date(s.started_at)), kind: 'gym', title: s.name, sessionId: s.id,
      sub: [`${done.length} sets`, `${Math.round(done.reduce((a, x) => a + setVolume(x), 0)).toLocaleString('en-US')} kg`, dur ? duration(dur) : null].filter(Boolean).join(' · '),
    })
  }
  for (const w of d.workouts) {
    if (isRunWorkout(w)) continue
    if (/strength|functional/i.test(w.activity) && d.sessions.some(s => Math.abs(new Date(s.started_at).getTime() - new Date(w.start_at).getTime()) < 30 * 60_000)) continue
    out.push({
      key: `w-${w.source}-${w.external_id}`, date: localIso(new Date(w.start_at)), kind: /strength|functional|core/i.test(w.activity) ? 'gym' : 'other',
      title: w.name ?? w.activity,
      sub: [duration(w.duration_s), w.distance_m ? `${(Number(w.distance_m) / 1000).toFixed(1)} km` : null, w.avg_hr ? `${Math.round(w.avg_hr)} bpm` : null, w.source_name].filter(Boolean).join(' · '),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

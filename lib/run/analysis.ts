// Deterministic run insights + the compact summary sent to the LLM.

import { invokeFn } from '../supabase'
import type { Run, RunAnalysis } from '../types'
import { hrSeries, paceText, raceTime, speedSeries } from './geo'
import { decoupling, easyShare, trainingEffect } from './zones'
import { hrToSamples, routeToPoints, ZoneSettings } from './training'
import type { GoalAssessment } from './plan'

export interface RunInsights {
  paceS: number | null
  speed: (number | null)[]
  hr: (number | null)[]
  decouplingPct: number | null
  effect: { label: string; detail: string } | null
  easyPct: number | null
  fastestSplit: number | null
  slowestSplit: number | null
  /** Second half vs first half pace (negative = negative split). */
  splitDeltaS: number | null
}

export function runInsights(run: Run): RunInsights {
  const pts = routeToPoints(run)
  const hr = hrToSamples(run)
  const start = new Date(run.start_at).getTime()
  const end = new Date(run.end_at).getTime()
  const speed = speedSeries(pts, 60)
  const hrS = hr.length ? hrSeries(hr, pts[0]?.t ?? start, pts[pts.length - 1]?.t ?? end, 60) : []
  const full = (run.splits ?? []).filter(s => s.distanceM >= 900)
  const half = Math.floor(full.length / 2)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const first = avg(full.slice(0, half).map(s => s.paceS))
  const second = avg(full.slice(full.length - half).map(s => s.paceS))
  const moving = run.moving_s ?? run.duration_s
  return {
    paceS: run.distance_m > 0 ? Math.round(moving / (run.distance_m / 1000)) : null,
    speed,
    hr: hrS,
    decouplingPct: speed.length && hrS.length ? decoupling(speed, hrS) : null,
    effect: run.zones ? trainingEffect(run.zones) : null,
    easyPct: run.zones ? easyShare(run.zones) : null,
    fastestSplit: full.length ? Math.min(...full.map(s => s.paceS)) : null,
    slowestSplit: full.length ? Math.max(...full.map(s => s.paceS)) : null,
    splitDeltaS: half > 0 && first != null && second != null ? Math.round(second - first) : null,
  }
}

export function analysisSummary(o: {
  run: Run
  insights: RunInsights
  zs: ZoneSettings
  goal: GoalAssessment | null
  weekKm: number
  readiness: number | null
}) {
  const { run, insights: i, zs } = o
  return {
    run: {
      name: run.name, kind: run.kind, date: run.start_at.slice(0, 10),
      distanceKm: Math.round(run.distance_m / 10) / 100,
      movingTime: raceTime(run.moving_s ?? run.duration_s),
      avgPace: paceText(i.paceS),
      elevationGainM: run.elevation_gain_m,
      avgHr: run.avg_hr, maxHr: run.max_hr, hrSource: run.hr_source,
      perceivedEffort: run.perceived_effort, notes: run.notes,
      splits: (run.splits ?? []).slice(0, 45).map(s => ({ km: s.km, pace: paceText(s.paceS), hr: s.avgHr, elev: s.elevDeltaM })),
      secondHalfVsFirstHalfSecPerKm: i.splitDeltaS,
      aerobicDecouplingPct: i.decouplingPct,
      trainingEffect: i.effect?.label ?? null,
      trimp: run.trimp,
    },
    heartRateZones: run.zones
      ? zs.zones.map((z, k) => ({ zone: `Z${z.n} ${z.name}`, bpm: `${z.lo}-${z.hi}`, minutes: Math.round((run.zones![k] ?? 0) / 6) / 10 }))
      : null,
    athlete: { maxHr: zs.maxHr, restingHr: zs.restingHr, weeklyKm: Math.round(o.weekKm), readinessToday: o.readiness },
    goal: o.goal ? { title: o.goal.title, predicted: raceTime(o.goal.predictedS), status: o.goal.status, weeksLeft: o.goal.weeksLeft } : null,
  }
}

export async function analyzeRun(runId: string, summary: ReturnType<typeof analysisSummary>): Promise<RunAnalysis> {
  const res = await invokeFn<{ analysis: RunAnalysis }>('analyze-run', { runId, summary })
  return res.analysis
}

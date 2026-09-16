// Run row → RunDetailModel (shared by the live screen and the design preview).

import { clock, localIso, prettyDate } from '../format'
import type { Run } from '../types'
import type { RunDetailModel } from '../../components/views/RunDetailView'
import { haversine } from './geo'
import { runInsights } from './analysis'
import { routeToPoints, ZoneSettings } from './training'

const SOURCE: Record<Run['source'], string> = {
  orus: 'Recorded with Orus', apple_health: 'Imported from Apple Health', strava: 'Imported from Strava',
}
const HR: Record<NonNullable<Run['hr_source']>, string> = {
  ring: 'heart rate from the ring', watch: 'heart rate from Apple Health', strava: 'heart rate from Strava',
}

export function runDetailModel(run: Run, zs: ZoneSettings, o: {
  isMe: boolean; analyzing: boolean; canBackfillHr: boolean; backfilling: boolean
}): RunDetailModel {
  const pts = routeToPoints(run)
  // Per-point speed along the (simplified) route for luminance.
  const routeSpeeds = pts.map((p, k) => {
    const prev = pts[k - 1]
    if (!prev || prev.seg !== p.seg) return null
    const dt = (p.t - prev.t) / 1000
    return dt > 0 ? haversine(prev, p) / dt : null
  })
  const start = new Date(run.start_at)
  return {
    isMe: o.isMe,
    eyebrow: `${prettyDate(localIso(start))} · ${clock(start)}`,
    title: run.name ?? 'Run',
    kind: run.kind,
    distanceM: run.distance_m,
    movingS: run.moving_s ?? run.duration_s,
    elapsedS: run.duration_s,
    elevationM: run.elevation_gain_m,
    avgHr: run.avg_hr, maxHr: run.max_hr, kcal: run.kcal, trimp: run.trimp,
    effort: run.perceived_effort, notes: run.notes,
    route: pts.map(p => [p.lat, p.lng]),
    routeSpeeds,
    insights: runInsights(run),
    zones: zs.zones,
    zoneSeconds: run.zones,
    splits: run.splits ?? [],
    sourceText: [SOURCE[run.source], run.hr_source ? HR[run.hr_source] : 'no heart rate'].join(' · '),
    lite: !!run.lite,
    analysis: run.analysis,
    analyzing: o.analyzing,
    canBackfillHr: o.canBackfillHr,
    backfilling: o.backfilling,
  }
}


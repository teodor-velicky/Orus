import { useCallback, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSession } from '../../lib/session'
import { heartRateBetween, isHealthAvailable } from '../../lib/health'
import { metricsRange } from '../../lib/metrics'
import { deleteRun, getGoal, getRun, runsRange, updateRun } from '../../lib/run/data'
import { analysisSummary, analyzeRun, runInsights } from '../../lib/run/analysis'
import { runDetailModel } from '../../lib/run/detail'
import { assessGoal, currentVdot } from '../../lib/run/plan'
import { buildRun, deriveRun, hrToSamples, routeToPoints, runDate, toPlanRuns, zoneSettings, ZoneSettings } from '../../lib/run/training'
import { addDays, localIso } from '../../lib/format'
import type { Run } from '../../lib/types'
import { RunDetailView } from '../../components/views/RunDetailView'
import { Loading, Screen } from '../../components/ui'

export default function RunDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { me, people, viewing } = useSession()
  const [run, setRun] = useState<Run | null>(null)
  const [recent, setRecent] = useState<Run[]>([])
  const [zs, setZs] = useState<ZoneSettings | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [backfilling, setBackfilling] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    // Summary-only runs (Apple Health / Strava workouts without detail) have synthetic ids.
    const ownerGuess = viewing?.id ?? me?.id
    let r = id.startsWith('w-') && ownerGuess
      ? (await runsRange(ownerGuess, 365)).find(x => x.id === id) ?? null
      : await getRun(id)
    if (!r) return
    const owner = people.find(p => p.id === r!.user_id) ?? null
    const [metrics, runs] = await Promise.all([metricsRange(r.user_id, 21), runsRange(r.user_id, 60)])
    const settings = zoneSettings(owner, metrics, runs)
    r = deriveRun(r, settings, owner?.sex ?? null)
    setZs(settings)
    setRecent(runs)
    setRun(r)
  }, [id, people, viewing?.id, me?.id])

  useEffect(() => { load().catch(e => Alert.alert('Could not load run', (e as Error).message)) }, [load])

  if (!run || !zs) return <Screen><Loading /></Screen>
  const isMe = run.user_id === me?.id
  const owner = people.find(p => p.id === run.user_id) ?? null

  const model = runDetailModel(run, zs, {
    isMe, analyzing, backfilling,
    canBackfillHr: isMe && !run.lite && !run.hr?.length && isHealthAvailable(),
  })

  return (
    <RunDetailView
      m={model}
      h={{
        onBack: () => router.back(),
        onAnalyze: async () => {
          setAnalyzing(true)
          try {
            const goal = await getGoal(run.user_id)
            const plans = toPlanRuns(recent)
            const from7 = localIso(addDays(new Date(), -7))
            const summary = analysisSummary({
              run, zs, insights: runInsights(run),
              goal: goal ? assessGoal({ distanceM: goal.distance_m, targetS: goal.target_s, raceDate: goal.race_date }, currentVdot(plans)) : null,
              weekKm: recent.filter(r => runDate(r) >= from7).reduce((a, r) => a + r.distance_m, 0) / 1000,
              readiness: null,
            })
            const analysis = await analyzeRun(run.lite ? '' : run.id, summary)
            setRun({ ...run, analysis })
          } catch (e) {
            Alert.alert('Analysis failed', (e as Error).message)
          } finally {
            setAnalyzing(false)
          }
        },
        onBackfillHr: async () => {
          setBackfilling(true)
          try {
            const hr = await heartRateBetween(new Date(run.start_at), new Date(run.end_at))
            if (!hr.length) {
              Alert.alert('No heart rate found', 'Apple Health has no heart-rate samples for this run yet. If your Garmin recorded it, open Garmin Connect to sync and try again.')
              return
            }
            // Rebuild with the new HR so zones, TRIMP and split HR all update.
            const rebuilt = buildRun({
              userId: run.user_id, source: run.source, externalId: run.external_id, name: run.name,
              startedAt: new Date(run.start_at).getTime(), endedAt: new Date(run.end_at).getTime(),
              points: routeToPoints(run), hr: [...hrToSamples(run), ...hr], hrSource: 'watch', distanceM: run.distance_m,
            }, owner, zs)
            const patch = {
              hr: rebuilt.hr, avg_hr: rebuilt.avg_hr, max_hr: rebuilt.max_hr, hr_source: rebuilt.hr_source,
              zones: rebuilt.zones, trimp: rebuilt.trimp, kind: rebuilt.kind,
              // Keep the precise stored splits (from the full track); only add their heart rate.
              splits: run.splits?.map((s, k) => ({ ...s, avgHr: rebuilt.splits?.[k]?.avgHr ?? s.avgHr })) ?? rebuilt.splits,
            }
            await updateRun(run.id, patch)
            setRun({ ...run, ...patch })
          } catch (e) {
            Alert.alert('Could not read Apple Health', (e as Error).message)
          } finally {
            setBackfilling(false)
          }
        },
        onDelete: () => {
          Alert.alert('Delete run?', 'This removes the run from Orus. Apple Health and Strava are not changed.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: async () => {
              try {
                await deleteRun(run.id)
                router.back()
              } catch (e) {
                Alert.alert('Could not delete', (e as Error).message)
              }
            } },
          ])
        },
      }}
    />
  )
}

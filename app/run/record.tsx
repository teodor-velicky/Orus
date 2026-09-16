import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSession } from '../../lib/session'
import { useRing, isFresh } from '../../lib/ring/live'
import { heartRateBetween, isHealthAvailable } from '../../lib/health'
import { metricsRange } from '../../lib/metrics'
import { getGoal, runsRange, saveRun } from '../../lib/run/data'
import { cleanTrack, elevationGain, movingTime, trackDistance } from '../../lib/run/geo'
import { currentVdot, planWeek, trainingPaces } from '../../lib/run/plan'
import { buildRun, kcalForRun, runNameFor, toPlanRuns, zoneSettings, ZoneSettings } from '../../lib/run/training'
import { timeInZones } from '../../lib/run/zones'
import * as recorder from '../../lib/run/recorder'
import { isVoiceMuted, setVoiceMuted } from '../../lib/run/cues'
import { guideModel, Workout } from '../../lib/run/workout'
import type { Run } from '../../lib/types'
import { RunRecordModel, RunRecordView } from '../../components/views/RunRecordView'

const KIND_FOR_SESSION: Record<string, Run['kind']> = {
  recovery: 'recovery', easy: 'easy', long: 'long', tempo: 'tempo', intervals: 'intervals', race_pace: 'tempo', marathon_pace: 'tempo',
}

function parseWorkout(raw: string | undefined): Workout | null {
  if (!raw) return null
  try {
    const w = JSON.parse(raw) as Workout
    return Array.isArray(w.steps) && w.steps.length ? w : null
  } catch {
    return null
  }
}

export default function RecordRun() {
  const router = useRouter()
  // Opened from a recommended run: that workout is preselected.
  const params = useLocalSearchParams<{ workout?: string }>()
  const picked = useMemo(() => parseWorkout(params.workout), [params.workout])
  const [planned, setPlanned] = useState<Workout | null>(null)
  const [mode, setMode] = useState<'free' | 'workout'>(picked ? 'workout' : 'free')
  const [voiceMuted, setMuted] = useState(isVoiceMuted())
  const { me } = useSession()
  const rec = recorder.useRecorder()
  const ring = useRing()
  const [, tick] = useState(0)
  const [zs, setZs] = useState<ZoneSettings | null>(null)
  const [paces, setPaces] = useState<ReturnType<typeof trainingPaces> | null>(null)
  const [finished, setFinished] = useState<recorder.Recording | null>(null)
  const [name, setName] = useState('')
  const [effort, setEffort] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Warm up GPS (and restore an interrupted run) as soon as the screen opens.
  useEffect(() => {
    recorder.restoreRecording().then(restored => { if (!restored) recorder.acquire() }).catch(() => {})
  }, [])

  // Zones + today's suggested session.
  useEffect(() => {
    if (!me) return
    Promise.all([metricsRange(me.id, 21), runsRange(me.id, 60), getGoal(me.id)]).then(([metrics, runs, goal]) => {
      setZs(zoneSettings(me, metrics, runs))
      const plans = toPlanRuns(runs)
      const vdot = currentVdot(plans)
      setPaces(vdot ? trainingPaces(vdot) : null)
      const today = planWeek({
        vdot, runs: plans, readiness: null, form: null,
        goal: goal ? { distanceM: goal.distance_m, targetS: goal.target_s, raceDate: goal.race_date } : null,
      }).days[0]
      if (today?.workout) setPlanned(today.workout)
    }).catch(console.warn)
  }, [me])

  // Clock
  useEffect(() => {
    if (rec.status !== 'running') return
    const t = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [rec.status])

  const summary = useMemo(() => {
    if (!finished || !zs) return undefined
    const pts = cleanTrack(finished.points)
    const moving = pts.length > 1 ? movingTime(pts) : Math.round((finished.endedAt - finished.startedAt - finished.pausedMs) / 1000)
    const dist = trackDistance(pts)
    const bpm = finished.hr.map(h => h.bpm)
    const avgHr = bpm.length ? Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length) : null
    const kcal = kcalForRun({ distance_m: dist, moving_s: moving, duration_s: moving, avg_hr: avgHr, kcal: null } as Run, me)
    return {
      distanceM: dist, movingS: moving, avgPaceS: dist > 50 ? Math.round(moving / (dist / 1000)) : null,
      avgHr, maxHr: bpm.length ? Math.max(...bpm) : null, elevationM: pts.length > 1 ? elevationGain(pts) : null, kcal,
      zoneSeconds: finished.hr.length >= 10 ? timeInZones(finished.hr, zs.zones) : null,
      hrNote: finished.hr.length ? `Heart rate from ${ring.device?.name ?? 'your ring'}`
        : isHealthAvailable() ? 'Heart rate will be pulled from Apple Health when you save (Garmin / watch).'
          : 'No heart rate recorded for this run.',
    }
  }, [finished, zs, me, ring.device?.name])

  const close = useCallback(() => {
    if (rec.status === 'running' || rec.status === 'paused') {
      router.back() // keeps recording; the Train tab shows "Resume run"
      return
    }
    recorder.discard().finally(() => router.back())
  }, [rec.status, router])

  const save = async () => {
    if (!finished || !me || saving) return
    setSaving(true)
    try {
      let hr = finished.hr
      let hrSource: Run['hr_source'] = finished.hrSource
      if (!hr.length && isHealthAvailable()) {
        hr = await heartRateBetween(new Date(finished.startedAt), new Date(finished.endedAt))
        hrSource = hr.length ? 'watch' : null
      }
      const row = buildRun({
        userId: me.id, source: 'orus', externalId: String(finished.startedAt), name: name.trim() || null,
        startedAt: finished.startedAt, endedAt: finished.endedAt, pausedMs: finished.pausedMs,
        points: finished.points, hr, hrSource,
      }, me, zs ?? undefined, paces)
      const guided = recorder.getRecorder().workout
      // A guided session is what it was planned as; free runs are classified from zones / pace.
      const saved = await saveRun({ ...row, perceived_effort: effort, kind: guided ? KIND_FOR_SESSION[guided.kind] ?? row.kind : row.kind })
      await recorder.discard()
      router.replace(`/run/${saved.id}`)
    } catch (e) {
      Alert.alert('Could not save run', `${(e as Error).message}\n\nThe run is kept on this phone — try again.`)
    } finally {
      setSaving(false)
    }
  }

  const s = recorder.getRecorder()
  const offered = picked ?? planned
  const elapsed = recorder.activeSeconds(s)
  const pts = s.points
  const lastKm = s.kmMarks.length
  const model: RunRecordModel = {
    phase: finished ? 'summary' : s.status === 'running' ? 'running' : s.status === 'paused' ? 'paused' : 'ready',
    gps: { accuracy: s.accuracy, searching: s.status === 'acquiring', denied: s.permission === 'denied', background: s.background, error: s.error },
    ring: { name: ring.device?.name, connected: ring.status === 'connected', hr: isFresh(ring.hr, 15_000) ? Math.round(ring.hr!.value) : null },
    healthFallback: isHealthAvailable(),
    workout: offered,
    mode: offered ? mode : 'free',
    voiceMuted,
    guide: s.workout && (s.status === 'running' || s.status === 'paused')
      ? guideModel(s.workout, s.step, s.distanceM, elapsed, recorder.currentPace(s, 20))
      : undefined,
    elapsedS: elapsed,
    distanceM: s.distanceM,
    paceS: recorder.currentPace(s),
    avgPaceS: s.distanceM > 50 ? Math.round(elapsed / (s.distanceM / 1000)) : null,
    hr: isFresh(ring.hr, 15_000) ? Math.round(ring.hr!.value) : null,
    zones: zs?.zones ?? [],
    route: (finished?.points ?? pts).map(p => [p.lat, p.lng]),
    lastSplit: lastKm ? { km: lastKm, paceS: s.kmMarks[lastKm - 1] - (s.kmMarks[lastKm - 2] ?? 0) } : undefined,
    summary,
    name, effort, saving,
  }

  return (
    <RunRecordView
      m={model}
      h={{
        onClose: close,
        onStart: () => {
          recorder.start(mode === 'workout' ? offered : null).catch(e => Alert.alert('GPS', (e as Error).message))
        },
        onMode: setMode,
        onSkipStep: recorder.skipStep,
        onToggleVoice: () => { setVoiceMuted(!voiceMuted); setMuted(!voiceMuted) },
        onPause: recorder.pause,
        onResume: recorder.resume,
        onFinish: () => {
          Alert.alert('Finish run?', undefined, [
            { text: 'Keep going', style: 'cancel' },
            { text: 'Finish', onPress: async () => {
              const r = await recorder.finish()
              if (!r) return
              setName(prevName => prevName || recorder.getRecorder().workout?.title || runNameFor(r.startedAt))
              setFinished(r)
            } },
          ])
        },
        onSave: save,
        onDiscard: () => {
          Alert.alert('Discard this run?', 'It will not be saved.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Discard', style: 'destructive', onPress: () => { recorder.discard().finally(() => router.back()) } },
          ])
        },
        onName: setName,
        onEffort: setEffort,
      }}
    />
  )
}


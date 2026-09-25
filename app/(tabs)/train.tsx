import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSession } from '../../lib/session'
import {
  activeSession, createTemplate, e1rm, getTemplate, GymTemplate, listExercises, listTemplates,
  MUSCLE_LABELS, sessionsRange, setVolume, startFromTemplate, startSession,
} from '../../lib/gym'
import { metricsRange, pickNights, readiness, sleepRange, workoutsRange } from '../../lib/metrics'
import { duration, lastNDates, localIso, shortDate, weekdayShort } from '../../lib/format'
import { isHealthAvailable } from '../../lib/health'
import { useRing } from '../../lib/ring/live'
import { getGoal, recomputeZones, routePreviews, runsRange } from '../../lib/run/data'
import { calendarActivities, loadSeries, prepareRuns, runningModel, TrainingData } from '../../lib/run/model'
import { zoneSettings } from '../../lib/run/training'
import { activeSeconds, getRecorder, restoreRecording, useRecorder } from '../../lib/run/recorder'
import type { Exercise, GymSession, MuscleGroup, SleepSession } from '../../lib/types'
import { formatGymSub, TrainItem, TrainMode, TrainView } from '../../components/views/TrainView'

const MODE_KEY = 'orus.train.mode'

export default function Train() {
  const router = useRouter()
  const { viewing, isMe } = useSession()
  const ring = useRing()
  const rec = useRecorder()
  const [mode, setMode] = useState<TrainMode>('strength')
  const [data, setData] = useState<TrainingData | null>(null)
  const [nights, setNights] = useState<SleepSession[]>([])
  const [previews, setPreviews] = useState<Record<string, [number, number][]>>({})
  const [exercises, setExercises] = useState<Record<string, Exercise>>({})
  const [active, setActive] = useState<GymSession | null>(null)
  const [templates, setTemplates] = useState<GymTemplate[]>([])
  const [month, setMonth] = useState(localIso().slice(0, 7))
  const [selectedDay, setSelectedDay] = useState<string | null>(localIso())
  const [refreshing, setRefreshing] = useState(false)
  const [starting, setStarting] = useState(false)
  const derivedOnce = useRef(false)

  useEffect(() => {
    AsyncStorage.getItem(MODE_KEY).then(v => { if (v === 'running' || v === 'strength') setMode(v) }).catch(() => {})
    restoreRecording().catch(() => {})
  }, [])

  // Load enough history for the shown month and ~13 weeks of load.
  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const since = Math.ceil((Date.now() - new Date(y, m - 1, 1).getTime()) / 86400_000) + 1
    return Math.max(120, since)
  }, [month])

  const load = useCallback(async () => {
    if (!viewing) return
    const [runs, sessions, workouts, metrics, sleep, goal, ex, act] = await Promise.all([
      runsRange(viewing.id, days),
      sessionsRange(viewing.id, days),
      workoutsRange(viewing.id, days),
      metricsRange(viewing.id, 35),
      sleepRange(viewing.id, 3),
      getGoal(viewing.id),
      listExercises(),
      isMe ? activeSession(viewing.id) : Promise.resolve(null),
    ])
    if (isMe) listTemplates(viewing.id).then(setTemplates).catch(console.warn)
    const zs = zoneSettings(viewing, metrics, runs)
    const prepared = prepareRuns(runs, zs, viewing.sex)
    setData({ runs: prepared, sessions, workouts, metrics, goal, profile: viewing, zs })
    setNights(pickNights(sleep, viewing.preferred_sleep_source))
    setExercises(Object.fromEntries(ex.map(e => [e.id, e])))
    setActive(act)
    routePreviews(prepared.slice(0, 15).map(r => r.id)).then(setPreviews).catch(() => {})

    // Imported runs (Strava / older syncs) get zones + splits computed once per launch.
    if (isMe && !derivedOnce.current && runs.some(r => !r.lite && r.best_efforts == null)) {
      derivedOnce.current = true
      recomputeZones(viewing.id, true).catch(e => console.warn('derive runs', e))
    }
  }, [viewing, isMe, days])

  useFocusEffect(useCallback(() => { load().catch(console.warn) }, [load]))

  const strength = useMemo(() => {
    const sessions = data?.sessions ?? []
    const workouts = data?.workouts ?? []
    const week7 = lastNDates(7)
    const week = sessions.filter(s => week7.includes(localIso(new Date(s.started_at))))
    const weekSets = week.flatMap(s => s.sets.filter(x => x.completed && !x.is_warmup))

    const muscles = new Map<MuscleGroup, number>()
    for (const x of weekSets) {
      const g = exercises[x.exercise_id]?.muscle_group
      if (g) muscles.set(g, (muscles.get(g) ?? 0) + 1)
    }

    const six = Date.now() - 42 * 86400_000
    const best = new Map<string, { e1rm: number; sets: number }>()
    for (const s of sessions) {
      if (new Date(s.started_at).getTime() < six) continue
      for (const x of s.sets) {
        if (!x.completed || x.is_warmup) continue
        const b = best.get(x.exercise_id) ?? { e1rm: 0, sets: 0 }
        b.e1rm = Math.max(b.e1rm, e1rm(Number(x.weight_kg), x.reps))
        b.sets++
        best.set(x.exercise_id, b)
      }
    }

    const items: TrainItem[] = [
      ...sessions.map(s => {
        const done = s.sets.filter(x => x.completed && !x.is_warmup)
        const dur = s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000 : null
        return { at: s.started_at, item: {
          key: `g-${s.id}`, kind: 'gym' as const, icon: 'barbell-outline' as const, title: s.name, sessionId: s.id,
          sub: formatGymSub(s.started_at, done.length, done.reduce((a, x) => a + setVolume(x), 0), dur),
        } }
      }),
      ...workouts.map(w => ({ at: w.start_at, item: {
        key: `w-${w.source}-${w.external_id}`, kind: 'workout' as const,
        icon: (w.source === 'strava' ? 'navigate-outline' : 'fitness-outline') as TrainItem['icon'],
        title: w.name ?? w.activity,
        sub: [shortDate(w.start_at), duration(w.duration_s), w.distance_m ? `${(w.distance_m / 1000).toFixed(2)} km` : null,
          w.avg_hr ? `${Math.round(w.avg_hr)} bpm` : null, w.source === 'strava' ? 'Strava' : w.source_name].filter(Boolean).join(' · '),
      } })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20).map(x => x.item)

    return {
      isMe,
      templates: templates.map(t => {
        const muscles = [...new Set(t.items.map(i => exercises[i.exercise_id]?.muscle_group).filter(Boolean))]
        return {
          id: t.id, name: t.name, exercises: t.items.length,
          sets: t.items.reduce((a, i) => a + i.sets, 0),
          focus: muscles.slice(0, 3).map(mg => MUSCLE_LABELS[mg!]).join(' · '),
        }
      }),
      active: active ? { id: active.id, name: active.name, startedAt: active.started_at } : undefined,
      week: {
        sessions: week.length,
        sets: weekSets.length,
        volumeKg: weekSets.reduce((a, x) => a + setVolume(x), 0),
        cardio: workouts.filter(w => week7.includes(localIso(new Date(w.start_at)))).length,
        dayVolumes: week7.map(d => week.filter(s => localIso(new Date(s.started_at)) === d)
          .reduce((a, s) => a + s.sets.filter(x => x.completed).reduce((b, x) => b + setVolume(x), 0), 0)),
        dayLabels: week7.map(weekdayShort),
      },
      muscles: [...muscles.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => ({ label: MUSCLE_LABELS[g], sets: n })),
      lifts: [...best.entries()].filter(([, b]) => b.e1rm > 0).sort((a, b) => b[1].sets - a[1].sets).slice(0, 6)
        .map(([id, b]) => ({ id, name: exercises[id]?.name ?? 'Exercise', e1rm: b.e1rm, sets: b.sets })),
      items,
    }
  }, [data, exercises, active, isMe, templates])

  // The recorder updates every GPS fix; the tab only needs a coarse summary.
  const recCoarse = rec.status !== 'idle' && rec.startedAt ? `${rec.status}:${Math.floor(rec.distanceM / 100)}` : ''
  const recording = useMemo(() => {
    const r = getRecorder()
    return isMe && recCoarse && r.startedAt
      ? { status: r.status as 'running' | 'paused' | 'acquiring', distanceKm: r.distanceM / 1000, elapsedS: activeSeconds(r) } : undefined
  }, [recCoarse, isMe])

  const running = useMemo(() => {
    if (!data || !viewing) return null
    const today = localIso()
    const series = loadSeries(data, today)
    const r = readiness(nights.find(n => n.night === today), data.metrics, viewing.sleep_target_min, today, series[series.length - 1])
    return runningModel(data, {
      isMe, readiness: r.score, previews,
      recording,
      ring: isMe && ring.device ? { name: ring.device.name, connected: ring.status === 'connected' } : null,
      healthAvailable: isHealthAvailable(),
    })
  }, [data, viewing, nights, isMe, previews, recording, ring.device, ring.status])

  const calendar = useMemo(() => ({
    month, selected: selectedDay,
    activities: data ? calendarActivities(data, setVolume) : [],
  }), [data, month, selectedDay])

  return (
    <TrainView
      m={strength}
      mode={mode}
      running={running}
      calendar={calendar}
      runningHandlers={{
        onStartRun: () => router.push('/run/record'),
        onStartWorkout: day => router.push({ pathname: '/run/record', params: { workout: JSON.stringify(day.workout) } }),
        onOpenRun: id => router.push(`/run/${id}`),
        onOpenGoal: () => router.push('/run-goal'),
      }}
      h={{
        refreshing,
        starting,
        onMode: m => { setMode(m); AsyncStorage.setItem(MODE_KEY, m).catch(() => {}) },
        onMonth: delta => {
          const [y, mo] = month.split('-').map(Number)
          const d = new Date(y, mo - 1 + delta, 1)
          setMonth(localIso(d).slice(0, 7))
          setSelectedDay(null)
        },
        onSelectDay: d => setSelectedDay(s => (s === d ? null : d)),
        onOpenActivity: a => {
          if (a.runId) router.push(`/run/${a.runId}`)
          else if (a.sessionId) router.push(`/session/${a.sessionId}`)
        },
        onRefresh: async () => { setRefreshing(true); await load().catch(console.warn); setRefreshing(false) },
        onStart: async () => {
          if (!viewing) return
          setStarting(true)
          try {
            const s = await startSession(viewing.id, 'Workout')
            router.push(`/session/${s.id}`)
          } catch (e) {
            Alert.alert('Could not start', (e as Error).message)
          } finally {
            setStarting(false)
          }
        },
        onOpenSession: id => router.push(`/session/${id}`),
        onOpenTemplate: id => router.push(`/template/${id}`),
        onNewTemplate: async () => {
          if (!viewing) return
          try {
            const t = await createTemplate(viewing.id, 'New workout')
            router.push(`/template/${t.id}`)
          } catch (e) {
            Alert.alert('Could not create', (e as Error).message)
          }
        },
        onStartTemplate: async id => {
          if (!viewing) return
          try {
            const t = await getTemplate(id)
            if (!t) return
            const s = await startFromTemplate(viewing.id, t)
            router.push(`/session/${s.id}`)
          } catch (e) {
            Alert.alert('Could not start', (e as Error).message)
          }
        },
        onOpenExercise: id => router.push({ pathname: '/exercise/[id]', params: { id, userId: viewing?.id ?? '' } }),
      }}
    />
  )
}

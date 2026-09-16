import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { firstName, useSession } from '../../lib/session'
import { metricsRange, pickNights, readiness, sleepRange, workoutsRange } from '../../lib/metrics'
import { mealsForDay, summarize } from '../../lib/meals'
import { sessionsRange, setVolume } from '../../lib/gym'
import { lastHealthSync } from '../../lib/health'
import { isFresh, useRing } from '../../lib/ring/live'
import { macroTargets } from '../../lib/targets'
import { addDays, fromIso, lastNDates, localIso, timeAgo, weekdayShort } from '../../lib/format'
import { runsRange } from '../../lib/run/data'
import { fitnessSeries } from '../../lib/run/load'
import { runEnergy, runDate, trainingEvents, zoneSettings } from '../../lib/run/training'
import type { DailyMetrics, GymSession, GymSet, Run, SleepSession, Workout } from '../../lib/types'
import { TodayModel, TodayView } from '../../components/views/TodayView'
import { Loading, Screen } from '../../components/ui'

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

interface Raw {
  metrics: DailyMetrics[]
  nights: SleepSession[]
  sessions: (GymSession & { sets: GymSet[] })[]
  workouts: Workout[]
  runs: Run[]
  lastSync: string | null
}

export default function Today() {
  const router = useRouter()
  const { viewing, isMe } = useSession()
  const ring = useRing()
  const [date, setDate] = useState(localIso())
  const [raw, setRaw] = useState<Raw | null>(null)
  const [meals, setMeals] = useState<Awaited<ReturnType<typeof mealsForDay>>>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!viewing) return
    // 90 days of training feed fitness / fatigue for the readiness load part.
    const [metrics, sleep, sessions, workouts, runs, lastSync, dayMeals] = await Promise.all([
      metricsRange(viewing.id, 35),
      sleepRange(viewing.id, 21),
      sessionsRange(viewing.id, 90),
      workoutsRange(viewing.id, 90),
      runsRange(viewing.id, 90),
      lastHealthSync(),
      mealsForDay(viewing.id, date),
    ])
    setRaw({ metrics, nights: pickNights(sleep, viewing.preferred_sleep_source), sessions, workouts, runs, lastSync })
    setMeals(dayMeals)
  }, [viewing, date])

  useFocusEffect(useCallback(() => { load().catch(console.warn) }, [load]))

  if (!raw || !viewing) return <Screen><Loading /></Screen>

  const target = viewing.sleep_target_min
  const nightFor = (d: string) => raw.nights.find(n => n.night === d)
  const zs = zoneSettings(viewing, raw.metrics, raw.runs)
  const loads = fitnessSeries(
    trainingEvents({ runs: raw.runs, sessions: raw.sessions, workouts: raw.workouts, zs, sex: viewing.sex }),
    localIso(addDays(new Date(), -90)), localIso(),
  )
  const readinessFor = (d: string) =>
    readiness(nightFor(d), raw.metrics.filter(x => x.date <= d), target, d, loads.find(l => l.date === d))
  const running = runEnergy(raw.runs, date, viewing)
  const baseTargets = macroTargets(viewing)
  const night = nightFor(date)

  // Training: the 7 days ending on the selected date.
  const days = lastNDates(7, fromIso(date))
  const dayVolumes = days.map(d => raw.sessions
    .filter(s => localIso(new Date(s.started_at)) === d)
    .reduce((a, s) => a + s.sets.filter(x => x.completed).reduce((b, x) => b + setVolume(x), 0), 0))
  const inWindow = (iso: string) => days.includes(localIso(new Date(iso)))

  const isToday = date === localIso()
  const model: TodayModel = {
    date,
    eyebrow: fromIso(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    title: isMe ? (isToday ? `${greeting()}, ${firstName(viewing)}` : 'Your day') : `${firstName(viewing)}'s day`,
    isMe,
    week: lastNDates(7).map(d => ({ date: d, score: readinessFor(d).score })),
    readiness: readinessFor(date),
    sleep: { night, score: night ? Math.min(100, Math.round((night.asleep_min / target) * 100)) : null, targetMin: target },
    nutrition: {
      summary: summarize(meals),
      // Running calories are partly added back — carbs absorb the extra energy.
      targets: { ...baseTargets, kcal: baseTargets.kcal + running.bonus, carbs: baseTargets.carbs + Math.round(running.bonus / 4) },
      runBonus: running.bonus,
    },
    metrics: raw.metrics.find(x => x.date === date),
    trend: raw.metrics.filter(x => x.date <= date),
    training: {
      dayVolumes,
      dayLabels: days.map(weekdayShort),
      sessions: raw.sessions.filter(s => inWindow(s.started_at)).length,
      volumeKg: dayVolumes.reduce((a, b) => a + b, 0),
      workouts: raw.workouts.filter(w => inWindow(w.start_at) && !/run/i.test(w.activity)).length,
      runs: raw.runs.filter(r => days.includes(runDate(r))).length,
      runKm: raw.runs.filter(r => days.includes(runDate(r))).reduce((a, r) => a + r.distance_m, 0) / 1000,
      dayLoads: days.map(d => loads.find(l => l.date === d)?.load ?? 0),
      form: loads.find(l => l.date === date)?.tsb ?? null,
    },
    sources: [...new Set(raw.metrics.slice(-3).flatMap(x => x.sources))],
    syncedText: isMe && raw.lastSync ? timeAgo(raw.lastSync) : undefined,
    ring: isMe && ring.device ? {
      name: ring.device.name,
      connected: ring.status === 'connected',
      battery: ring.battery?.pct,
      liveHr: isFresh(ring.hr, 60_000) ? Math.round(ring.hr!.value) : undefined,
    } : undefined,
  }

  return (
    <TodayView
      m={model}
      h={{
        onSelectDate: setDate,
        refreshing,
        onRefresh: async () => { setRefreshing(true); await load().catch(console.warn); setRefreshing(false) },
        onOpenSettings: () => router.push('/settings'),
        onOpenSleep: () => router.push('/sleep'),
        onOpenHeart: () => router.push('/heart'),
        onOpenFood: () => router.push('/food'),
        onOpenTrain: () => router.push('/train'),
        onOpenRing: () => router.push('/ring'),
      }}
    />
  )
}

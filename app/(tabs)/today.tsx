import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { firstName, useSession } from '../../lib/session'
import { metricsRange, pickNights, readiness, ringMinutesForDay, sleepRange, workoutsRange } from '../../lib/metrics'
import { mealsForDay, mealsInRange, summarize } from '../../lib/meals'
import { energyForDay, EnergyMinute } from '../../lib/energy'
import { healthNotes, weeklyTrends } from '../../lib/insights'
import { ageOf } from '../../lib/run/training'
import { sleepContext, strainFor } from '../../lib/daily'
import { getEntry } from '../../lib/journalStore'
import { sleepConsistency, sleepNeed, SleepNeed } from '../../lib/sleep'
import { strainTarget } from '../../lib/strain'
import { sessionsRange, setVolume } from '../../lib/gym'
import { lastHealthSync } from '../../lib/health'
import { isFresh, useRing } from '../../lib/ring/live'
import { macroTargets } from '../../lib/targets'
import { addDays, fromIso, lastNDates, localIso, timeAgo, weekdayShort } from '../../lib/format'
import { runsRange } from '../../lib/run/data'
import { fitnessSeries } from '../../lib/run/load'
import { runEnergy, runDate, trainingEvents, zoneSettings } from '../../lib/run/training'
import type { DailyMetrics, GymSession, GymSet, MealLog, Run, SleepSession, Workout } from '../../lib/types'
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
  /** Meals for the last 14 days, for food quality trends and readiness. */
  recentMeals: MealLog[]
  minutes: EnergyMinute[]
  /** Need and consistency for the night ending on the selected date. */
  sleepNeed: SleepNeed | null
  sleepConsistency: number | null
  tonight: SleepNeed | null
  journalDue: boolean
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
    const [metrics, sleep, sessions, workouts, runs, lastSync, dayMeals, recentMeals, minutes] = await Promise.all([
      metricsRange(viewing.id, 35),
      sleepRange(viewing.id, 21),
      sessionsRange(viewing.id, 90),
      workoutsRange(viewing.id, 90),
      runsRange(viewing.id, 90),
      lastHealthSync(),
      mealsForDay(viewing.id, date),
      mealsInRange(viewing.id, localIso(addDays(fromIso(date), -14)), date),
      ringMinutesForDay(viewing.id, date),
    ])
    const nights = pickNights(sleep, viewing.preferred_sleep_source)
    const zsNow = zoneSettings(viewing, metrics, runs)
    const isTodaySelected = date === localIso()
    const [ctx, tonight, yesterdayEntry] = await Promise.all([
      sleepContext({
        userId: viewing.id, night: date, nights, baselineMin: viewing.sleep_target_min,
        sessions, runs, zs: zsNow, sex: viewing.sex,
      }).catch(() => null),
      // Tonight = the night ending tomorrow: today's strain and naps so far.
      isTodaySelected
        ? sleepContext({
          userId: viewing.id, night: localIso(addDays(new Date(), 1)), nights, baselineMin: viewing.sleep_target_min,
          sessions, runs, zs: zsNow, sex: viewing.sex,
        }).catch(() => null)
        : Promise.resolve(null),
      isTodaySelected && isMe ? getEntry(viewing.id, localIso(addDays(new Date(), -1))).catch(() => null) : Promise.resolve({}),
    ])
    setRaw({
      metrics, nights, sessions, workouts, runs, lastSync, recentMeals, minutes,
      sleepNeed: ctx?.need ?? null, sleepConsistency: ctx?.consistency ?? null,
      tonight: tonight?.need ?? null,
      journalDue: yesterdayEntry == null,
    })
    setMeals(dayMeals)
  }, [viewing, date, isMe])

  useFocusEffect(useCallback(() => { load().catch(console.warn) }, [load]))

  // Everything that depends only on loaded data is computed once per load,
  // not on every heartbeat from the ring.
  const base = useMemo(() => {
    if (!raw || !viewing) return null

    const target = viewing.sleep_target_min
    const nightFor = (d: string) => raw.nights.find(n => n.night === d)
    const zs = zoneSettings(viewing, raw.metrics, raw.runs)
    const loads = fitnessSeries(
      trainingEvents({ runs: raw.runs, sessions: raw.sessions, workouts: raw.workouts, zs, sex: viewing.sex }),
      localIso(addDays(new Date(), -90)), localIso(),
    )
    // Food quality per day, from the last two weeks of meals.
    const mealsByDay = new Map<string, MealLog[]>()
    for (const meal of raw.recentMeals) {
      const d = localIso(new Date(meal.logged_at))
      mealsByDay.set(d, [...(mealsByDay.get(d) ?? []), meal])
    }
    const foodByDay = [...mealsByDay.entries()].map(([d, list]) => ({ date: d, quality: summarize(list).quality, count: list.length }))
      .filter((f): f is { date: string; quality: number; count: number } => f.quality != null)
    // One snack isn't a day of eating: readiness only uses days with two or more meals.
    const foodQualityBefore = (d: string) => {
      const prev = localIso(addDays(fromIso(d), -1))
      const f = foodByDay.find(x => x.date === prev)
      return f && f.count >= 2 ? f.quality : null
    }
    const age = ageOf(viewing)
    // Sleep is scored against need (baseline + strain + debt), like WHOOP. The
    // selected night uses the full calculation; the week strip skips the strain
    // part to avoid loading a week of minute data.
    const needFor = (d: string) =>
      d === date && raw.sleepNeed ? raw.sleepNeed.needMin
        : sleepNeed({ baselineMin: target, night: d, previous: raw.nights }).needMin
    const readinessFor = (d: string) =>
      readiness(nightFor(d), raw.metrics.filter(x => x.date <= d), target, d, loads.find(l => l.date === d), {
        foodQuality: foodQualityBefore(d), age,
        sleepNeedMin: needFor(d),
        sleepConsistency: d === date ? raw.sleepConsistency : sleepConsistency(raw.nights, d),
      })
    const dayReadiness = readinessFor(date)
    const strain = strainFor({ date, minutes: raw.minutes, sessions: raw.sessions, runs: raw.runs, zs, sex: viewing.sex })
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
    const dayRow = raw.metrics.find(x => x.date === date)
    const summary = summarize(meals)
    const latestWeight = [...raw.metrics].reverse().find(x => x.weight_kg != null)?.weight_kg
    const energy = raw.minutes.length || summary.kcal
      ? {
          ...energyForDay({
            minutes: raw.minutes,
            body: { weightKg: latestWeight ?? viewing.weight_kg, heightCm: viewing.height_cm, age, sex: viewing.sex },
            restingHr: dayRow?.resting_hr ?? zs.restingHr,
            dayStart: fromIso(date),
          }),
          eaten: Math.round(summary.kcal),
        }
      : null
    const trends = weeklyTrends({ metrics: raw.metrics.filter(x => x.date <= date), nights: raw.nights, food: foodByDay, today: date })
    const nightsWithTemp = raw.metrics.filter(x => x.date < date && x.skin_temp_c != null).length
    const model: Omit<TodayModel, 'ring' | 'heart' | 'skin'> = {
      date,
      eyebrow: fromIso(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      title: isMe ? (isToday ? `${greeting()}, ${firstName(viewing)}` : 'Your day') : `${firstName(viewing)}'s day`,
      isMe,
      week: lastNDates(7).map(d => ({ date: d, score: readinessFor(d).score })),
      readiness: dayReadiness,
      sleep: {
        night,
        score: night ? Math.min(100, Math.round((night.asleep_min / needFor(date)) * 100)) : null,
        targetMin: target,
        need: raw.sleepNeed,
        consistency: raw.sleepConsistency,
        tonight: raw.tonight,
      },
      journalDue: raw.journalDue,
      strain: {
        value: strain.strain, activeMin: strain.activeMin,
        target: date === localIso() ? strainTarget(dayReadiness.score) : null,
      },
      nutrition: {
        summary,
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
      energy,
      trends,
      notes: healthNotes(trends, { sleepTargetMin: target }),
    }
    return { model, dayRow, isToday, nightsWithTemp }
  }, [raw, viewing, date, meals, isMe])

  if (!base || !viewing) return <Screen><Loading /></Screen>
  const { dayRow, isToday, nightsWithTemp } = base
  const liveHr = isMe && isFresh(ring.hr, 60_000) ? Math.round(ring.hr!.value) : null
  const model: TodayModel = {
    ...base.model,
    ring: isMe && ring.device ? {
      name: ring.device.name,
      connected: ring.status === 'connected',
      battery: ring.battery?.pct,
      liveHr: liveHr ?? undefined,
    } : undefined,
    heart: {
      live: isToday ? liveHr : null,
      resting: dayRow?.resting_hr ?? null,
      // Opening the app, the ring takes a few seconds to send the first beat.
      // Show the last one with its age meanwhile, rather than a blank tile.
      recent: isToday && isMe && !liveHr && isFresh(ring.hr, 12 * 3600_000)
        ? { value: Math.round(ring.hr!.value), minutesAgo: Math.round((Date.now() - ring.hr!.at) / 60_000) }
        : null,
      trail: isToday && isMe && liveHr != null ? ring.hrTrail : [],
    },
    skin: {
      delta: dayRow?.skin_temp_delta_c ?? null,
      nightly: dayRow?.skin_temp_c ?? null,
      live: isToday && isMe && ring.skinTemp && isFresh(ring.skinTemp, 3 * 3600_000) ? ring.skinTemp.value : null,
      nightsToBaseline: Math.max(1, 3 - nightsWithTemp),
    },
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
        onOpenJournal: () => router.push('/journal'),
      }}
    />
  )
}

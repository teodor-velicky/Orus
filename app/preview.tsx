// Dev-only design preview with sample data: /preview?screen=today|food|sleep|heart|train|train-run|run|run-ready|run-live|run-summary|run-goal|together|…
// Not reachable in release builds (the gate only exempts it in __DEV__).
import { useState } from 'react'
import { Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import {
  demoExercises, demoFood, demoMeals, demoMetrics, demoNights, demoProfile, demoRunAnalysis, demoRuns, demoSessions, demoToday, demoWorkouts,
} from '../lib/demo'
import { calendarActivities, prepareRuns, runningModel } from '../lib/run/model'
import { runDetailModel } from '../lib/run/detail'
import { goalModel, GoalDraft } from '../lib/run/goalModel'
import { currentVdot, planWeek } from '../lib/run/plan'
import { guideModel } from '../lib/run/workout'
import { routeToPoints, toPlanRuns, zoneSettings } from '../lib/run/training'
import { setVolume } from '../lib/gym'
import { RunDetailView } from '../components/views/RunDetailView'
import { RunRecordView } from '../components/views/RunRecordView'
import { RunGoalView } from '../components/views/RunGoalView'
import { TemplateView } from '../components/views/TemplateView'
import type { TrainMode } from '../components/views/TrainView'
import { summarize } from '../lib/meals'
import { SettingsView } from '../components/views/SettingsView'
import { LogMealView } from '../components/views/LogMealView'
import { ExercisePickerView } from '../components/views/ExercisePickerView'
import { Header, Screen } from '../components/ui'
import { MealAnalysisView } from '../components/MealAnalysisView'
import { lastNDates, localIso, weekdayShort } from '../lib/format'
import { TodayView } from '../components/views/TodayView'
import { FoodView } from '../components/views/FoodView'
import { SleepView } from '../components/views/SleepView'
import { HeartView } from '../components/views/HeartView'
import { TrainView } from '../components/views/TrainView'
import { TogetherView } from '../components/views/TogetherView'
import { color, type } from '../lib/theme'
import { hrZones } from '../lib/run/zones'

const noop = () => {}

export default function Preview() {
  const { screen = 'today' } = useLocalSearchParams<{ screen?: string }>()
  const [date, setDate] = useState(demoToday().date)
  const [night, setNight] = useState(demoNights[demoNights.length - 1].night)
  if (!__DEV__) return <View style={{ flex: 1, backgroundColor: color.bg }} />

  switch (screen) {
    case 'today':
      return (
        <TodayView
          m={{ ...demoToday(), date }}
          h={{ onSelectDate: setDate, onOpenSettings: noop, onOpenSleep: noop, onOpenHeart: noop, onOpenFood: noop, onOpenTrain: noop, onOpenRing: noop }}
        />
      )
    case 'food':
      return <FoodView m={demoFood(date)} h={{ onSelectDate: setDate, onLogMeal: noop, onOpenMeal: noop, onOpenSystem: noop }} />
    case 'sleep':
      return (
        <SleepView
          m={{ isMe: true, eyebrow: 'Sleep', nights: demoNights, selected: demoNights.find(n => n.night === night), sourcesForNight: ['R09_1A2B', 'Connect'], targetMin: 480 }}
          h={{ onBack: noop, onSelectNight: setNight, onPreferSource: noop }}
        />
      )
    case 'heart':
      return <HeartView m={{ eyebrow: 'Vitals', metrics: demoMetrics, today: demoMetrics[demoMetrics.length - 1] }} onBack={noop} />
    case 'train':
    case 'train-run':
      return <PreviewTrain initial={screen === 'train-run' ? 'running' : 'strength'} />
    case 'run':
      return <PreviewRun />
    case 'run-ready':
    case 'run-live':
    case 'run-summary':
    case 'run-workout':
    case 'run-guided':
      return <PreviewRecord phase={screen === 'run-ready' || screen === 'run-workout' ? 'ready' : screen === 'run-summary' ? 'summary' : 'running'} guided={screen === 'run-workout' || screen === 'run-guided'} />
    case 'template':
      return (
        <TemplateView
          m={{
            name: 'Push day',
            rows: [
              { exerciseId: '1', name: 'Bench Press', muscle: 'Chest', sets: 4, last: '80×8, 80×7, 75×8' },
              { exerciseId: '2', name: 'Incline Dumbbell Press', muscle: 'Chest', sets: 3, last: '30×10, 30×9' },
              { exerciseId: '3', name: 'Overhead Press', muscle: 'Shoulders', sets: 3, last: '45×8, 45×7, 42.5×8' },
              { exerciseId: '4', name: 'Lateral Raise', muscle: 'Shoulders', sets: 3, last: null },
            ],
            totalSets: 13, saving: false, starting: false,
          }}
          h={{ onBack: noop, onName: noop, onSets: noop, onMove: noop, onRemove: noop, onAddExercise: noop, onStart: noop, onDelete: noop }}
        />
      )
    case 'run-goal':
      return <PreviewGoal />
    case 'together': {
      const p = (r: number, s: number, q: number) => ({
        readiness: r, lastSleep: s, sleep7: s - 12, sleepNights: [420, 455, 390, 470, 440, 505, s],
        rhr: 54, hrv: 58, steps: 9400, kcal: 2100, protein: 128, quality: q, plants: 22, sessions: 4, volume: 42000, runKm: 28.4, runs: 4, fitness: 52,
      })
      return (
        <TogetherView
          m={{ meName: 'Teo', partnerName: 'Anna', me: p(75, 431, 84), partner: { ...p(82, 468, 79), rhr: 58, hrv: 64, steps: 11200, protein: 96, plants: 27, sessions: 3, volume: 21000 },
            weekLabels: lastNDates(7).map(weekdayShort), sleepTargets: [480, 510], live: { hr: 64, hrv: 52, skinTemp: 34.3 } }}
        />
      )
    }
    case 'food-empty':
      return <FoodView m={{ ...demoFood(date), meals: [], summary: summarize([]), systems: null }} h={{ onSelectDate: setDate, onLogMeal: noop, onOpenMeal: noop, onOpenSystem: noop }} />
    case 'settings':
      return (
        <SettingsView
          m={{
            name: 'Teo Velicky', email: 'teo@example.com', age: 27, heightCm: 182, sex: 'male', goal: 'maintain',
            kcal: '', protein: '150', sleepH: '8', weight: '78.4', kcalAuto: 2650, proteinAuto: 141,
            maxHr: '', restingHr: '48', maxHrAuto: 189, restingHrAuto: 52, zones: hrZones(189, 48),
            health: { available: true, lastSync: '2m ago' }, strava: { state: 'connected', athlete: 'Teo V.', lastSync: '1h ago' },
            ring: { name: 'R09_1A2B', status: 'connected · 64%' }, widget: { enabled: true }, circle: { code: 'A7K2QX', partner: 'Anna' }, busy: null,
          }}
          h={{ onBack: noop, onChange: noop, onSave: noop, onHealthSync: noop, onStravaConnect: noop, onStravaSync: noop, onStravaDisconnect: noop, onOpenRing: noop, onWidgetLink: noop, onWidgetRevoke: noop, onShareCode: noop, onLeave: noop, onSignOut: noop }}
        />
      )
    case 'log':
    case 'log-analyzing':
      return (
        <LogMealView
          m={{ mealType: 'lunch', yesterday: false, photos: [], description: '', analyzing: screen === 'log-analyzing' }}
          h={{ onClose: noop, onMealType: noop, onToggleYesterday: noop, onCamera: noop, onLibrary: noop, onRemovePhoto: noop, onDescription: noop, onAnalyze: noop }}
        />
      )
    case 'exercises':
      return <ExercisePickerView exercises={demoExercises} busyId={null} onPick={noop} onCreate={noop} onClose={noop} />
    case 'meal':
      return (
        <Screen bottomInset={48}>
          <Header eyebrow="Today · 13:30" title={demoMeals[1].title} onBack={noop} />
          <MealAnalysisView analysis={demoMeals[1].analysis} sex="male" />
        </Screen>
      )
    default:
      return <View style={{ flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={type.sub}>Unknown screen</Text></View>
  }
}

function demoTraining() {
  const zs = zoneSettings(demoProfile, demoMetrics, demoRuns())
  const runs = prepareRuns(demoRuns(), zs, 'male')
  return { runs, sessions: demoSessions(), workouts: demoWorkouts, metrics: demoMetrics, profile: demoProfile, zs, goal: { user_id: 'demo', distance_m: 5000, target_s: 1199, race_date: localIso(new Date(Date.now() + 10 * 7 * 86400_000)) } }
}

function PreviewTrain({ initial }: { initial: TrainMode }) {
  const [mode, setMode] = useState<TrainMode>(initial)
  const [month, setMonth] = useState(localIso().slice(0, 7))
  const [day, setDay] = useState<string | null>(localIso())
  const data = demoTraining()
  const previews = Object.fromEntries(data.runs.map(r => [r.id, routeToPoints(r).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 40)) === 0).map(p => [p.lat, p.lng] as [number, number])]))
  return (
    <TrainView
      mode={mode}
      m={{
        isMe: true,
        templates: [
          { id: 't1', name: 'Push day', exercises: 5, sets: 18, focus: 'Chest · Shoulders · Triceps' },
          { id: 't2', name: 'Pull day', exercises: 5, sets: 17, focus: 'Back · Biceps' },
        ],
        week: { sessions: 2, sets: 32, volumeKg: 21000, cardio: 1, dayVolumes: [8200, 0, 11400, 0, 0, 0, 0], dayLabels: lastNDates(7).map(weekdayShort) },
        muscles: [{ label: 'Chest', sets: 14 }, { label: 'Back', sets: 16 }, { label: 'Quads', sets: 10 }],
        lifts: [{ id: '1', name: 'Bench Press', e1rm: 104, sets: 24 }, { id: '2', name: 'Back Squat', e1rm: 141, sets: 20 }],
        items: [{ key: 'a', kind: 'gym', icon: 'barbell-outline', title: 'Push day', sub: 'Sep 15 · 18 sets · 12,800 kg · 1:04:12', sessionId: 'x' }],
      }}
      running={runningModel(data, { isMe: true, readiness: 74, previews, ring: { name: 'R09_1A2B', connected: true }, healthAvailable: true })}
      calendar={{ month, selected: day, activities: calendarActivities(data, setVolume) }}
      runningHandlers={{ onStartRun: noop, onStartWorkout: noop, onOpenRun: noop, onOpenGoal: noop }}
      h={{
        onMode: setMode, onSelectDay: d => setDay(x => (x === d ? null : d)), onOpenActivity: noop,
        onMonth: delta => { const [y, mo] = month.split('-').map(Number); setMonth(localIso(new Date(y, mo - 1 + delta, 1)).slice(0, 7)) },
        onStart: noop, onOpenSession: noop, onOpenExercise: noop,
        onOpenTemplate: noop, onNewTemplate: noop, onStartTemplate: noop,
      }}
    />
  )
}

function PreviewRun() {
  const data = demoTraining()
  const run = data.runs.find(r => r.name === 'Tempo 5K') ?? data.runs[0]
  return (
    <RunDetailView
      m={runDetailModel({ ...run, analysis: demoRunAnalysis, perceived_effort: 7 }, data.zs, { isMe: true, analyzing: false, canBackfillHr: false, backfilling: false })}
      h={{ onBack: noop, onAnalyze: noop, onBackfillHr: noop, onDelete: noop }}
    />
  )
}

function PreviewRecord({ phase, guided }: { phase: 'ready' | 'running' | 'summary'; guided: boolean }) {
  const [mode, setMode] = useState<'free' | 'workout'>(guided ? 'workout' : 'free')
  const plan = planWeek({ today: '2026-09-15', vdot: 47, runs: [], readiness: 80, form: 0, goal: { distanceM: 5000, targetS: 1199 } })
  const workout = plan.days[0].workout!
  // Rep 3 at 640 m in, running a touch too fast
  const step = { index: 5, startM: 4400, startS: 1500, complete: false }
  const data = demoTraining()
  const run = data.runs.find(r => r.name === 'Morning easy') ?? data.runs[0]
  const pts = routeToPoints(run)
  const live = phase === 'running' ? pts.slice(0, Math.floor(pts.length * 0.62)) : pts
  return (
    <RunRecordView
      m={{
        phase,
        gps: { accuracy: 5, searching: false, denied: false, background: true, error: null },
        ring: { name: 'R09_1A2B', connected: true, hr: 146 },
        healthFallback: true,
        workout, mode, voiceMuted: false,
        guide: guided && phase === 'running' ? guideModel(workout, step, 5040, 1640, 221) : undefined,
        elapsedS: 1502, distanceM: 4630, paceS: 318, avgPaceS: 324, hr: 146, zones: data.zs.zones,
        route: live.map(p => [p.lat, p.lng]), lastSplit: { km: 4, paceS: 321 },
        summary: {
          distanceM: run.distance_m, movingS: run.moving_s ?? run.duration_s, avgPaceS: Math.round((run.moving_s ?? run.duration_s) / (run.distance_m / 1000)),
          avgHr: run.avg_hr, maxHr: run.max_hr, elevationM: run.elevation_gain_m, kcal: run.kcal, zoneSeconds: run.zones, hrNote: 'Heart rate from R09_1A2B',
        },
        name: 'Morning easy', effort: 3, saving: false,
      }}
      h={{ onClose: noop, onStart: noop, onMode: setMode, onSkipStep: noop, onToggleVoice: noop, onPause: noop, onResume: noop, onFinish: noop, onSave: noop, onDiscard: noop, onName: noop, onEffort: noop }}
    />
  )
}

function PreviewGoal() {
  const [draft, setDraft] = useState<GoalDraft>({ distance: '5000', h: '', m: '19', s: '59', weeks: 12 })
  const vdot = currentVdot(toPlanRuns(demoTraining().runs))
  return (
    <RunGoalView
      m={goalModel(draft, vdot, { hasGoal: true, saving: false })}
      h={{
        onClose: noop, onDistance: distance => setDraft(d => ({ ...d, distance })), onTime: patch => setDraft(d => ({ ...d, ...patch })),
        onQuick: sec => setDraft(d => ({ ...d, h: '', m: String(Math.floor(sec / 60)), s: String(sec % 60).padStart(2, '0') })),
        onWeeks: weeks => setDraft(d => ({ ...d, weeks })), onSave: noop, onRemove: noop,
      }}
    />
  )
}

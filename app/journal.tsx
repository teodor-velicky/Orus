import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useSession } from '../lib/session'
import { addDays, fromIso, localIso, prettyDate } from '../lib/format'
import { metricsRange, pickNights, ringMinutesForDay, sleepRange } from '../lib/metrics'
import { mealsInRange } from '../lib/meals'
import { sessionsRange } from '../lib/gym'
import { runsRange } from '../lib/run/data'
import { runDate, zoneSettings } from '../lib/run/training'
import { strainEvents, strainFor } from '../lib/daily'
import { strainFromLoad } from '../lib/strain'
import {
  Answers, autoBehaviors, BEHAVIORS, BehaviorKey, daysUntilInsight, DayRecord, journalEffects, MANUAL_BEHAVIORS,
} from '../lib/journal'
import { entriesRange, getEntry, saveEntry } from '../lib/journalStore'
import type { DailyMetrics, GymSession, GymSet, MealLog, Run, SleepSession } from '../lib/types'
import { JournalView } from '../components/views/JournalView'
import { Loading, Screen } from '../components/ui'

const HISTORY_DAYS = 90

interface History {
  entries: DayRecord[]
  metrics: DailyMetrics[]
  nights: SleepSession[]
  meals: MealLog[]
  sessions: (GymSession & { sets: GymSet[] })[]
  runs: Run[]
}

export default function Journal() {
  const router = useRouter()
  const { me } = useSession()
  // Most people check in the next morning, so default to yesterday until evening.
  const [date, setDate] = useState(() => localIso(addDays(new Date(), new Date().getHours() < 18 ? -1 : 0)))
  const [answers, setAnswers] = useState<Answers>({})
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<History | null>(null)
  const [dayStrain, setDayStrain] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!me) return
    const [entries, metrics, sleep, meals, sessions, runs] = await Promise.all([
      entriesRange(me.id, HISTORY_DAYS), metricsRange(me.id, HISTORY_DAYS), sleepRange(me.id, HISTORY_DAYS),
      mealsInRange(me.id, localIso(addDays(new Date(), -HISTORY_DAYS)), localIso()),
      sessionsRange(me.id, HISTORY_DAYS), runsRange(me.id, HISTORY_DAYS),
    ])
    setHistory({ entries, metrics, nights: pickNights(sleep, me.preferred_sleep_source), meals, sessions, runs })
  }, [me])

  useEffect(() => { loadHistory().catch(e => Alert.alert('Could not load journal', (e as Error).message)) }, [loadHistory])

  // The selected day's answers, and its full strain (with ring heart rate).
  useEffect(() => {
    if (!me || !history) return
    setSaved(false)
    getEntry(me.id, date).then(e => {
      setAnswers(e?.answers ?? {})
      setNote(e?.note ?? '')
      setSaved(!!e)
    }).catch(() => {})
    ringMinutesForDay(me.id, date).then(minutes => {
      const zs = zoneSettings(me, history.metrics, history.runs)
      setDayStrain(strainFor({ date, minutes, sessions: history.sessions, runs: history.runs, zs, sex: me.sex }).strain)
    }).catch(() => setDayStrain(null))
  }, [me, date, history])

  /** Behaviours read from data for a day. History uses logged training load for strain (no minute data). */
  const autoFor = useCallback((d: string, strain: number | null) => {
    if (!history) return {}
    const next = localIso(addDays(fromIso(d), 1))
    const bed = history.nights.find(n => n.night === next)?.start_at
    const dayStart = fromIso(d).getTime()
    return autoBehaviors({
      mealTimes: history.meals.map(m => new Date(m.logged_at).getTime()).filter(t => t >= dayStart && t < dayStart + 30 * 3600_000),
      trainingEnds: [
        ...history.sessions.filter(s => s.ended_at && localIso(new Date(s.started_at)) === d).map(s => new Date(s.ended_at!).getTime()),
        ...history.runs.filter(r => runDate(r) === d).map(r => new Date(r.end_at).getTime()),
      ],
      bedtime: bed ? new Date(bed).getTime() : null,
      strain,
    })
  }, [history])

  const analysis = useMemo(() => {
    if (!history) return null
    // Every day in range: your answers plus what the data says.
    const byDate = new Map(history.entries.map(e => [e.date, e.answers]))
    const days: DayRecord[] = []
    for (let i = HISTORY_DAYS; i >= 1; i--) {
      const d = localIso(addDays(new Date(), -i))
      const approxStrain = strainFromLoad(strainEvents(d, history.sessions, history.runs).reduce((a, e) => a + e.load, 0))
      const auto = autoFor(d, approxStrain)
      const merged: Answers = { ...(byDate.get(d) ?? {}) }
      for (const [k, v] of Object.entries(auto)) if (v) merged[k as BehaviorKey] = v.value
      if (Object.keys(merged).length) days.push({ date: d, answers: merged })
    }
    const effects = journalEffects({ days, nights: history.nights, metrics: history.metrics })
    const waiting = BEHAVIORS
      .filter(b => !effects.some(e => e.key === b.key))
      .map(b => ({ label: b.label, days: daysUntilInsight(days, b.key) }))
      .filter(w => w.days > 0)
      .sort((a, b) => a.days - b.days)
    return { effects, waiting, answeredDays: history.entries.length }
  }, [history, autoFor])

  if (!me || !history || !analysis) return <Screen><Loading /></Screen>

  const auto = autoFor(date, dayStrain)
  const today = localIso()

  return (
    <JournalView
      m={{
        dateLabel: date === today ? 'Today' : date === localIso(addDays(new Date(), -1)) ? 'Yesterday' : prettyDate(date),
        canNext: date < today,
        manual: MANUAL_BEHAVIORS,
        answers,
        auto: BEHAVIORS.filter(b => b.auto && auto[b.key]).map(b => ({ ...b, value: auto[b.key]!.value, detail: auto[b.key]!.detail })),
        note,
        effects: analysis.effects,
        waiting: analysis.waiting,
        answeredDays: analysis.answeredDays,
        saving,
        saved,
      }}
      h={{
        onBack: () => router.back(),
        onDay: delta => setDate(d => {
          const next = localIso(addDays(fromIso(d), delta))
          return next > today ? d : next
        }),
        onToggle: key => { setSaved(false); setAnswers(a => ({ ...a, [key]: !a[key] })) },
        onNote: v => { setSaved(false); setNote(v) },
        onSave: async () => {
          setSaving(true)
          try {
            // Every habit gets an explicit yes or no: "no" days are the comparison.
            const full: Answers = Object.fromEntries(MANUAL_BEHAVIORS.map(b => [b.key, answers[b.key] === true]))
            await saveEntry(me.id, date, full, note)
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
            setSaved(true)
            loadHistory().catch(() => {})
          } catch (e) {
            Alert.alert('Could not save', (e as Error).message)
          } finally {
            setSaving(false)
          }
        },
      }}
    />
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { firstName, useSession } from '../lib/session'
import { metricsRange, pickNights, sleepRange } from '../lib/metrics'
import { sessionsRange } from '../lib/gym'
import { runsRange } from '../lib/run/data'
import { zoneSettings } from '../lib/run/training'
import { sleepContext } from '../lib/daily'
import type { SleepNeed } from '../lib/sleep'
import type { SleepSession } from '../lib/types'
import { SleepView } from '../components/views/SleepView'
import { Loading, Screen } from '../components/ui'

export default function Sleep() {
  const router = useRouter()
  const { viewing, isMe, refresh } = useSession()
  const [raw, setRaw] = useState<SleepSession[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ night: string; need: SleepNeed; consistency: number | null } | null>(null)

  useEffect(() => {
    if (!viewing) return
    setRaw(null)
    sleepRange(viewing.id, 30).then(setRaw).catch(() => setRaw([]))
  }, [viewing])

  const nights = useMemo(() => pickNights(raw ?? [], viewing?.preferred_sleep_source), [raw, viewing])
  const selectedNight = (nights.find(n => n.night === selected) ?? nights[nights.length - 1])?.night

  // Need depends on the strain of the day before, so it's worked out per night.
  useEffect(() => {
    if (!viewing || !selectedNight) return
    let cancelled = false
    Promise.all([metricsRange(viewing.id, 21), sessionsRange(viewing.id, 35), runsRange(viewing.id, 35)])
      .then(([metrics, sessions, runs]) => sleepContext({
        userId: viewing.id, night: selectedNight, nights, baselineMin: viewing.sleep_target_min,
        sessions, runs, zs: zoneSettings(viewing, metrics, runs), sex: viewing.sex,
      }))
      .then(c => { if (!cancelled) setCtx({ night: selectedNight, need: c.need, consistency: c.consistency }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [viewing, selectedNight, nights])
  if (!raw || !viewing) return <Screen><Loading /></Screen>
  const night = nights.find(n => n.night === selected) ?? nights[nights.length - 1]

  return (
    <SleepView
      m={{
        isMe,
        eyebrow: isMe ? 'Sleep' : `${firstName(viewing)} · sleep`,
        nights,
        selected: night,
        sourcesForNight: raw.filter(s => s.night === night?.night).map(s => s.source),
        targetMin: viewing.sleep_target_min,
        need: ctx?.night === night?.night ? ctx?.need : null,
        consistency: ctx?.night === night?.night ? ctx?.consistency : null,
      }}
      h={{
        onBack: () => router.back(),
        onSelectNight: setSelected,
        onPreferSource: async source => {
          const { error } = await supabase.from('profiles').update({ preferred_sleep_source: source }).eq('id', viewing.id)
          if (error) return Alert.alert('Could not save', error.message)
          refresh()
        },
      }}
    />
  )
}

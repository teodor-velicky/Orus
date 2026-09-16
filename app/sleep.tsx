import { useEffect, useMemo, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { firstName, useSession } from '../lib/session'
import { pickNights, sleepRange } from '../lib/metrics'
import type { SleepSession } from '../lib/types'
import { SleepView } from '../components/views/SleepView'
import { Loading, Screen } from '../components/ui'

export default function Sleep() {
  const router = useRouter()
  const { viewing, isMe, refresh } = useSession()
  const [raw, setRaw] = useState<SleepSession[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!viewing) return
    setRaw(null)
    sleepRange(viewing.id, 30).then(setRaw).catch(() => setRaw([]))
  }, [viewing])

  const nights = useMemo(() => pickNights(raw ?? [], viewing?.preferred_sleep_source), [raw, viewing])
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

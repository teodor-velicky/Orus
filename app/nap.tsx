import { useCallback, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useSession } from '../lib/session'
import { clock, hm, shortDate } from '../lib/format'
import { addNap, NapRow, napsRange, removeNap } from '../lib/journalStore'
import { NapView } from '../components/views/NapView'

const DURATIONS = [15, 20, 30, 45, 60, 90]
const ENDED = [
  { label: 'Just now', minutesAgo: 0 },
  { label: '30 min ago', minutesAgo: 30 },
  { label: '1 h ago', minutesAgo: 60 },
  { label: '2 h ago', minutesAgo: 120 },
  { label: '3 h ago', minutesAgo: 180 },
]

export default function NapScreen() {
  const router = useRouter()
  const { me } = useSession()
  const [duration, setDuration] = useState(20)
  const [ago, setAgo] = useState(0)
  const [recent, setRecent] = useState<NapRow[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => { if (me) napsRange(me.id, 3).then(setRecent).catch(() => {}) }, [me])
  useEffect(load, [load])

  const end = new Date(Date.now() - ago * 60_000)
  const start = new Date(end.getTime() - duration * 60_000)

  return (
    <NapView
      m={{
        durations: DURATIONS, duration, endedOptions: ENDED, endedMinutesAgo: ago,
        preview: `${clock(start)} – ${clock(end)}`,
        recent: recent.map(n => ({
          id: n.id, source: n.source,
          title: `${clock(n.start_at)} – ${clock(n.end_at)} · ${hm((new Date(n.end_at).getTime() - new Date(n.start_at).getTime()) / 60_000)}`,
          sub: `${shortDate(n.start_at)} · ${n.source === 'ring' ? 'spotted by the ring' : 'logged'}`,
        })),
        saving,
      }}
      h={{
        onClose: () => router.back(),
        onDuration: setDuration,
        onEnded: setAgo,
        onSave: async () => {
          if (!me) return
          setSaving(true)
          try {
            await addNap(me.id, start, end)
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
            router.back()
          } catch (e) {
            Alert.alert('Could not save', (e as Error).message)
          } finally {
            setSaving(false)
          }
        },
        onRemove: id => {
          const nap = recent.find(n => n.id === id)
          if (!nap) return
          Alert.alert(nap.source === 'ring' ? 'Not a nap?' : 'Delete nap?',
            nap.source === 'ring' ? 'Orus won\'t count this one again.' : undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: nap.source === 'ring' ? 'Remove' : 'Delete', style: 'destructive', onPress: async () => {
                await removeNap(nap).catch(e => Alert.alert('Could not remove', (e as Error).message))
                load()
              } },
            ])
        },
      }}
    />
  )
}

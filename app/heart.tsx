import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { firstName, useSession } from '../lib/session'
import { metricsRange } from '../lib/metrics'
import { localIso } from '../lib/format'
import type { DailyMetrics } from '../lib/types'
import { HeartView } from '../components/views/HeartView'
import { Loading, Screen } from '../components/ui'

export default function Heart() {
  const router = useRouter()
  const { viewing, isMe } = useSession()
  const [metrics, setMetrics] = useState<DailyMetrics[] | null>(null)

  useEffect(() => {
    if (!viewing) return
    setMetrics(null)
    metricsRange(viewing.id, 30).then(setMetrics).catch(() => setMetrics([]))
  }, [viewing])

  if (!metrics) return <Screen><Loading /></Screen>
  return (
    <HeartView
      m={{
        eyebrow: isMe ? 'Vitals' : `${firstName(viewing)} · vitals`,
        metrics,
        today: metrics.find(x => x.date === localIso()),
      }}
      onBack={() => router.back()}
    />
  )
}

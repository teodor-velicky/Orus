import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Animated, Easing, Pressable, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSession } from '../lib/session'
import { isFresh, useRing } from '../lib/ring/live'
import { forget, pair, scan, setSharing, startLive, stopLive, syncHistory } from '../lib/ring/service'
import { timeAgo } from '../lib/format'
import { color, radius, space, type } from '../lib/theme'
import { Button, Card, Empty, Header, Label, Screen, Segmented, Stat, tap } from '../components/ui'
import { AreaChart, Bars, Gauge } from '../components/charts'
import { Logo } from '../components/Logo'
import { Ionicons } from '@expo/vector-icons'

const STATUS_TEXT = {
  unavailable: 'Bluetooth unavailable in this build',
  unpaired: 'No ring paired',
  scanning: 'Searching…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Not connected — keep the ring nearby',
} as const

function Pulse({ active }: { active: boolean }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!active) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 600, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [active, v])
  return (
    <Animated.View style={{
      width: 8, height: 8, borderRadius: 4, backgroundColor: color.text,
      opacity: active ? v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) : 0.2,
    }} />
  )
}

export default function RingScreen() {
  const router = useRouter()
  const { partner } = useSession()
  const ring = useRing()
  const [found, setFound] = useState<{ id: string; name: string; rssi: number | null }[]>([])
  const stopScan = useRef<(() => void) | null>(null)

  // Stream live data only while this screen is visible.
  useFocusEffect(useCallback(() => {
    if (ring.status === 'connected') startLive().catch(() => {})
    return () => stopLive()
  }, [ring.status]))

  useEffect(() => () => stopScan.current?.(), [])

  const startScan = () => {
    setFound([])
    stopScan.current = scan(d => setFound(prev => [...prev, d]))
  }

  const confirmForget = () => Alert.alert('Forget ring?', 'Already uploaded data stays in Orus.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Forget', style: 'destructive', onPress: () => forget() },
  ])

  const liveHr = isFresh(ring.hr, 15_000)

  return (
    <Screen bottomInset={space.xxxl}>
      <Header eyebrow="Smart ring" title={ring.device?.name ?? 'Ring'} onBack={() => router.back()} />

      {ring.status === 'unavailable' ? (
        <Empty title="Needs the installed app" message="Bluetooth isn't available in Expo Go. Sideload the Orus build (see README) to pair a ring. Everything else works without one." />
      ) : !ring.device ? (
        <>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Logo size={84} />
              <Text style={[type.title, { marginTop: space.l }]}>Pair your ring</Text>
              <Text style={[type.sub, { textAlign: 'center', marginTop: space.xs }]}>
                Put the ring on its charger for a moment to wake it and keep it next to the phone.
                Close QRing first — a ring accepts one connection at a time.
              </Text>
            </View>
            <Button label={ring.status === 'scanning' ? 'Searching…' : 'Find my ring'} loading={ring.status === 'scanning'}
              onPress={startScan} style={{ marginTop: space.xl }} />
          </Card>
          {found.map(d => (
            <Card key={d.id} style={{ marginTop: space.s }} onPress={() => { stopScan.current?.(); pair(d).catch(e => Alert.alert('Pairing failed', (e as Error).message)) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={type.bodyStrong}>{d.name}</Text>
                <Text style={type.caption}>{d.rssi != null ? `${d.rssi} dBm` : ''}</Text>
              </View>
              <Text style={type.caption}>Tap to pair</Text>
            </Card>
          ))}
        </>
      ) : (
        <>
          {/* STATUS */}
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Gauge value={ring.battery?.pct ?? null} size={132} stroke={8} ticks={false}
                display={ring.battery ? `${ring.battery.pct}` : '—'} unit="%" label={ring.battery?.charging ? 'Charging' : 'Battery'} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m }}>
                <Pulse active={ring.status === 'connected'} />
                <Text style={[type.sub, { color: color.text }]}>{STATUS_TEXT[ring.status]}</Text>
              </View>
              <Text style={[type.caption, { marginTop: space.xs, textAlign: 'center' }]}>
                Uploaded {ring.lastUploadAt ? timeAgo(new Date(ring.lastUploadAt).toISOString()) : 'not yet'}
                {ring.error ? ` · ${ring.error}` : ''}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.m, marginTop: space.l }}>
              <Button label="Sync history" variant="secondary" style={{ flex: 1 }} loading={ring.syncing}
                disabled={ring.status !== 'connected'} onPress={() => syncHistory()} />
              <Button label="Forget" variant="ghost" style={{ flex: 1 }} onPress={confirmForget} />
            </View>
          </Card>

          {/* LIVE */}
          <Label right={<Text style={type.caption}>{ring.live ? 'streaming' : 'paused'}</Text>}>Live</Label>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="heart" size={16} color={liveHr ? color.text : color.textFaint} />
              <Text style={[type.hero, { fontSize: 88, lineHeight: 92, opacity: liveHr ? 1 : 0.3 }]}>
                {ring.hr ? Math.round(ring.hr.value) : '—'}
              </Text>
              <Text style={type.label}>bpm{ring.hr && !liveHr ? ` · ${timeAgo(new Date(ring.hr.at).toISOString())}` : ''}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: space.xl }}>
              <Stat value={ring.hrv ? String(Math.round(ring.hrv.value)) : '—'} unit="ms" label="HRV" size="s" />
              <Stat value={ring.skinTemp ? ring.skinTemp.value.toFixed(1) : '—'} unit="°C" label="Skin" size="s" />
              <Stat value={ring.spo2 ? String(Math.round(ring.spo2.value)) : '—'} unit="%" label="SpO₂" size="s" />
            </View>
            <View style={{ marginTop: space.xl }}>
              <AreaChart values={ring.hrTrail} height={90} showAverage={false} />
            </View>
          </Card>

          <Label>Motion</Label>
          <Card>
            {ring.motionTrail.length ? (
              <Bars values={ring.motionTrail.slice(-60).map(v => v || null)} height={56} />
            ) : (
              <Text style={type.sub}>
                {ring.live ? 'Waiting for motion packets… (R09 raw format is unverified — see lib/ring/custom.ts)' : 'Motion streams while live mode is on.'}
              </Text>
            )}
          </Card>

          {partner ? (
            <>
              <Label>Share with {partner.name?.split(' ')[0] ?? 'partner'}</Label>
              <Card>
                <Segmented
                  options={[{ value: 'off', label: 'Private' }, { value: 'on', label: 'Share live' }]}
                  value={ring.sharing ? 'on' : 'off'}
                  onChange={v => { tap(); setSharing(v === 'on') }}
                />
                <Text style={[type.caption, { marginTop: space.m }]}>
                  While this screen is open, your heart rate, HRV and skin temperature appear live on their Us tab. Nothing extra is stored.
                </Text>
              </Card>
            </>
          ) : null}

          <Pressable onPress={() => router.push('/heart')} style={{ marginTop: space.xl, padding: space.m, borderRadius: radius.m, alignItems: 'center' }}>
            <Text style={[type.sub, { color: color.text }]}>Nightly trends →</Text>
          </Pressable>
        </>
      )}
    </Screen>
  )
}

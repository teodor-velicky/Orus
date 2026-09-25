import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Animated, Easing, Pressable, ScrollView, Share, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSession } from '../lib/session'
import { clearLog, isFresh, useRing } from '../lib/ring/live'
import { forget, pair, scan, setSharing, startLive, stopLive, syncHistory } from '../lib/ring/service'
import { timeAgo } from '../lib/format'
import { color, font, radius, space, type } from '../lib/theme'
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
  // Newest of the four readings: if it's old, everything on screen is a memory.
  const newest = Math.max(ring.hr?.at ?? 0, ring.hrv?.at ?? 0, ring.skinTemp?.at ?? 0, ring.spo2?.at ?? 0)
  const oldest = newest && Date.now() - newest > 120_000 ? newest : null

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
              {[
                { r: ring.hrv, v: (x: number) => String(Math.round(x)), unit: 'ms', label: 'HRV' },
                { r: ring.skinTemp, v: (x: number) => x.toFixed(1), unit: '°C', label: 'Skin' },
                { r: ring.spo2, v: (x: number) => String(Math.round(x)), unit: '%', label: 'SpO₂' },
              ].map(x => (
                <View key={x.label} style={{ alignItems: 'center', opacity: x.r && !isFresh(x.r, 120_000) ? 0.45 : 1 }}>
                  <Stat value={x.r ? x.v(x.r.value) : '—'} unit={x.unit} label={x.label} size="s" />
                </View>
              ))}
            </View>
            {oldest ? (
              <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
                Last reading {timeAgo(new Date(oldest).toISOString())}. Keep this screen open to refresh.
              </Text>
            ) : null}
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
                Raw motion is off: on this ring it stops heart rate and HRV from streaming. Sleep and activity still use the ring's own motion tracking.
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

          {/* Diagnostics: raw packets in and out, for fixing the decoder against a real ring. */}
          <Label>Diagnostics</Label>
          <Card>
            <Text style={[type.caption, { marginBottom: space.m }]}>
              {ring.log.length
                ? `${ring.log.length} packets. "<" is from the ring, ">" is to the ring; "unparsed" means Orus didn't understand it.`
                : 'Packets appear here while the ring is connected.'}
            </Text>
            <View style={{ maxHeight: 260, borderRadius: radius.s, backgroundColor: color.inset, padding: space.m }}>
              <ScrollView>
                <Text selectable style={{ fontFamily: font.mono, fontSize: 10, lineHeight: 15, color: color.textSecondary }}>
                  {ring.log.slice(-40).join('\n') || '—'}
                </Text>
              </ScrollView>
            </View>
            <View style={{ flexDirection: 'row', gap: space.m, marginTop: space.l }}>
              <Button label="Share log" variant="secondary" icon="share-outline" style={{ flex: 1 }}
                disabled={!ring.log.length}
                onPress={() => Share.share({ message: `Orus ring log (${ring.device?.name})\n${ring.log.join('\n')}` })} />
              <Button label="Clear" variant="ghost" style={{ flex: 1 }} onPress={() => clearLog()} />
            </View>
          </Card>

          <Pressable onPress={() => router.push('/heart')} style={{ marginTop: space.xl, padding: space.m, borderRadius: radius.m, alignItems: 'center' }}>
            <Text style={[type.sub, { color: color.text }]}>Nightly trends →</Text>
          </Pressable>
        </>
      )}
    </Screen>
  )
}

import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, space, type } from '../../lib/theme'
import { hm, num } from '../../lib/format'
import { Avatar, Button, Card, Header, Label, Screen, Stat } from '../ui'
import { Bars, Gauge } from '../charts'

export interface PersonStats {
  readiness: number | null
  lastSleep: number | null
  sleep7: number | null
  sleepNights: (number | null)[]
  rhr: number | null
  hrv: number | null
  steps: number | null
  kcal: number
  protein: number
  quality: number | null
  plants: number
  sessions: number
  volume: number
  runKm: number
  runs: number
  /** Training fitness (42-day load average). */
  fitness: number | null
}

export interface TogetherModel {
  meName: string
  partnerName: string
  me?: PersonStats
  partner?: PersonStats
  weekLabels: string[]
  sleepTargets: [number, number]
  live?: { hr: number | null; hrv: number | null; skinTemp: number | null }
}

/** Mirrored comparison row: value ◀ bar | label | bar ▶ value. */
function Versus({ label, a, b, format, lowerIsBetter = false }: {
  label: string
  a: number | null | undefined
  b: number | null | undefined
  format: (v: number | null | undefined) => string
  lowerIsBetter?: boolean
}) {
  const max = Math.max(a ?? 0, b ?? 0, 1)
  const wa = ((a ?? 0) / max) * 100
  const wb = ((b ?? 0) / max) * 100
  const aWins = a != null && b != null && (lowerIsBetter ? a < b : a > b)
  const bWins = a != null && b != null && (lowerIsBetter ? b < a : b > a)
  return (
    <View style={{ marginBottom: space.l }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 6 }}>
        <Text style={[type.data, { flex: 1, color: aWins ? color.text : color.textSecondary }]}>{format(a)}</Text>
        <Text style={[type.label, { fontSize: 9 }]}>{label}</Text>
        <Text style={[type.data, { flex: 1, textAlign: 'right', color: bWins ? color.text : color.textSecondary }]}>{format(b)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: alpha(0.06), flexDirection: 'row', justifyContent: 'flex-end', overflow: 'hidden' }}>
          <View style={{ width: `${wa}%`, backgroundColor: aWins ? color.text : alpha(0.35), borderRadius: 3 }} />
        </View>
        <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: alpha(0.06), overflow: 'hidden' }}>
          <View style={{ width: `${wb}%`, height: 5, backgroundColor: bWins ? color.text : alpha(0.35), borderRadius: 3 }} />
        </View>
      </View>
    </View>
  )
}

export function TogetherView({ m, onRefresh, refreshing }: {
  m: TogetherModel; onRefresh?: () => void; refreshing?: boolean
}) {
  const a = m.me
  const b = m.partner
  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Header eyebrow="Together" title={`${m.meName} & ${m.partnerName}`} />

      <Card>
        <View style={{ flexDirection: 'row' }}>
          {[{ n: m.meName, s: a }, { n: m.partnerName, s: b }].map((p, i) => (
            <View key={p.n + i} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: color.hairline }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.m }}>
                <Avatar name={p.n} size={22} active={i === 0} />
                <Text style={[type.bodyStrong, { fontSize: 14 }]}>{p.n}</Text>
              </View>
              <Gauge value={p.s?.readiness ?? null} size={124} stroke={8} label="Readiness" />
              <View style={{ flexDirection: 'row', gap: space.l, marginTop: space.l }}>
                <Stat value={hm(p.s?.lastSleep)} label="Sleep" size="s" />
                <Stat value={num(p.s?.quality)} label="Food" size="s" />
              </View>
            </View>
          ))}
        </View>
      </Card>

      {m.live ? (
        <Card style={{ marginTop: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, marginBottom: space.m }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.text }} />
            <Text style={type.label}>{m.partnerName} · live</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' }}>
            <Stat value={m.live.hrv != null ? String(Math.round(m.live.hrv)) : '—'} unit="ms" label="HRV" size="s" />
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="heart" size={14} color={color.text} />
              <Text style={[type.hero, { fontSize: 48, lineHeight: 52 }]}>{m.live.hr ?? '—'}</Text>
              <Text style={type.label}>bpm</Text>
            </View>
            <Stat value={m.live.skinTemp != null ? m.live.skinTemp.toFixed(1) : '—'} unit="°C" label="Skin" size="s" />
          </View>
        </Card>
      ) : null}

      <Label>Today</Label>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.l }}>
          <Text style={[type.label, { color: color.text }]}>{m.meName}</Text>
          <Text style={[type.label, { color: color.text }]}>{m.partnerName}</Text>
        </View>
        <Versus label="Sleep" a={a?.lastSleep} b={b?.lastSleep} format={hm} />
        <Versus label="7-night avg" a={a?.sleep7} b={b?.sleep7} format={hm} />
        <Versus label="Resting HR" a={a?.rhr} b={b?.rhr} format={v => (v != null ? `${Math.round(v)} bpm` : '—')} lowerIsBetter />
        <Versus label="HRV" a={a?.hrv} b={b?.hrv} format={v => (v != null ? `${Math.round(v)} ms` : '—')} />
        <Versus label="Steps" a={a?.steps} b={b?.steps} format={v => num(v)} />
        <Versus label="Protein" a={a?.protein} b={b?.protein} format={v => (v != null ? `${Math.round(v)} g` : '—')} />
        <Versus label="Food quality" a={a?.quality} b={b?.quality} format={v => num(v)} />
        <Versus label="Plants / wk" a={a?.plants} b={b?.plants} format={v => num(v)} />
        <Versus label="Sessions / wk" a={a?.sessions} b={b?.sessions} format={v => num(v)} />
        <Versus label="Volume / wk" a={a?.volume} b={b?.volume} format={v => (v != null ? `${num(v / 1000, 1)} t` : '—')} />
        <Versus label="Running / wk" a={a?.runKm} b={b?.runKm} format={v => (v != null ? `${num(v, 1)} km` : '—')} />
        <Versus label="Fitness" a={a?.fitness} b={b?.fitness} format={v => num(v)} />
        <Text style={[type.caption, { textAlign: 'center' }]}>Brighter bar = better today. Friendly competition only.</Text>
      </Card>

      <Label>Sleep this week</Label>
      <Card>
        {[{ n: m.meName, s: a, t: m.sleepTargets[0] }, { n: m.partnerName, s: b, t: m.sleepTargets[1] }].map((p, i) => (
          <View key={p.n + i} style={{ marginTop: i ? space.xl : 0 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.m }}>
              <Text style={[type.bodyStrong, { fontSize: 14 }]}>{p.n}</Text>
              <Text style={type.unit}>avg {hm(p.s?.sleep7)}</Text>
            </View>
            <Bars values={p.s?.sleepNights ?? []} labels={m.weekLabels} height={64} target={p.t} />
          </View>
        ))}
      </Card>

    </Screen>
  )
}

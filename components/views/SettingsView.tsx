import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import type { Profile } from '../../lib/types'
import type { Zone } from '../../lib/run/zones'
import { Avatar, Button, Card, Header, Label, Screen, Segmented, tap } from '../ui'

type IconName = keyof typeof Ionicons.glyphMap

export interface SettingsModel {
  name: string
  email?: string
  age?: number
  heightCm?: number
  sex?: string | null
  goal: Profile['goal']
  kcal: string
  protein: string
  sleepH: string
  weight: string
  kcalAuto: number
  proteinAuto: number
  maxHr: string
  restingHr: string
  maxHrAuto: number
  restingHrAuto: number
  zones: Zone[]
  health: { available: boolean; lastSync: string; note?: string }
  strava: { state: 'unconfigured' | 'unavailable' | 'disconnected' | 'connected'; athlete?: string | null; lastSync?: string }
  ring: { name?: string; status: string }
  circle?: { code: string; partner?: string | null }
  busy: string | null
}

export interface SettingsHandlers {
  onBack: () => void
  onChange: (patch: Partial<Pick<SettingsModel, 'goal' | 'kcal' | 'protein' | 'sleepH' | 'weight' | 'maxHr' | 'restingHr'>>) => void
  onSave: () => void
  onHealthSync: () => void
  onStravaConnect: () => void
  onStravaSync: () => void
  onStravaDisconnect: () => void
  onOpenRing: () => void
  onShareCode: () => void
  onLeave: () => void
  onSignOut: () => void
}

/** Big editable number inside an inset well. */
function NumberWell({ label, value, onChange, unit, placeholder, decimal }: {
  label: string; value: string; onChange: (v: string) => void; unit: string; placeholder?: string; decimal?: boolean
}) {
  return (
    <Card inset style={{ flex: 1 }}>
      <Text style={[type.label, { textAlign: 'center', fontSize: 9 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 3, marginTop: 4 }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={color.textFaint}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          selectionColor={color.text}
          style={{
            fontFamily: font.semibold, fontSize: 26, letterSpacing: -0.8, color: color.text, textAlign: 'center', padding: 0,
            width: Math.max(2, (value || placeholder || '').length) * 15 + 10,
          }}
        />
        <Text style={type.unit}>{unit}</Text>
      </View>
    </Card>
  )
}

function LinkRow({ icon, title, status, onPress, last, right }: {
  icon: IconName; title: string; status: string; onPress?: () => void; last?: boolean; right?: React.ReactNode
}) {
  const body = (pressed: boolean) => (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m + 2,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: color.hairline, opacity: pressed ? 0.6 : 1,
    }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={17} color={color.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong}>{title}</Text>
        <Text style={[type.unit, { marginTop: 2 }]} numberOfLines={2}>{status}</Text>
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={15} color={color.textTertiary} /> : null}
    </View>
  )
  if (!onPress) return body(false)
  return <Pressable onPress={() => { tap(); onPress() }}>{({ pressed }) => body(pressed)}</Pressable>
}

function SmallButton({ label, onPress, loading, primary }: { label: string; onPress: () => void; loading?: boolean; primary?: boolean }) {
  return (
    <Pressable onPress={() => { tap(); onPress() }} disabled={loading}
      style={({ pressed }) => ({
        paddingHorizontal: 14, height: 32, borderRadius: radius.pill, justifyContent: 'center',
        backgroundColor: primary ? color.text : color.insetStrong, opacity: pressed || loading ? 0.6 : 1,
      })}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: primary ? color.bg : color.text }}>{loading ? '…' : label}</Text>
    </Pressable>
  )
}

export function SettingsView({ m, h }: { m: SettingsModel; h: SettingsHandlers }) {
  const [garminOpen, setGarminOpen] = useState(false)

  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header title="Settings" onBack={h.onBack} />

      {/* PROFILE */}
      <Card>
        <View style={{ alignItems: 'center' }}>
          <Avatar name={m.name} size={72} active />
          <Text style={[type.display, { fontSize: 22, marginTop: space.m }]}>{m.name}</Text>
          {m.email ? <Text style={[type.unit, { marginTop: 2 }]}>{m.email}</Text> : null}
          <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.l }}>
            {[m.age ? `${m.age} y` : null, m.heightCm ? `${m.heightCm} cm` : null, m.sex ?? null].filter(Boolean).map(x => (
              <View key={x as string} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline }}>
                <Text style={[type.caption, { color: color.textSecondary }]}>{x}</Text>
              </View>
            ))}
          </View>
        </View>
      </Card>

      {/* GOALS */}
      <Label>Goals</Label>
      <Card>
        <Segmented
          options={[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]}
          value={m.goal} onChange={goal => h.onChange({ goal })}
        />
        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.l }}>
          <NumberWell label="Calories" value={m.kcal} onChange={kcal => h.onChange({ kcal })} unit="kcal" placeholder={String(m.kcalAuto)} />
          <NumberWell label="Protein" value={m.protein} onChange={protein => h.onChange({ protein })} unit="g" placeholder={String(m.proteinAuto)} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.s }}>
          <NumberWell label="Sleep" value={m.sleepH} onChange={sleepH => h.onChange({ sleepH })} unit="h" decimal />
          <NumberWell label="Weight" value={m.weight} onChange={weight => h.onChange({ weight })} unit="kg" decimal />
        </View>
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
          Faded numbers are automatic — derived from your body and goal.
        </Text>
        <Button label="Save goals" onPress={h.onSave} loading={m.busy === 'save'} style={{ marginTop: space.l }} />
      </Card>

      {/* HEART-RATE ZONES */}
      <Label>Heart-rate zones</Label>
      <Card>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <NumberWell label="Max HR" value={m.maxHr} onChange={maxHr => h.onChange({ maxHr })} unit="bpm" placeholder={String(m.maxHrAuto)} />
          <NumberWell label="Resting HR" value={m.restingHr} onChange={restingHr => h.onChange({ restingHr })} unit="bpm" placeholder={String(m.restingHrAuto)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: space.l }}>
          {m.zones.map(z => (
            <View key={z.n} style={{ flex: 1, alignItems: 'center', paddingVertical: space.s, borderRadius: radius.s, backgroundColor: alpha(0.02 + z.n * 0.025) }}>
              <Text style={[type.label, { fontSize: 9, color: color.text }]}>Z{z.n}</Text>
              <Text style={[type.unit, { fontSize: 10, marginTop: 2, color: color.textSecondary }]}>{z.lo}</Text>
            </View>
          ))}
        </View>
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
          Karvonen zones from max and resting HR. Faded values are estimated from your age and recent resting HR — a lab or all-out hill test beats the estimate.
        </Text>
        <Button label="Save zones" variant="secondary" onPress={h.onSave} loading={m.busy === 'save'} style={{ marginTop: space.l }} />
      </Card>

      {/* CONNECTIONS */}
      <Label>Connections</Label>
      <Card style={{ paddingVertical: 0 }}>
        <LinkRow
          icon="heart-circle-outline" title="Apple Health"
          status={m.health.available ? `SYNCED ${m.health.lastSync.toUpperCase()}` : (m.health.note ?? 'UNAVAILABLE')}
          right={m.health.available ? <SmallButton label="Sync" onPress={h.onHealthSync} loading={m.busy === 'health'} /> : undefined}
        />
        <LinkRow
          icon="navigate-circle-outline" title="Strava"
          status={
            m.strava.state === 'connected' ? `${(m.strava.athlete ?? 'CONNECTED').toUpperCase()} · ${m.strava.lastSync?.toUpperCase() ?? ''}`
              : m.strava.state === 'unconfigured' ? 'ADD STRAVA KEYS (README)'
                : m.strava.state === 'unavailable' ? 'NEEDS THE INSTALLED APP' : 'NOT CONNECTED'
          }
          right={
            m.strava.state === 'connected' ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <SmallButton label="Sync" onPress={h.onStravaSync} loading={m.busy === 'strava-sync'} />
                <SmallButton label="Off" onPress={h.onStravaDisconnect} />
              </View>
            ) : m.strava.state === 'disconnected' ? (
              <SmallButton label="Connect" primary onPress={h.onStravaConnect} loading={m.busy === 'strava'} />
            ) : undefined
          }
        />
        <LinkRow icon="watch-outline" title="Garmin" status="VIA APPLE HEALTH + STRAVA" onPress={() => setGarminOpen(o => !o)} />
        {garminOpen ? (
          <Card inset style={{ marginBottom: space.m }}>
            {[
              'Garmin Connect → Settings → Connected Apps → Apple Health → allow everything.',
              'Optional: Connected Apps → Strava, then connect Strava above for GPS and heart-rate detail.',
              'If a ring also tracks sleep, pick the preferred source on the Sleep screen.',
            ].map((t, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space.m, marginBottom: i < 2 ? space.s : 0 }}>
                <Text style={[type.unit, { color: color.text }]}>{i + 1}</Text>
                <Text style={[type.caption, { flex: 1, color: color.textSecondary }]}>{t}</Text>
              </View>
            ))}
          </Card>
        ) : null}
        <LinkRow icon="ellipse-outline" title={m.ring.name ?? 'Smart ring'} status={m.ring.status.toUpperCase()} onPress={h.onOpenRing} last />
      </Card>

      {/* SHARED SPACE */}
      <Label>Shared space</Label>
      <Card>
        {m.circle ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={type.label}>Invite code</Text>
            <Text style={{ fontFamily: font.semibold, fontSize: 34, letterSpacing: 8, color: color.text, marginTop: space.xs }}>{m.circle.code}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m }}>
              <Avatar name={m.name} size={26} active />
              <View style={{ width: 24, height: 1, backgroundColor: alpha(0.3) }} />
              <Avatar name={m.circle.partner ?? '?'} size={26} />
            </View>
            <Text style={[type.caption, { marginTop: space.s }]}>
              {m.circle.partner ? `Sharing with ${m.circle.partner}` : 'Waiting for your partner to join'}
            </Text>
            <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.l, alignSelf: 'stretch' }}>
              <Button label="Share code" icon="share-outline" variant="secondary" onPress={h.onShareCode} style={{ flex: 1 }} />
              <Button label="Leave" variant="ghost" onPress={h.onLeave} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <Text style={[type.sub, { textAlign: 'center' }]}>Create or join a shared space from the Us tab.</Text>
        )}
      </Card>

      <Button label="Sign out" variant="ghost" icon="log-out-outline" onPress={h.onSignOut} style={{ marginTop: space.xl }} />
      <Text style={[type.unit, { textAlign: 'center', color: color.textFaint }]}>ORUS 1.0</Text>
    </Screen>
  )
}

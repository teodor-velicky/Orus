// Live run recording — presentational.
import { Pressable, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { num } from '../../lib/format'
import { paceText, raceTime } from '../../lib/run/geo'
import type { Zone } from '../../lib/run/zones'
import { paceRange, stepAmount, type PaceStatus, type Workout, type WorkoutStep } from '../../lib/run/workout'
import { Button, Card, Chip, Header, IconButton, Label, Screen, Segmented, tap } from '../ui'
import { Progress } from '../charts'
import { LiveStat, RouteMap, ZoneBars, ZoneStrip } from '../run'

export interface RunRecordModel {
  phase: 'ready' | 'running' | 'paused' | 'summary'
  gps: { accuracy: number | null; searching: boolean; denied: boolean; background: boolean; error: string | null }
  ring: { name?: string; connected: boolean; hr: number | null }
  healthFallback: boolean
  /** Workout on offer (from the tapped recommendation or today's plan). */
  workout: Workout | null
  /** 'Recommended' preselected when the run was started from a plan day. */
  mode: 'free' | 'workout'
  voiceMuted: boolean
  /** Live guidance while a workout is being followed. */
  guide?: {
    title: string
    stepKind: WorkoutStep['kind']
    stepLabel: string
    counter: string
    remainingText: string | null
    remainingUnit: string | null
    target: string | null
    fraction: number
    status: PaceStatus
    nextText: string | null
    complete: boolean
  }
  elapsedS: number
  distanceM: number
  paceS: number | null
  avgPaceS: number | null
  hr: number | null
  zones: Zone[]
  route: [number, number][]
  lastSplit?: { km: number; paceS: number }
  summary?: {
    distanceM: number; movingS: number; avgPaceS: number | null; avgHr: number | null; maxHr: number | null
    elevationM: number | null; kcal: number | null; zoneSeconds: number[] | null; hrNote: string
  }
  name: string
  effort: number | null
  saving: boolean
}

export interface RunRecordHandlers {
  onClose: () => void
  onStart: () => void
  onMode: (mode: 'free' | 'workout') => void
  onSkipStep: () => void
  onToggleVoice: () => void
  onPause: () => void
  onResume: () => void
  onFinish: () => void
  onSave: () => void
  onDiscard: () => void
  onName: (v: string) => void
  onEffort: (v: number) => void
}

function RoundButton({ icon, label, onPress, primary, size = 84 }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; size?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: space.s }}>
      <Pressable onPress={() => { tap(); onPress() }}
        style={({ pressed }) => ({
          width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
          backgroundColor: primary ? color.text : color.insetStrong, borderWidth: 1, borderColor: primary ? color.text : color.hairlineStrong,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}>
        <Ionicons name={icon} size={size * 0.36} color={primary ? color.bg : color.text} />
      </Pressable>
      <Text style={type.label}>{label}</Text>
    </View>
  )
}

function gpsText(g: RunRecordModel['gps']) {
  if (g.denied) return { t: 'Location off', s: 'Allow location for Orus in iOS Settings.' }
  if (g.accuracy == null) return { t: 'Finding GPS…', s: 'Step outside with a clear view of the sky.' }
  if (g.accuracy <= 10) return { t: `GPS ready · ±${Math.round(g.accuracy)} m`, s: g.background ? 'Keeps recording with the screen locked.' : 'Keep the app open — background location is off.' }
  if (g.accuracy <= 30) return { t: `GPS fair · ±${Math.round(g.accuracy)} m`, s: 'A few more seconds improves the first kilometre.' }
  return { t: `GPS weak · ±${Math.round(g.accuracy)} m`, s: 'Waiting for a better fix…' }
}

const STEP_ICON: Record<WorkoutStep['kind'], keyof typeof Ionicons.glyphMap> = {
  warmup: 'sunny-outline', work: 'flash', recovery: 'pause-outline', cooldown: 'moon-outline', steady: 'walk-outline',
}

/** Workout structure; repeated work/recovery pairs collapse into one "5 ×" row. */
function WorkoutSteps({ workout }: { workout: Workout }) {
  const rows: { key: string; icon: keyof typeof Ionicons.glyphMap; title: string; sub: string | null; strong: boolean }[] = []
  for (let i = 0; i < workout.steps.length; i++) {
    const st = workout.steps[i]
    if (st.rep && st.rep.n > 1) continue
    if (st.kind === 'recovery' && workout.steps[i - 1]?.rep) {
      if (rows.some(r => r.key.startsWith('rec-'))) continue
      rows.push({ key: `rec-${i}`, icon: STEP_ICON.recovery, title: `${stepAmount(st)} ${st.label.toLowerCase()} between`, sub: null, strong: false })
      continue
    }
    const count = st.rep ? `${st.rep.of} × ` : ''
    const pace = paceRange(st)
    rows.push({
      key: `s-${i}`, icon: STEP_ICON[st.kind], strong: st.kind === 'work',
      title: st.rep ? `${count}${st.label}` : `${stepAmount(st)} ${st.label.toLowerCase()}`,
      sub: pace ? `${pace} /km${st.alert === 'fast' ? ' · slower is fine' : ''}` : null,
    })
  }
  return (
    <View style={{ gap: space.s }}>
      {rows.map(r => (
        <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: r.strong ? color.text : color.insetStrong }}>
            <Ionicons name={r.icon} size={14} color={r.strong ? color.bg : color.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: color.text, fontFamily: font.medium }]}>{r.title}</Text>
            {r.sub ? <Text style={[type.unit, { fontSize: 10 }]}>{r.sub}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  )
}

const STATUS_TEXT = (g: NonNullable<RunRecordModel['guide']>) =>
  g.status === 'fast' ? `Too fast · ease to ${g.target}`
    : g.status === 'slow' ? `Too slow · pick up to ${g.target}`
      : g.status === 'on' ? 'On pace' : null

function GuidePanel({ g, onSkip }: { g: NonNullable<RunRecordModel['guide']>; onSkip: () => void }) {
  if (g.complete) {
    return (
      <Card>
        <View style={{ alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" size={28} color={color.text} />
          <Text style={[type.title, { marginTop: space.s }]}>Workout complete</Text>
          <Text style={[type.sub, { textAlign: 'center', marginTop: 2 }]}>Keep jogging easy or finish the run.</Text>
        </View>
      </Card>
    )
  }
  const alert = g.status === 'fast' || g.status === 'slow'
  const work = g.stepKind === 'work'
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={type.label}>{g.counter}</Text>
        <Pressable hitSlop={10} onPress={() => { tap(); onSkip() }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: color.inset }}>
          <Text style={[type.caption, { color: color.textSecondary }]}>Skip</Text>
          <Ionicons name="play-skip-forward" size={11} color={color.textSecondary} />
        </Pressable>
      </View>
      <View style={{ alignItems: 'center', marginTop: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: work ? color.text : color.insetStrong }}>
            <Ionicons name={STEP_ICON[g.stepKind]} size={11} color={work ? color.bg : color.text} />
          </View>
          <Text style={[type.title, { fontSize: 19 }]}>{g.stepLabel}</Text>
        </View>
        {g.remainingText ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: space.xs }}>
            <Text style={[type.hero, { fontSize: 58, lineHeight: 62 }]}>{g.remainingText}</Text>
            <Text style={[type.unit, { fontSize: 13 }]}>{g.remainingUnit}</Text>
          </View>
        ) : null}
        {g.target ? <Text style={[type.sub, { marginTop: 2 }]}>Target {g.target} /km</Text> : null}
      </View>
      <View style={{ marginTop: space.m }}>
        <Progress pct={g.fraction * 100} height={6} />
      </View>
      {STATUS_TEXT(g) ? (
        <View style={{
          alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.m,
          paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill,
          backgroundColor: alert ? color.text : alpha(0.06),
        }}>
          <Ionicons name={g.status === 'fast' ? 'arrow-down' : g.status === 'slow' ? 'arrow-up' : 'checkmark'} size={13} color={alert ? color.bg : color.text} />
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: alert ? color.bg : color.text }}>{STATUS_TEXT(g)}</Text>
        </View>
      ) : null}
      {g.nextText ? <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>Next · {g.nextText}</Text> : null}
    </Card>
  )
}

export function RunRecordView({ m, h }: { m: RunRecordModel; h: RunRecordHandlers }) {
  if (m.phase === 'summary' && m.summary) return <Summary m={m} h={h} />
  const live = m.phase === 'running' || m.phase === 'paused'
  const gps = gpsText(m.gps)
  const voice = (
    <IconButton name={m.voiceMuted ? 'volume-mute-outline' : 'volume-high-outline'} onPress={h.onToggleVoice} />
  )

  if (!live) {
    return (
      <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
        <Header eyebrow="Running" title="New run" right={<IconButton name="close" onPress={h.onClose} />} />

        {m.workout ? (
          <View style={{ marginBottom: space.l }}>
            <Segmented options={[{ value: 'free', label: 'Free run' }, { value: 'workout', label: m.workout.title }]} value={m.mode} onChange={h.onMode} />
          </View>
        ) : null}

        {m.mode === 'workout' && m.workout ? (
          <Card>
            <Text style={[type.label, { textAlign: 'center' }]}>Guided workout</Text>
            <Text style={[type.display, { fontSize: 22, textAlign: 'center', marginTop: 2, marginBottom: space.l }]}>{m.workout.title}</Text>
            <WorkoutSteps workout={m.workout} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.l, padding: space.m, borderRadius: radius.m, backgroundColor: alpha(0.03) }}>
              <Ionicons name={m.voiceMuted ? 'volume-mute-outline' : 'volume-high-outline'} size={16} color={color.textSecondary} />
              <Text style={[type.caption, { flex: 1, color: color.textSecondary }]}>
                {m.voiceMuted ? 'Voice cues are off — you\'ll get vibrations for each step and pace warning.' : 'Voice + vibration tell you when to run, when to recover, and when you\'re off pace.'}
              </Text>
              <Pressable hitSlop={8} onPress={() => { tap(); h.onToggleVoice() }}>
                <Text style={[type.caption, { color: color.text, fontFamily: font.semibold }]}>{m.voiceMuted ? 'Turn on' : 'Mute'}</Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={[type.title, { textAlign: 'center' }]}>Free run</Text>
            <Text style={[type.sub, { textAlign: 'center', marginTop: 4 }]}>No targets — just time, distance, pace and heart rate. Zones and splits are worked out afterwards.</Text>
          </Card>
        )}

        <Card style={{ marginTop: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: m.gps.accuracy != null && m.gps.accuracy <= 30 ? color.text : color.inset }}>
              <Ionicons name="navigate" size={17} color={m.gps.accuracy != null && m.gps.accuracy <= 30 ? color.bg : color.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.bodyStrong}>{gps.t}</Text>
              <Text style={type.caption}>{m.gps.error ?? gps.s}</Text>
            </View>
          </View>
          <View style={{ height: 1, backgroundColor: color.hairline, marginVertical: space.m }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: m.ring.connected ? color.text : color.inset }}>
              <Ionicons name={m.ring.connected ? 'heart' : 'heart-outline'} size={17} color={m.ring.connected ? color.bg : color.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.bodyStrong}>{m.ring.connected ? m.ring.name ?? 'Ring' : 'No ring connected'}</Text>
              <Text style={type.caption}>
                {m.ring.connected ? 'Live heart rate and zones'
                  : m.healthFallback ? 'Heart rate from Apple Health (Garmin / watch) after the run'
                    : 'Pace and distance only'}
              </Text>
            </View>
            {m.ring.hr ? <Text style={[type.number, { fontSize: 20 }]}>{m.ring.hr}<Text style={type.unit}> bpm</Text></Text> : null}
          </View>
        </Card>

        <View style={{ alignItems: 'center', marginTop: space.xxl }}>
          <RoundButton icon="play" label={m.mode === 'workout' && m.workout ? 'Start workout' : 'Start'} primary size={112} onPress={h.onStart} />
        </View>
      </Screen>
    )
  }

  const g = m.guide
  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s, marginBottom: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.phase === 'running' ? color.text : color.textFaint }} />
          <Text style={type.label}>{m.phase === 'running' ? (g ? g.title : 'Recording') : 'Paused'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Text style={type.unit}>{m.gps.accuracy != null ? `GPS ±${Math.round(m.gps.accuracy)} m` : 'NO GPS'}</Text>
          {g ? voice : null}
        </View>
      </View>

      {g ? (
        <GuidePanel g={g} onSkip={h.onSkipStep} />
      ) : (
        <View style={{ alignItems: 'center', marginBottom: space.xl }}>
          <LiveStat value={raceTime(m.elapsedS)} label="Time" big />
        </View>
      )}

      <Card style={{ marginTop: g ? space.m : 0 }}>
        <View style={{ flexDirection: 'row' }}>
          <LiveStat value={num(m.distanceM / 1000, 2)} unit="km" label="Distance" />
          <View style={{ width: 1, backgroundColor: color.hairline }} />
          <LiveStat value={paceText(m.paceS)} unit="/km" label="Pace" />
        </View>
        <View style={{ height: 1, backgroundColor: color.hairline, marginVertical: space.l }} />
        <View style={{ flexDirection: 'row' }}>
          {g
            ? <LiveStat value={raceTime(m.elapsedS)} label="Time" />
            : <LiveStat value={paceText(m.avgPaceS)} unit="/km" label="Avg pace" />}
          <View style={{ width: 1, backgroundColor: color.hairline }} />
          <LiveStat value={m.hr ? String(m.hr) : '—'} unit="bpm" label="Heart rate" />
        </View>
        {m.ring.connected ? (
          <View style={{ marginTop: space.l }}>
            <ZoneStrip zones={m.zones} bpm={m.hr} />
          </View>
        ) : null}
      </Card>

      <Card padded={false} style={{ marginTop: space.m }}>
        <RouteMap route={m.route} height={g ? 140 : 180} live />
      </Card>

      {m.lastSplit && !g ? (
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
          Km {m.lastSplit.km} · <Text style={{ color: color.text, fontFamily: font.medium }}>{paceText(m.lastSplit.paceS)} /km</Text>
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.xxl, marginTop: space.xl }}>
        {m.phase === 'running' ? (
          <RoundButton icon="pause" label="Pause" primary onPress={h.onPause} />
        ) : (
          <>
            <RoundButton icon="play" label="Resume" primary onPress={h.onResume} />
            <RoundButton icon="stop" label="Finish" onPress={h.onFinish} />
          </>
        )}
      </View>
      {!m.gps.background ? (
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.l }]}>Background location is off — keep Orus open while you run.</Text>
      ) : null}
    </Screen>
  )
}

function Summary({ m, h }: { m: RunRecordModel; h: RunRecordHandlers }) {
  const s = m.summary!
  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow="Run complete" title={`${(s.distanceM / 1000).toFixed(2)} km`} subtitle={`${raceTime(s.movingS)} · ${paceText(s.avgPaceS)} /km`} />
      <Card padded={false}>
        <RouteMap route={m.route} height={200} />
      </Card>
      <Card style={{ marginTop: space.m }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          {[
            { v: s.avgHr ? String(s.avgHr) : '—', l: 'Avg HR' },
            { v: s.maxHr ? String(s.maxHr) : '—', l: 'Max HR' },
            { v: s.elevationM != null ? `${s.elevationM}` : '—', l: 'Elev m' },
            { v: s.kcal ? num(s.kcal) : '—', l: 'kcal' },
          ].map(x => (
            <View key={x.l} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={[type.number, { fontSize: 20 }]}>{x.v}</Text>
              <Text style={[type.label, { fontSize: 9 }]}>{x.l}</Text>
            </View>
          ))}
        </View>
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>{s.hrNote}</Text>
        {s.zoneSeconds ? <View style={{ marginTop: space.l }}><ZoneBars zones={m.zones} seconds={s.zoneSeconds} /></View> : null}
      </Card>

      <Label>Name</Label>
      <Card inset>
        <TextInput value={m.name} onChangeText={h.onName} placeholder="Morning run" placeholderTextColor={color.textFaint}
          selectionColor={color.text} style={{ color: color.text, fontFamily: font.medium, fontSize: 16, textAlign: 'center', padding: 0 }} />
      </Card>

      <Label>How hard did it feel?</Label>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(v => {
          const on = m.effort === v
          return (
            <Pressable key={v} onPress={() => { tap(); h.onEffort(v) }}
              style={{ width: 30, height: 38, borderRadius: radius.s, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.text : alpha(0.02 + v * 0.012), borderWidth: 1, borderColor: on ? color.text : color.hairline }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: on ? color.bg : color.textSecondary }}>{v}</Text>
            </Pressable>
          )
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={type.unit}>EASY</Text>
        <Text style={type.unit}>ALL OUT</Text>
      </View>

      <Button label="Save run" icon="checkmark" onPress={h.onSave} loading={m.saving} style={{ marginTop: space.xl }} />
      <Button label="Discard" variant="ghost" onPress={h.onDiscard} style={{ marginTop: space.s }} />
    </Screen>
  )
}

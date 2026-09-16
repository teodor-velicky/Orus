// Running goal editor — presentational.
import { Text, TextInput, View } from 'react-native'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { paceText, raceTime } from '../../lib/run/geo'
import type { GoalAssessment, TrainingPaces } from '../../lib/run/plan'
import { Button, Card, Chip, Header, Label, Screen, Segmented } from '../ui'
import { Gauge } from '../charts'

export interface RunGoalModel {
  distance: string
  distances: { value: string; label: string }[]
  h: string
  m: string
  s: string
  showHours: boolean
  weeks: number | null
  weekOptions: (number | null)[]
  quickTargets: { label: string; seconds: number }[]
  assessment: GoalAssessment | null
  goalPaces: TrainingPaces | null
  hasGoal: boolean
  saving: boolean
  valid: boolean
}

export interface RunGoalHandlers {
  onClose: () => void
  onDistance: (v: string) => void
  onTime: (patch: Partial<{ h: string; m: string; s: string }>) => void
  onQuick: (seconds: number) => void
  onWeeks: (w: number | null) => void
  onSave: () => void
  onRemove: () => void
}

function TimeField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 84, height: 76, borderRadius: radius.m, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center' }}>
        <TextInput value={value} onChangeText={t => onChange(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="00"
          placeholderTextColor={color.textFaint} selectionColor={color.text}
          style={{ fontFamily: font.semibold, fontSize: 38, letterSpacing: -1.2, color: color.text, textAlign: 'center', width: 80, padding: 0 }} />
      </View>
      <Text style={[type.label, { marginTop: 6, fontSize: 9 }]}>{label}</Text>
    </View>
  )
}

export function RunGoalView({ m, h }: { m: RunGoalModel; h: RunGoalHandlers }) {
  const a = m.assessment
  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow="Running" title="Goal" onBack={h.onClose} />

      <Card>
        <Text style={[type.label, { textAlign: 'center', marginBottom: space.m }]}>Distance</Text>
        <Segmented options={m.distances} value={m.distance} onChange={h.onDistance} />

        <Text style={[type.label, { textAlign: 'center', marginTop: space.xl, marginBottom: space.m }]}>Target time</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: space.s }}>
          {m.showHours ? (
            <>
              <TimeField value={m.h} onChange={v => h.onTime({ h: v })} label="h" />
              <Text style={[type.hero, { fontSize: 34, lineHeight: 76, color: color.textTertiary }]}>:</Text>
            </>
          ) : null}
          <TimeField value={m.m} onChange={v => h.onTime({ m: v })} label="min" />
          <Text style={[type.hero, { fontSize: 34, lineHeight: 76, color: color.textTertiary }]}>:</Text>
          <TimeField value={m.s} onChange={v => h.onTime({ s: v })} label="sec" />
        </View>
        {m.quickTargets.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, marginTop: space.l }}>
            {m.quickTargets.map(q => <Chip key={q.label} label={q.label} onPress={() => h.onQuick(q.seconds)} />)}
          </View>
        ) : null}

        <Text style={[type.label, { textAlign: 'center', marginTop: space.xl, marginBottom: space.m }]}>Race day</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
          {m.weekOptions.map(w => (
            <Chip key={String(w)} label={w == null ? 'No date' : `In ${w} weeks`} active={m.weeks === w} onPress={() => h.onWeeks(w)} />
          ))}
        </View>
      </Card>

      {a && m.valid ? (
        <>
          <Label>Where you stand</Label>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Gauge value={a.progress} size={160} stroke={9} label={a.headline}
                display={a.predictedS ? raceTime(a.predictedS) : '—'} sub={a.predictedS ? 'predicted today' : undefined} />
              <Text style={[type.title, { marginTop: space.m }]}>{a.title}</Text>
              <Text style={[type.sub, { textAlign: 'center', marginTop: 4 }]}>{a.detail}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: space.l }}>
              {[
                { v: paceText(a.goalPaceS), l: 'Goal pace /km' },
                { v: a.goalVdot.toFixed(1), l: 'Needs VDOT' },
                { v: a.currentVdot?.toFixed(1) ?? '—', l: 'You now' },
              ].map(x => (
                <View key={x.l} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[type.number, { fontSize: 20 }]}>{x.v}</Text>
                  <Text style={[type.label, { fontSize: 9 }]}>{x.l}</Text>
                </View>
              ))}
            </View>
          </Card>

          {m.goalPaces ? (
            <>
              <Label>Paces at goal fitness</Label>
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {[
                    { l: 'Easy', v: `${paceText(m.goalPaces.easy[0])}–${paceText(m.goalPaces.easy[1])}` },
                    { l: 'Threshold', v: paceText(m.goalPaces.threshold) },
                    { l: 'Interval', v: paceText(m.goalPaces.interval) },
                    { l: 'Repetition', v: paceText(m.goalPaces.repetition) },
                  ].map(x => (
                    <View key={x.l} style={{ width: '48.5%', padding: space.m, borderRadius: radius.m, backgroundColor: alpha(0.03), alignItems: 'center' }}>
                      <Text style={[type.label, { fontSize: 9 }]}>{x.l}</Text>
                      <Text style={[type.data, { fontSize: 16, marginTop: 4 }]}>{x.v}</Text>
                    </View>
                  ))}
                </View>
                <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
                  Train at your current paces — these are where they'll be when you're ready.
                </Text>
              </Card>
            </>
          ) : null}
        </>
      ) : null}

      <Button label={m.hasGoal ? 'Update goal' : 'Set goal'} icon="flag" onPress={h.onSave} loading={m.saving} disabled={!m.valid} style={{ marginTop: space.xl }} />
      {m.hasGoal ? <Button label="Remove goal" variant="ghost" onPress={h.onRemove} style={{ marginTop: space.s }} /> : null}
    </Screen>
  )
}

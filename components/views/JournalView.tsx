// Behaviour journal — presentational.
import { Pressable, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import type { Answers, BehaviorKey, Effect } from '../../lib/journal'
import { Button, Card, Header, IconButton, Label, Screen, tap } from '../ui'

type IconName = keyof typeof Ionicons.glyphMap

export interface JournalModel {
  dateLabel: string
  canNext: boolean
  manual: { key: BehaviorKey; label: string; icon: string }[]
  answers: Answers
  /** Behaviours read from your data for this day. */
  auto: { key: BehaviorKey; label: string; icon: string; value: boolean; detail: string }[]
  note: string
  effects: Effect[]
  /** Behaviours still collecting days: label and how many more answers are needed. */
  waiting: { label: string; days: number }[]
  answeredDays: number
  saving: boolean
  saved: boolean
}

export interface JournalHandlers {
  onBack: () => void
  onDay: (delta: number) => void
  onToggle: (key: BehaviorKey) => void
  onNote: (v: string) => void
  onSave: () => void
}

function Toggle({ on }: { on: boolean }) {
  return (
    <View style={{
      width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center',
      backgroundColor: on ? color.text : color.insetStrong,
    }}>
      <View style={{
        width: 22, height: 22, borderRadius: 11, backgroundColor: on ? color.bg : alpha(0.45),
        alignSelf: on ? 'flex-end' : 'flex-start',
      }} />
    </View>
  )
}

export function JournalView({ m, h }: { m: JournalModel; h: JournalHandlers }) {
  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow="Journal" title={m.dateLabel} onBack={h.onBack} />

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.m, marginTop: -space.m, marginBottom: space.l }}>
        <IconButton name="chevron-back" onPress={() => h.onDay(-1)} />
        <IconButton name="chevron-forward" onPress={() => m.canNext && h.onDay(1)} />
      </View>

      <Text style={[type.sub, { textAlign: 'center', marginBottom: space.l }]}>
        What you did on a day shapes the night after it and the next morning's recovery. Answer honestly; it's just for you.
      </Text>

      <Card style={{ paddingVertical: space.xs }}>
        {m.manual.map((b, i) => {
          const on = m.answers[b.key] === true
          return (
            <Pressable key={b.key} onPress={() => { tap(); h.onToggle(b.key) }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m,
                borderBottomWidth: i === m.manual.length - 1 ? 0 : 1, borderBottomColor: color.hairline,
              }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.text : color.inset }}>
                <Ionicons name={b.icon as IconName} size={16} color={on ? color.bg : color.textSecondary} />
              </View>
              <Text style={[type.bodyStrong, { flex: 1 }]}>{b.label}</Text>
              <Toggle on={on} />
            </Pressable>
          )
        })}
      </Card>

      {m.auto.length ? (
        <>
          <Label>Worked out for you</Label>
          <Card style={{ paddingVertical: space.xs }}>
            {m.auto.map((b, i) => (
              <View key={b.key} style={{
                flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m,
                borderBottomWidth: i === m.auto.length - 1 ? 0 : 1, borderBottomColor: color.hairline,
              }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: b.value ? color.text : color.inset }}>
                  <Ionicons name={b.icon as IconName} size={16} color={b.value ? color.bg : color.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.bodyStrong}>{b.label}</Text>
                  <Text style={type.caption}>{b.detail}</Text>
                </View>
                <Text style={[type.unit, { color: b.value ? color.text : color.textTertiary }]}>{b.value ? 'YES' : 'NO'}</Text>
              </View>
            ))}
          </Card>
          <Text style={[type.caption, { textAlign: 'center', marginTop: space.s }]}>From your food log, training and ring. Nothing to answer.</Text>
        </>
      ) : null}

      <Label>Note</Label>
      <Card inset>
        <TextInput
          value={m.note} onChangeText={h.onNote} multiline
          placeholder="Anything else worth remembering about today"
          placeholderTextColor={color.textFaint} selectionColor={color.text}
          style={{ color: color.text, fontFamily: font.regular, fontSize: 15, minHeight: 60, padding: 0 }}
        />
      </Card>

      <Button label={m.saved ? 'Saved' : 'Save'} icon={m.saved ? 'checkmark' : undefined} onPress={h.onSave}
        loading={m.saving} style={{ marginTop: space.xl }} />

      <Label>What moves your recovery</Label>
      {m.effects.length ? (
        m.effects.map(e => (
          <Card key={e.key} style={{ marginBottom: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <Ionicons
                name={e.verdict === 'hurts' ? 'trending-down' : e.verdict === 'helps' ? 'trending-up' : 'remove'}
                size={16} color={e.verdict === 'neutral' ? color.textTertiary : color.text} />
              <Text style={[type.bodyStrong, { flex: 1 }]}>{e.label}</Text>
              <Text style={type.unit}>{e.yesN} WITH · {e.noN} WITHOUT</Text>
            </View>
            <Text style={[type.sub, { marginTop: space.s, color: e.summary ? color.text : color.textSecondary }]}>
              {e.summary
                ? `The night after: ${e.summary}.`
                : 'No clear effect on your sleep or recovery so far.'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m }}>
              {e.outcomes.map(o => (
                <View key={o.metric} style={{
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
                  backgroundColor: o.notable ? (o.better ? alpha(0.14) : alpha(0.06)) : alpha(0.03),
                }}>
                  <Text style={[type.unit, { color: o.notable ? color.text : color.textTertiary }]}>
                    {o.label} {o.metric === 'sleep' ? `${Math.round(o.yes)}m vs ${Math.round(o.no)}m`
                      : o.metric === 'restorative' ? `${Math.round(o.yes)}% vs ${Math.round(o.no)}%`
                        : `${Math.round(o.yes)} vs ${Math.round(o.no)}`}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ))
      ) : (
        <Card>
          <Text style={[type.sub, { textAlign: 'center' }]}>
            {m.answeredDays === 0
              ? 'After a couple of weeks of check-ins, this shows which habits change your HRV, resting heart rate and sleep.'
              : `${m.answeredDays} ${m.answeredDays === 1 ? 'day' : 'days'} logged so far. Each habit needs at least 3 days with it and 3 without.`}
          </Text>
        </Card>
      )}
      {m.waiting.length ? (
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.s }]}>
          Still collecting: {m.waiting.slice(0, 4).map(w => `${w.label} (${w.days} more)`).join(', ')}
        </Text>
      ) : null}
    </Screen>
  )
}

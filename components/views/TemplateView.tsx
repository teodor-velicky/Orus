// Gym template editor: a named list of exercises with planned sets.
import { Pressable, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { color, font, radius, space, type } from '../../lib/theme'
import { Button, Card, Empty, Header, IconButton, Label, Screen, tap } from '../ui'

export interface TemplateRow {
  exerciseId: string
  name: string
  muscle: string
  sets: number
  /** What you lifted last time, e.g. "80×8, 80×7, 75×8". */
  last: string | null
}

export interface TemplateModel {
  name: string
  rows: TemplateRow[]
  totalSets: number
  saving: boolean
  starting: boolean
}

export interface TemplateHandlers {
  onBack: () => void
  onName: (v: string) => void
  onSets: (index: number, sets: number) => void
  onMove: (index: number, delta: number) => void
  onRemove: (index: number) => void
  onAddExercise: () => void
  onStart: () => void
  onDelete: () => void
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const step = (d: number) => { tap(); onChange(Math.max(1, Math.min(10, value + d))) }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <Pressable onPress={() => step(-1)} hitSlop={8}
        style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: color.inset }}>
        <Ionicons name="remove" size={14} color={color.text} />
      </Pressable>
      <Text style={[type.data, { width: 44, textAlign: 'center' }]}>{value} × </Text>
      <Pressable onPress={() => step(1)} hitSlop={8}
        style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: color.inset }}>
        <Ionicons name="add" size={14} color={color.text} />
      </Pressable>
    </View>
  )
}

export function TemplateView({ m, h }: { m: TemplateModel; h: TemplateHandlers }) {
  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow="Template" title={m.name || 'New template'} onBack={h.onBack}
        right={<IconButton name="trash-outline" onPress={h.onDelete} />} />

      <Card inset>
        <TextInput
          defaultValue={m.name}
          onEndEditing={e => h.onName(e.nativeEvent.text)}
          placeholder="Push day"
          placeholderTextColor={color.textFaint}
          selectionColor={color.text}
          style={{ color: color.text, fontFamily: font.semibold, fontSize: 18, textAlign: 'center', padding: 0 }}
        />
      </Card>

      <Label>Exercises</Label>
      {m.rows.length === 0 ? (
        <Empty icon="barbell-outline" title="No exercises yet"
          message="Add the lifts you do on this day, in order, with how many sets you plan."
          action="Add exercise" onAction={h.onAddExercise} />
      ) : (
        <Card style={{ paddingVertical: space.s }}>
          {m.rows.map((r, i) => (
            <View key={`${r.exerciseId}-${i}`} style={{
              paddingVertical: space.m,
              borderBottomWidth: i === m.rows.length - 1 ? 0 : 1, borderBottomColor: color.hairline,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <Text style={[type.unit, { width: 16 }]}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={type.bodyStrong} numberOfLines={1}>{r.name}</Text>
                  <Text style={[type.caption, { marginTop: 1 }]} numberOfLines={1}>
                    {r.muscle}{r.last ? ` · last ${r.last}` : ''}
                  </Text>
                </View>
                <Stepper value={r.sets} onChange={v => h.onSets(i, v)} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.l, marginTop: space.s }}>
                <Pressable hitSlop={8} disabled={i === 0} onPress={() => { tap(); h.onMove(i, -1) }}>
                  <Ionicons name="arrow-up" size={15} color={i === 0 ? color.textFaint : color.textSecondary} />
                </Pressable>
                <Pressable hitSlop={8} disabled={i === m.rows.length - 1} onPress={() => { tap(); h.onMove(i, 1) }}>
                  <Ionicons name="arrow-down" size={15} color={i === m.rows.length - 1 ? color.textFaint : color.textSecondary} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => { tap(); h.onRemove(i) }}>
                  <Ionicons name="close" size={15} color={color.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))}
        </Card>
      )}

      {m.rows.length ? (
        <>
          <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
            {m.rows.length} exercises · {m.totalSets} sets
          </Text>
          <Button label="Add exercise" variant="secondary" icon="add" onPress={h.onAddExercise} style={{ marginTop: space.l }} />
          <Button label="Start this workout" icon="play" loading={m.starting} onPress={h.onStart} style={{ marginTop: space.s }} />
          <Text style={[type.caption, { textAlign: 'center', marginTop: space.m, borderRadius: radius.s }]}>
            Sets start empty, with last time's weight and reps behind them.
          </Text>
        </>
      ) : null}
    </Screen>
  )
}

import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { MUSCLE_LABELS } from '../../lib/gym'
import type { Exercise, MuscleGroup } from '../../lib/types'
import { Card, Chip, Header, Label, Screen, tap } from '../ui'

type IconName = keyof typeof Ionicons.glyphMap

const EQUIPMENT_ICON: Record<string, IconName> = {
  barbell: 'barbell-outline', dumbbell: 'barbell-outline', machine: 'cog-outline', cable: 'git-commit-outline',
  bodyweight: 'body-outline', kettlebell: 'fitness-outline', band: 'infinite-outline', other: 'ellipse-outline',
}

export function ExercisePickerView({ exercises, busyId, onPick, onCreate, onClose }: {
  exercises: Exercise[]
  busyId: string | null
  onPick: (e: Exercise) => void
  onCreate: (name: string, muscle: MuscleGroup) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = exercises.filter(e => (!muscle || e.muscle_group === muscle) && (!q || e.name.toLowerCase().includes(q)))
    const by = new Map<MuscleGroup, Exercise[]>()
    for (const e of list) by.set(e.muscle_group, [...(by.get(e.muscle_group) ?? []), e])
    return (Object.keys(MUSCLE_LABELS) as MuscleGroup[]).filter(g => by.has(g)).map(g => ({ group: g, items: by.get(g)! }))
  }, [exercises, query, muscle])

  const count = groups.reduce((a, g) => a + g.items.length, 0)
  const trimmed = query.trim()
  const canCreate = trimmed.length > 2 && !exercises.some(e => e.name.toLowerCase() === trimmed.toLowerCase())

  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow={`${count} exercises`} title="Add exercise" onBack={onClose} />

      {/* SEARCH */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: space.s, height: 48, paddingHorizontal: space.l,
        borderRadius: radius.pill, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairlineStrong,
      }}>
        <Ionicons name="search" size={16} color={color.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          placeholderTextColor={color.textFaint}
          selectionColor={color.text}
          autoCorrect={false}
          style={{ flex: 1, color: color.text, fontFamily: font.regular, fontSize: 15, padding: 0 }}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={17} color={color.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {/* MUSCLE FILTER */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -space.screen, marginTop: space.m, flexGrow: 0 }}
        contentContainerStyle={{ gap: 6, paddingHorizontal: space.screen }}>
        <Chip label="All" active={!muscle} onPress={() => setMuscle(null)} />
        {(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map(g => (
          <Chip key={g} label={MUSCLE_LABELS[g]} active={muscle === g} onPress={() => setMuscle(muscle === g ? null : g)} />
        ))}
      </ScrollView>

      {canCreate ? (
        <Card style={{ marginTop: space.l }} onPress={() => onCreate(trimmed, muscle ?? 'full_body')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={20} color={color.bg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.bodyStrong}>Create “{trimmed}”</Text>
              <Text style={[type.unit, { marginTop: 2 }]}>CUSTOM · {(muscle ? MUSCLE_LABELS[muscle] : 'Full body').toUpperCase()}</Text>
            </View>
          </View>
        </Card>
      ) : null}

      {groups.length === 0 && !canCreate ? (
        <Text style={[type.sub, { textAlign: 'center', marginTop: space.xxl }]}>No matches. Type a longer name to create it.</Text>
      ) : null}

      {groups.map(g => (
        <View key={g.group}>
          <Label>{MUSCLE_LABELS[g.group]}</Label>
          <Card padded={false}>
            {g.items.map((e, i) => (
              <Pressable key={e.id} onPress={() => { tap(); onPick(e) }} disabled={!!busyId}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l,
                  borderTopWidth: i ? 1 : 0, borderTopColor: color.hairline, backgroundColor: pressed ? alpha(0.04) : 'transparent',
                })}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={EQUIPMENT_ICON[e.equipment] ?? 'ellipse-outline'} size={16} color={color.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.bodyStrong} numberOfLines={1}>{e.name}</Text>
                  <Text style={[type.unit, { marginTop: 1 }]}>{e.equipment.toUpperCase()}{e.user_id ? ' · CUSTOM' : ''}</Text>
                </View>
                {busyId === e.id ? <ActivityIndicator color={color.text} /> : (
                  <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="add" size={16} color={color.text} />
                  </View>
                )}
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  )
}

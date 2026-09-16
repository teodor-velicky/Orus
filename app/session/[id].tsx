// Live gym session: exercises → sets (weight × reps), done ticks, previous
// performance hints. Every edit persists immediately.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSession } from '../../lib/session'
import {
  addSet, deleteSession, deleteSet, e1rm, getSession, lastPerformance, listExercises,
  MUSCLE_LABELS, setVolume, updateSession, updateSet,
} from '../../lib/gym'
import { duration, num, shortDate } from '../../lib/format'
import { color, radius, space, type } from '../../lib/theme'
import { Button, Card, IconButton, Loading, Screen, Stat, tap } from '../../components/ui'
import type { Exercise, GymSession, GymSet } from '../../lib/types'

function useElapsed(start?: string, end?: string | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (end) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [end])
  if (!start) return 0
  return ((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000
}

function NumberCell({ value, onCommit, editable, suffix, decimal }: {
  value: number; onCommit: (v: number) => void; editable: boolean; suffix: string; decimal?: boolean
}) {
  const [text, setText] = useState(value ? String(value) : '')
  useEffect(() => { setText(value ? String(value) : '') }, [value])
  return (
    <View style={{
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      height: 40, borderRadius: radius.s, backgroundColor: color.surfaceRaised,
    }}>
      <TextInput
        value={text}
        editable={editable}
        onChangeText={t => setText(t.replace(',', '.').replace(decimal ? /[^0-9.]/g : /[^0-9]/g, ''))}
        onEndEditing={() => {
          const v = decimal ? parseFloat(text) : parseInt(text, 10)
          onCommit(isFinite(v) ? v : 0)
        }}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        placeholder="0"
        placeholderTextColor={color.textTertiary}
        selectionColor={color.text}
        style={{ color: color.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'center', minWidth: 36 }}
      />
      <Text style={[type.caption, { marginLeft: 2 }]}>{suffix}</Text>
    </View>
  )
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { me } = useSession()
  const [session, setSession] = useState<GymSession | null>(null)
  const [sets, setSets] = useState<GymSet[]>([])
  const [exercises, setExercises] = useState<Record<string, Exercise>>({})
  const [previous, setPrevious] = useState<Record<string, GymSet[]>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [res, ex] = await Promise.all([getSession(id), listExercises()])
    setExercises(Object.fromEntries(ex.map(e => [e.id, e])))
    if (res) {
      setSession(res.session)
      setSets(res.sets)
      const ids = [...new Set(res.sets.map(s => s.exercise_id))]
      const prev = await Promise.all(ids.map(eid => lastPerformance(res.session.user_id, eid, id)))
      setPrevious(Object.fromEntries(ids.map((eid, i) => [eid, prev[i]])))
    }
    setLoading(false)
  }, [id])

  useFocusEffect(useCallback(() => { load().catch(console.warn) }, [load]))

  const elapsed = useElapsed(session?.started_at, session?.ended_at)
  const editable = !!session && session.user_id === me?.id

  const groups = useMemo(() => {
    const byOrder = new Map<number, GymSet[]>()
    for (const s of sets) {
      const list = byOrder.get(s.exercise_order) ?? []
      list.push(s)
      byOrder.set(s.exercise_order, list)
    }
    return [...byOrder.entries()].sort((a, b) => a[0] - b[0])
      .map(([order, list]) => ({ order, exerciseId: list[0].exercise_id, sets: list.sort((a, b) => a.set_index - b.set_index) }))
  }, [sets])

  const done = sets.filter(s => s.completed && !s.is_warmup)
  const volume = done.reduce((a, s) => a + setVolume(s), 0)

  const patchSet = (setId: string, patch: Partial<GymSet>) => {
    setSets(prev => prev.map(s => (s.id === setId ? { ...s, ...patch } : s)))
    updateSet(setId, patch).catch(e => Alert.alert('Not saved', (e as Error).message))
  }

  const add = async (group: { order: number; exerciseId: string; sets: GymSet[] }) => {
    if (!session) return
    tap()
    const last = group.sets[group.sets.length - 1]
    const created = await addSet({
      session_id: session.id, user_id: session.user_id, exercise_id: group.exerciseId,
      exercise_order: group.order, set_index: (last?.set_index ?? -1) + 1,
      weight_kg: last?.weight_kg ?? 0, reps: last?.reps ?? 0, rpe: null, is_warmup: false, completed: false,
    })
    setSets(prev => [...prev, created])
  }

  const setMenu = (s: GymSet) => {
    if (!editable) return
    Alert.alert(`Set ${s.set_index + 1}`, undefined, [
      { text: s.is_warmup ? 'Mark as working set' : 'Mark as warm-up', onPress: () => patchSet(s.id, { is_warmup: !s.is_warmup }) },
      {
        text: 'Delete set', style: 'destructive', onPress: () => {
          setSets(prev => prev.filter(x => x.id !== s.id))
          deleteSet(s.id).catch(console.warn)
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const finish = async () => {
    if (!session) return
    if (!sets.length) {
      await deleteSession(session.id)
      return router.back()
    }
    const ended = new Date().toISOString()
    await updateSession(session.id, { ended_at: ended })
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setSession({ ...session, ended_at: ended })
    router.back()
  }

  const remove = () => Alert.alert('Delete session?', 'All sets in this session will be removed.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { if (session) { await deleteSession(session.id); router.back() } } },
  ])

  if (loading) return <Screen><Loading /></Screen>
  if (!session) return <Screen><Text style={type.sub}>Session not found.</Text></Screen>

  return (
    <Screen bottomInset={space.xxxl}>
      <KeyboardAvoidingView behavior="padding">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xs }}>
          <IconButton name="chevron-back" onPress={() => router.back()} />
          <Text style={type.label}>{shortDate(session.started_at)}{session.ended_at ? '' : ' · live'}</Text>
          {editable ? <IconButton name="trash-outline" onPress={remove} /> : <View style={{ width: 40 }} />}
        </View>

        <TextInput
          defaultValue={session.name}
          editable={editable}
          onEndEditing={e => {
            const name = e.nativeEvent.text.trim() || 'Workout'
            setSession({ ...session, name })
            updateSession(session.id, { name }).catch(console.warn)
          }}
          selectionColor={color.text}
          style={[type.display, { paddingVertical: 0, marginTop: space.m, textAlign: 'center' }]}
        />

        <Card style={{ marginTop: space.l, marginBottom: space.l }}>
          <View style={{ alignItems: 'center' }}>
            <Stat value={duration(elapsed)} label={session.ended_at ? 'Duration' : 'Elapsed'} size="l" />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: space.l }}>
            <Stat value={String(done.length)} label="Sets" size="s" />
            <Stat value={num(volume)} unit="kg" label="Volume" size="s" />
            <Stat value={String(groups.length)} label="Exercises" size="s" />
          </View>
        </Card>

        {groups.map(g => {
          const ex = exercises[g.exerciseId]
          const prev = previous[g.exerciseId] ?? []
          const best = Math.max(0, ...g.sets.filter(s => s.completed && !s.is_warmup).map(s => e1rm(Number(s.weight_kg), s.reps)))
          return (
            <Card key={g.order} style={{ marginBottom: space.m }}>
              <Pressable onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: g.exerciseId, userId: session.user_id } })}>
                <Text style={type.bodyStrong}>{ex?.name ?? 'Exercise'}</Text>
                <Text style={type.caption}>
                  {ex ? MUSCLE_LABELS[ex.muscle_group] : ''}
                  {prev.length ? ` · last: ${prev.filter(p => !p.is_warmup).map(p => `${num(Number(p.weight_kg), 1)}×${p.reps}`).join(', ')}` : ''}
                  {best ? ` · e1RM ${Math.round(best)} kg` : ''}
                </Text>
              </Pressable>

              <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.l, marginBottom: space.xs }}>
                <Text style={[type.caption, { width: 28 }]}>SET</Text>
                <Text style={[type.caption, { flex: 1, textAlign: 'center' }]}>WEIGHT</Text>
                <Text style={[type.caption, { flex: 1, textAlign: 'center' }]}>REPS</Text>
                <View style={{ width: 40 }} />
              </View>

              {g.sets.map(s => (
                <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s, opacity: s.completed ? 1 : 0.85 }}>
                  <Pressable onLongPress={() => setMenu(s)} onPress={() => setMenu(s)} style={{ width: 28 }}>
                    <Text style={[type.data, { color: s.is_warmup ? color.textTertiary : color.textSecondary }]}>
                      {s.is_warmup ? 'W' : g.sets.filter(x => !x.is_warmup && x.set_index <= s.set_index).length}
                    </Text>
                  </Pressable>
                  <NumberCell value={Number(s.weight_kg)} decimal suffix="kg" editable={editable} onCommit={v => patchSet(s.id, { weight_kg: v })} />
                  <NumberCell value={s.reps} suffix="" editable={editable} onCommit={v => patchSet(s.id, { reps: v })} />
                  <Pressable
                    disabled={!editable}
                    onPress={() => {
                      if (!s.completed) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                      patchSet(s.id, { completed: !s.completed })
                    }}
                    style={{
                      width: 40, height: 40, borderRadius: radius.s, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: s.completed ? color.text : 'transparent',
                      borderWidth: 1, borderColor: s.completed ? color.text : color.hairlineStrong,
                    }}
                  >
                    <Ionicons name="checkmark" size={20} color={s.completed ? color.bg : color.textTertiary} />
                  </Pressable>
                </View>
              ))}

              {editable ? (
                <Pressable onPress={() => add(g)} style={{ marginTop: space.m, paddingVertical: space.s, alignItems: 'center' }}>
                  <Text style={[type.sub, { color: color.text }]}>+ Add set</Text>
                </Pressable>
              ) : null}
            </Card>
          )
        })}

        {editable ? (
          <>
            <Button
              label="Add exercise" variant="secondary" icon="add"
              onPress={() => router.push({
                pathname: '/exercises',
                params: { sessionId: session.id, order: String((groups[groups.length - 1]?.order ?? -1) + 1) },
              })}
            />
            {!session.ended_at ? (
              <Button label="Finish session" onPress={finish} style={{ marginTop: space.m }} />
            ) : null}
          </>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}

import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { exerciseHistory, ExercisePoint, MUSCLE_LABELS } from '../../lib/gym'
import { num, shortDate } from '../../lib/format'
import { space, type } from '../../lib/theme'
import { Card, Empty, Header, Label, Loading, Row, Screen, Stat } from '../../components/ui'
import { AreaChart, Bars } from '../../components/charts'
import type { Exercise } from '../../lib/types'

export default function ExerciseProgress() {
  const { id, userId } = useLocalSearchParams<{ id: string; userId: string }>()
  const router = useRouter()
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [points, setPoints] = useState<ExercisePoint[] | null>(null)

  useEffect(() => {
    supabase.from('exercises').select('*').eq('id', id).maybeSingle().then(({ data }) => setExercise(data as Exercise | null))
    exerciseHistory(userId, id).then(setPoints).catch(() => setPoints([]))
  }, [id, userId])

  const best = points?.reduce((a, p) => Math.max(a, p.bestE1rm), 0) ?? 0
  const top = points?.reduce((a, p) => Math.max(a, p.topWeight), 0) ?? 0
  const recent = points?.slice(-12) ?? []

  return (
    <Screen bottomInset={space.xxxl}>
      <Header
        eyebrow={exercise ? MUSCLE_LABELS[exercise.muscle_group] : 'Exercise'}
        title={exercise?.name ?? '…'}
        onBack={() => router.back()}
      />
      {!points ? <Loading /> : points.length === 0 ? (
        <Empty title="No completed sets yet" message="Tick sets as done during a session to build history." />
      ) : (
        <>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Stat value={num(best)} unit="kg" label="Best estimated 1RM" size="l" />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: space.xl }}>
              <Stat value={num(top, 1)} unit="kg" label="Heaviest" size="s" />
              <Stat value={String(points.length)} label="Sessions" size="s" />
            </View>
            <View style={{ marginTop: space.xl }}>
              <AreaChart values={recent.map(p => Math.round(p.bestE1rm))} height={130} minSpan={10}
                labels={recent.length > 1 ? [shortDate(recent[0].date), shortDate(recent[recent.length - 1].date)] : undefined} />
            </View>
          </Card>

          <Label>Volume per session</Label>
          <Card><Bars values={recent.map(p => p.volume)} labels={recent.map(p => shortDate(p.date).split(' ')[1])} height={90} /></Card>

          <Label>History</Label>
          <Card>
            {[...points].reverse().slice(0, 20).map((p, i, arr) => (
              <Row key={p.date} label={shortDate(p.date)} sub={`${num(p.volume)} kg volume`}
                value={`${num(p.topWeight, 1)} kg · e1RM ${Math.round(p.bestE1rm)}`} last={i === arr.length - 1} />
            ))}
          </Card>
          <Text style={[type.caption, { marginTop: space.l, textAlign: 'center' }]}>e1RM uses the Epley formula: weight × (1 + reps / 30).</Text>
        </>
      )}
    </Screen>
  )
}

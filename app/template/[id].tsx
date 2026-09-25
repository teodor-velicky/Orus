import { useCallback, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSession } from '../../lib/session'
import {
  deleteTemplate, GymTemplate, getTemplate, lastPerformance, listExercises, MUSCLE_LABELS,
  startFromTemplate, updateTemplate,
} from '../../lib/gym'
import { num } from '../../lib/format'
import type { Exercise } from '../../lib/types'
import { TemplateRow, TemplateView } from '../../components/views/TemplateView'
import { Loading, Screen } from '../../components/ui'

export default function TemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { me } = useSession()
  const [template, setTemplate] = useState<GymTemplate | null>(null)
  const [exercises, setExercises] = useState<Record<string, Exercise>>({})
  const [last, setLast] = useState<Record<string, string>>({})
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    if (!id || !me) return
    const [t, ex] = await Promise.all([getTemplate(id), listExercises()])
    setTemplate(t)
    setExercises(Object.fromEntries(ex.map(e => [e.id, e])))
    if (t) {
      // What each lift looked like last time, so the plan is grounded in real numbers.
      const ids = [...new Set(t.items.map(i => i.exercise_id))]
      const sets = await Promise.all(ids.map(eid => lastPerformance(me.id, eid, '')))
      setLast(Object.fromEntries(ids.map((eid, i) => [
        eid,
        sets[i].filter(s => !s.is_warmup).map(s => `${num(Number(s.weight_kg), 1)}×${s.reps}`).join(', '),
      ])))
    }
  }, [id, me])

  useFocusEffect(useCallback(() => { load().catch(console.warn) }, [load]))
  useEffect(() => { load().catch(console.warn) }, [load])

  if (!template) return <Screen><Loading /></Screen>

  const save = (items: GymTemplate['items'], name = template.name) => {
    setTemplate({ ...template, items, name })
    updateTemplate(template.id, { items, name }).catch(e => Alert.alert('Not saved', (e as Error).message))
  }

  const rows: TemplateRow[] = template.items.map(item => ({
    exerciseId: item.exercise_id,
    name: exercises[item.exercise_id]?.name ?? 'Exercise',
    muscle: exercises[item.exercise_id] ? MUSCLE_LABELS[exercises[item.exercise_id].muscle_group] : '',
    sets: item.sets,
    last: last[item.exercise_id] || null,
  }))

  return (
    <TemplateView
      m={{
        name: template.name,
        rows,
        totalSets: template.items.reduce((a, i) => a + i.sets, 0),
        saving: false,
        starting,
      }}
      h={{
        onBack: () => router.back(),
        onName: name => save(template.items, name.trim() || 'Template'),
        onSets: (index, sets) => save(template.items.map((it, i) => (i === index ? { ...it, sets } : it))),
        onMove: (index, delta) => {
          const items = [...template.items]
          const to = index + delta
          if (to < 0 || to >= items.length) return
          ;[items[index], items[to]] = [items[to], items[index]]
          save(items)
        },
        onRemove: index => save(template.items.filter((_, i) => i !== index)),
        onAddExercise: () => router.push({ pathname: '/exercises', params: { templateId: template.id } }),
        onStart: async () => {
          if (!me || starting) return
          setStarting(true)
          try {
            const session = await startFromTemplate(me.id, template)
            router.replace(`/session/${session.id}`)
          } catch (e) {
            Alert.alert('Could not start', (e as Error).message)
          } finally {
            setStarting(false)
          }
        },
        onDelete: () => Alert.alert('Delete template?', 'Sessions you already did are kept.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => { await deleteTemplate(template.id); router.back() } },
        ]),
      }}
    />
  )
}

import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSession } from '../lib/session'
import { addSet, createExercise, getTemplate, listExercises, updateTemplate } from '../lib/gym'
import type { Exercise, MuscleGroup } from '../lib/types'
import { ExercisePickerView } from '../components/views/ExercisePickerView'

export default function ExercisePicker() {
  // Called from a live session (add an exercise now) or from a template editor.
  const { sessionId, order, templateId } = useLocalSearchParams<{ sessionId?: string; order?: string; templateId?: string }>()
  const router = useRouter()
  const { me } = useSession()
  const [all, setAll] = useState<Exercise[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => { listExercises().then(setAll).catch(console.warn) }, [])

  const pick = async (exercise: Exercise) => {
    if (!me || busyId) return
    setBusyId(exercise.id)
    try {
      if (templateId) {
        const t = await getTemplate(templateId)
        if (t) await updateTemplate(templateId, { items: [...t.items, { exercise_id: exercise.id, sets: 3 }] })
        router.back()
        return
      }
      await addSet({
        session_id: sessionId!, user_id: me.id, exercise_id: exercise.id,
        exercise_order: Number(order) || 0, set_index: 0,
        weight_kg: 0, reps: 0, rpe: null, is_warmup: false, completed: false,
      })
      router.back()
    } catch (e) {
      Alert.alert('Could not add', (e as Error).message)
      setBusyId(null)
    }
  }

  return (
    <ExercisePickerView
      exercises={all}
      busyId={busyId}
      onPick={pick}
      onClose={() => router.back()}
      onCreate={async (name: string, muscle: MuscleGroup) => {
        if (!me) return
        try {
          await pick(await createExercise(me.id, name, muscle, 'other'))
        } catch (e) {
          Alert.alert('Could not create', (e as Error).message)
        }
      }}
    />
  )
}

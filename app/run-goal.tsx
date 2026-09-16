import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useSession } from '../lib/session'
import { deleteGoal, getGoal, runsRange, saveGoal } from '../lib/run/data'
import { currentVdot } from '../lib/run/plan'
import { toPlanRuns } from '../lib/run/training'
import { draftFromSeconds, draftSeconds, goalModel, GoalDraft, raceDateFor, weeksUntil } from '../lib/run/goalModel'
import { RunGoalView } from '../components/views/RunGoalView'
import { Loading, Screen } from '../components/ui'

export default function RunGoal() {
  const router = useRouter()
  const { me } = useSession()
  const [draft, setDraft] = useState<GoalDraft | null>(null)
  const [vdot, setVdot] = useState<number | null>(null)
  const [hasGoal, setHasGoal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!me) return
    Promise.all([getGoal(me.id), runsRange(me.id, 56)]).then(([goal, runs]) => {
      setVdot(currentVdot(toPlanRuns(runs)))
      setHasGoal(!!goal)
      setDraft(goal
        ? draftFromSeconds(String(goal.distance_m), goal.target_s, weeksUntil(goal.race_date))
        : draftFromSeconds('5000', 1200, 12))
    }).catch(e => Alert.alert('Could not load goal', (e as Error).message))
  }, [me])

  if (!draft || !me) return <Screen><Loading /></Screen>

  return (
    <RunGoalView
      m={goalModel(draft, vdot, { hasGoal, saving })}
      h={{
        onClose: () => router.back(),
        onDistance: distance => setDraft(d => d && ({ ...d, distance })),
        onTime: patch => setDraft(d => d && ({ ...d, ...patch })),
        onQuick: seconds => setDraft(d => d && draftFromSeconds(d.distance, seconds, d.weeks)),
        onWeeks: weeks => setDraft(d => d && ({ ...d, weeks })),
        onSave: async () => {
          setSaving(true)
          try {
            await saveGoal({ user_id: me.id, distance_m: Number(draft.distance), target_s: draftSeconds(draft), race_date: raceDateFor(draft.weeks) })
            router.back()
          } catch (e) {
            Alert.alert('Could not save goal', (e as Error).message)
          } finally {
            setSaving(false)
          }
        },
        onRemove: async () => {
          try {
            await deleteGoal(me.id)
            router.back()
          } catch (e) {
            Alert.alert('Could not remove goal', (e as Error).message)
          }
        },
      }}
    />
  )
}

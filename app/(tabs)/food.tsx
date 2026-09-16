import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSession } from '../../lib/session'
import { mealsInRange, photoUrls, plantsThisWeek, summarize } from '../../lib/meals'
import { loadSystemScores } from '../../lib/systems'
import { macroTargets } from '../../lib/targets'
import { addDays, fromIso, lastNDates, localIso } from '../../lib/format'
import { runsRange } from '../../lib/run/data'
import { runEnergy } from '../../lib/run/training'
import type { MealLog, Pattern, Run, SystemScore } from '../../lib/types'
import { FoodView } from '../../components/views/FoodView'

export default function Food() {
  const router = useRouter()
  const { viewing, isMe } = useSession()
  const [date, setDate] = useState(localIso())
  const [weekMeals, setWeekMeals] = useState<MealLog[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [weekPlants, setWeekPlants] = useState<string[]>([])
  const [systems, setSystems] = useState<{ scores: SystemScore[]; patterns: Pattern[] } | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (force = false) => {
    if (!viewing) return
    const all = await mealsInRange(viewing.id, localIso(addDays(new Date(), -6)), localIso())
    const selected = date >= localIso(addDays(new Date(), -6))
      ? all
      : await mealsInRange(viewing.id, date, date)
    setWeekMeals(selected)
    const withPhotos = selected.filter(x => x.photo_paths.length)
    photoUrls(withPhotos.map(x => x.photo_paths[0])).then(urls => {
      const map: Record<string, string> = {}
      withPhotos.forEach((x, i) => { if (urls[i]) map[x.id] = urls[i] })
      setThumbs(map)
    }).catch(() => {})
    plantsThisWeek(viewing.id).then(setWeekPlants).catch(() => {})
    const back = Math.ceil((Date.now() - fromIso(date).getTime()) / 86400_000) + 1
    runsRange(viewing.id, Math.max(2, back)).then(setRuns).catch(() => {})
    loadSystemScores(viewing.id, force).then(setSystems).catch(e => console.warn('system scores', e))
  }, [viewing, date])

  useFocusEffect(useCallback(() => { load().catch(console.warn) }, [load]))

  const dayMeals = weekMeals.filter(x => localIso(new Date(x.logged_at)) === date)
  const base = macroTargets(viewing)
  // Part of the day's running calories goes back into the target, as carbs.
  const runBonus = runEnergy(runs, date, viewing).bonus

  return (
    <FoodView
      m={{
        date,
        eyebrow: fromIso(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        isMe,
        sex: viewing?.sex,
        week: lastNDates(7).map(d => ({
          date: d,
          score: summarize(weekMeals.filter(x => localIso(new Date(x.logged_at)) === d)).quality,
        })),
        summary: summarize(dayMeals),
        targets: { ...base, kcal: base.kcal + runBonus, carbs: base.carbs + Math.round(runBonus / 4) },
        runBonus,
        meals: dayMeals,
        thumbs,
        weekPlants,
        systems,
      }}
      h={{
        onSelectDate: setDate,
        refreshing,
        onRefresh: async () => { setRefreshing(true); await load(true).catch(console.warn); setRefreshing(false) },
        onLogMeal: () => router.push('/log-meal'),
        onOpenMeal: id => router.push(`/meal/${id}`),
        onOpenSystem: id => router.push({ pathname: '/system/[id]', params: { id, userId: viewing?.id ?? '' } }),
      }}
    />
  )
}

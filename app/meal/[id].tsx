import { useEffect, useState } from 'react'
import { Alert, Image, ScrollView, Text, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSession } from '../../lib/session'
import { deleteMeal, getMeal, photoUrls } from '../../lib/meals'
import { clock, prettyDate, localIso } from '../../lib/format'
import { radius, space, type } from '../../lib/theme'
import { Button, Header, Loading, Screen } from '../../components/ui'
import { MealAnalysisView } from '../../components/MealAnalysisView'
import type { MealLog } from '../../lib/types'

export default function MealDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { me, people } = useSession()
  const { width } = useWindowDimensions()
  const [meal, setMeal] = useState<MealLog | null>(null)
  const [urls, setUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMeal(id).then(async m => {
      setMeal(m)
      if (m) setUrls(await photoUrls(m.photo_paths))
    }).finally(() => setLoading(false))
  }, [id])

  if (loading) return <Screen><Loading /></Screen>
  if (!meal) return <Screen><Header title="Meal not found" onBack={() => router.back()} /></Screen>

  const owner = people.find(p => p.id === meal.user_id)
  const mine = meal.user_id === me?.id
  const sex = owner?.sex ?? me?.sex

  const remove = () => Alert.alert('Delete meal?', 'This removes it from your nutrition history.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteMeal(meal); router.back() } catch (e) { Alert.alert('Could not delete', (e as Error).message) }
      },
    },
  ])

  const photoW = width - space.screen * 2
  return (
    <Screen bottomInset={space.xxxl}>
      <Header
        eyebrow={`${prettyDate(localIso(new Date(meal.logged_at)))} · ${clock(meal.logged_at)}`}
        title={meal.title}
        onBack={() => router.back()}
      />
      {urls.length ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginBottom: space.l, borderRadius: radius.l }}>
          {urls.map(u => (
            <Image key={u} source={{ uri: u }} style={{ width: photoW, aspectRatio: 4 / 3, borderRadius: radius.l }} />
          ))}
        </ScrollView>
      ) : null}
      {meal.note ? <Text style={[type.sub, { marginBottom: space.l }]}>“{meal.note}”</Text> : null}
      <MealAnalysisView analysis={meal.analysis} sex={sex} />
      {mine ? <Button label="Delete meal" variant="ghost" onPress={remove} style={{ marginTop: space.xl }} /> : null}
    </Screen>
  )
}

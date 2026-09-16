// Log a meal: photos (camera or library) and/or a description → one
// whole-meal analysis → review → save. Ported from Somata's log flow, with
// an explicit review step so a bad estimate never lands silently.
import { useState } from 'react'
import { Alert, Image } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { useSession } from '../lib/session'
import { analyzeMeal, mealTypeForNow, photoToBase64, saveMeal } from '../lib/meals'
import { radius, space } from '../lib/theme'
import { Button, Header, Screen, tap } from '../components/ui'
import { MealAnalysisView } from '../components/MealAnalysisView'
import { LogMealView } from '../components/views/LogMealView'
import type { MealAnalysis, MealType } from '../lib/types'

export default function LogMeal() {
  const router = useRouter()
  const { me } = useSession()
  const [mealType, setMealType] = useState<MealType>(mealTypeForNow())
  const [photos, setPhotos] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [yesterday, setYesterday] = useState(false)
  const [busy, setBusy] = useState<'analyzing' | 'saving' | null>(null)
  const [result, setResult] = useState<{ analysis: MealAnalysis; base64: string[] } | null>(null)

  const addPhoto = async (camera: boolean) => {
    if (photos.length >= 4) return Alert.alert('Four photos max', 'Different angles of the same meal work best.')
    const perm = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return
    const res = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: true, selectionLimit: 4 - photos.length })
    if (res.canceled) return
    tap()
    setPhotos(p => [...p, ...res.assets.map(a => a.uri)].slice(0, 4))
  }

  const analyze = async () => {
    setBusy('analyzing')
    try {
      const base64 = await Promise.all(photos.map(photoToBase64))
      const analysis = await analyzeMeal(base64, description)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      setResult({ analysis, base64 })
    } catch (e) {
      Alert.alert('Analysis failed', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!me || !result) return
    setBusy('saving')
    try {
      const loggedAt = new Date()
      if (yesterday) {
        loggedAt.setDate(loggedAt.getDate() - 1)
        loggedAt.setHours({ breakfast: 8, lunch: 13, snack: 16, dinner: 19 }[mealType], 0, 0, 0)
      }
      await saveMeal({ userId: me.id, mealType, analysis: result.analysis, photosBase64: result.base64, note: description, loggedAt })
      router.back()
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message)
      setBusy(null)
    }
  }

  if (result) {
    return (
      <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
        <Header eyebrow="Review" title={result.analysis.foodName} onBack={() => setResult(null)} />
        {photos[0] ? (
          <Image source={{ uri: photos[0] }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.l, marginBottom: space.m }} />
        ) : null}
        <MealAnalysisView analysis={result.analysis} sex={me?.sex} />
        <Button label="Save meal" icon="checkmark" onPress={save} loading={busy === 'saving'} style={{ marginTop: space.xl }} />
        <Button label="Discard" variant="ghost" onPress={() => setResult(null)} style={{ marginTop: space.s }} />
      </Screen>
    )
  }

  return (
    <LogMealView
      m={{ mealType, yesterday, photos, description, analyzing: busy === 'analyzing' }}
      h={{
        onClose: () => router.back(),
        onMealType: setMealType,
        onToggleYesterday: () => setYesterday(y => !y),
        onCamera: () => addPhoto(true),
        onLibrary: () => addPhoto(false),
        onRemovePhoto: i => setPhotos(p => p.filter((_, j) => j !== i)),
        onDescription: setDescription,
        onAnalyze: analyze,
      }}
    />
  )
}

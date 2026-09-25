import { useEffect } from 'react'
import { AppState, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import {
  useFonts, Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold,
} from '@expo-google-fonts/geist'
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono'
import { SessionProvider, useSession } from '../lib/session'
import { syncHealthIfStale } from '../lib/health'
import { initRing } from '../lib/ring/service'
import { registerRingSync } from '../lib/ring/background'
import { configureSharing } from '../lib/ring/share'
// Registers the background GPS task at startup so iOS can deliver locations mid-run.
import '../lib/run/recorder'
import { color } from '../lib/theme'

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold,
    GeistMono_400Regular, GeistMono_500Medium,
  })
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: color.bg }} />
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  )
}

function Gate() {
  const { loading, session, me } = useSession()
  const segments = useSegments()
  const router = useRouter()

  // Route by auth + onboarding state.
  useEffect(() => {
    if (loading) return
    const top = segments[0] as string | undefined
    // Dev-only design preview with sample data — no auth needed.
    if (__DEV__ && top === 'preview') return
    if (!session) {
      if (top !== 'sign-in') router.replace('/sign-in')
    } else if (me && !me.onboarded) {
      if (top !== 'onboarding') router.replace('/onboarding')
    } else if (me && (top === 'sign-in' || top === 'onboarding' || top === undefined)) {
      router.replace('/today')
    }
  }, [loading, session, me, segments, router])

  // Ring: reconnect to the paired ring and route live vitals to the circle.
  useEffect(() => {
    if (!session?.user.id) return
    initRing().catch(e => console.warn('ring init', e))
    // Lets iOS wake Orus to sync the ring while the app is closed.
    registerRingSync().catch(e => console.warn('ring background', e))
  }, [session?.user.id])
  useEffect(() => {
    configureSharing(me?.circle_id ?? null, me?.id ?? null)
  }, [me?.circle_id, me?.id])

  // Pull fresh Apple Health data on launch and whenever the app returns.
  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    syncHealthIfStale(userId).catch(e => console.warn('health sync', e))
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') syncHealthIfStale(userId).catch(e => console.warn('health sync', e))
    })
    return () => sub.remove()
  }, [session?.user.id])

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="add" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.44], sheetGrabberVisible: true, contentStyle: { backgroundColor: color.surface } }} />
      <Stack.Screen name="log-meal" options={{ presentation: 'modal' }} />
      <Stack.Screen name="symptoms" options={{ presentation: 'modal' }} />
      <Stack.Screen name="exercises" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="run/record" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      <Stack.Screen name="run-goal" options={{ presentation: 'modal' }} />
    </Stack>
  )
}

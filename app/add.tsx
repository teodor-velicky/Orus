import { useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSession } from '../lib/session'
import { activeSession, startSession } from '../lib/gym'
import { color, radius, space, type } from '../lib/theme'
import { tap } from '../components/ui'

function sessionNameForNow(): string {
  const h = new Date().getHours()
  return h < 11 ? 'Morning session' : h < 17 ? 'Afternoon session' : 'Evening session'
}

export default function Add() {
  const router = useRouter()
  const { me } = useSession()
  const [busy, setBusy] = useState(false)

  const workout = async () => {
    if (!me || busy) return
    setBusy(true)
    try {
      const session = (await activeSession(me.id)) ?? (await startSession(me.id, sessionNameForNow()))
      router.dismiss()
      router.push(`/session/${session.id}`)
    } catch (e) {
      Alert.alert('Could not start', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const actions: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void }[] = [
    { icon: 'camera-outline', title: 'Log a meal', sub: 'Photo or description', onPress: () => { router.dismiss(); router.push('/log-meal') } },
    { icon: 'navigate-outline', title: 'Record a run', sub: 'GPS + ring heart rate', onPress: () => { router.dismiss(); router.push('/run/record') } },
    { icon: 'barbell-outline', title: 'Gym session', sub: 'Sets, reps, weight', onPress: workout },
    { icon: 'pulse-outline', title: 'How do you feel', sub: 'Gut & energy check-in', onPress: () => { router.dismiss(); router.push('/symptoms') } },
  ]

  return (
    <View style={{ flex: 1, padding: space.screen, paddingTop: space.xl, gap: space.s, backgroundColor: color.surface }}>
      {actions.map(a => (
        <Pressable
          key={a.title}
          onPress={() => { tap(); a.onPress() }}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: space.l,
            padding: space.l, borderRadius: radius.m,
            backgroundColor: pressed ? color.surfaceRaised : 'transparent',
          })}
        >
          <View style={{
            width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: color.hairlineStrong,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name={a.icon} size={20} color={color.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.bodyStrong}>{a.title}</Text>
            <Text style={type.caption}>{a.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={color.textTertiary} />
        </Pressable>
      ))}
    </View>
  )
}

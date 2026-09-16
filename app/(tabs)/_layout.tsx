import { Platform, Pressable, Text, View } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { color, font, radius, space } from '../../lib/theme'
import { tap } from '../../components/ui'

type IconName = keyof typeof Ionicons.glyphMap

const TABS: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  today: { label: 'Today', icon: 'sunny-outline', iconActive: 'sunny' },
  food: { label: 'Food', icon: 'leaf-outline', iconActive: 'leaf' },
  train: { label: 'Train', icon: 'barbell-outline', iconActive: 'barbell' },
  together: { label: 'Us', icon: 'people-outline', iconActive: 'people' },
}

interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] }
  navigation: { navigate: (name: string) => void; emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean } }
}

function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const item = (route: { key: string; name: string }, index: number) => {
    const meta = TABS[route.name]
    if (!meta) return null
    const focused = state.index === index
    return (
      <Pressable
        key={route.key}
        onPress={() => {
          const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !e.defaultPrevented) { tap(); navigation.navigate(route.name) }
        }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, height: '100%' }}
      >
        <Ionicons name={focused ? meta.iconActive : meta.icon} size={19} color={focused ? color.text : color.textTertiary} />
        <Text style={{ fontSize: 9.5, fontFamily: font.medium, letterSpacing: 0.2, color: focused ? color.text : color.textTertiary }}>
          {meta.label}
        </Text>
        <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 1, backgroundColor: focused ? color.text : 'transparent' }} />
      </Pressable>
    )
  }

  return (
    <View style={{
      position: 'absolute', left: space.xl, right: space.xl, bottom: Math.max(insets.bottom - 6, space.m),
      height: 68, borderRadius: radius.pill, overflow: 'hidden',
      borderWidth: 1, borderColor: color.hairlineStrong,
      shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 30, shadowOffset: { width: 0, height: 12 },
    }}>
      <BlurView intensity={Platform.OS === 'ios' ? 40 : 0} tint="dark" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Platform.OS === 'ios' ? 'rgba(12,12,14,0.72)' : 'rgba(16,16,18,0.97)' }} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s }}>
        {state.routes.slice(0, 2).map((r, i) => item(r, i))}
        <Pressable
          onPress={() => { tap(); router.push('/add') }}
          style={({ pressed }) => ({
            width: 50, height: 50, borderRadius: 25, marginHorizontal: space.s,
            backgroundColor: color.action, alignItems: 'center', justifyContent: 'center',
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          <Ionicons name="add" size={26} color={color.onAction} />
        </Pressable>
        {state.routes.slice(2).map((r, i) => item(r, i + 2))}
      </View>
    </View>
  )
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
      tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} />}
    >
      <Tabs.Screen name="today" />
      <Tabs.Screen name="food" />
      <Tabs.Screen name="train" />
      <Tabs.Screen name="together" />
    </Tabs>
  )
}

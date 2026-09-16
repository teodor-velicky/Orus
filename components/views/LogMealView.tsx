// Log meal — compose + analyzing states (presentational).
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import type { MealType } from '../../lib/types'
import { Button, Card, Chip, Header, Label, Screen, Segmented, tap } from '../ui'
import { Logo } from '../Logo'

export interface LogMealModel {
  mealType: MealType
  yesterday: boolean
  photos: string[]
  description: string
  analyzing: boolean
}

export interface LogMealHandlers {
  onClose: () => void
  onMealType: (t: MealType) => void
  onToggleYesterday: () => void
  onCamera: () => void
  onLibrary: () => void
  onRemovePhoto: (index: number) => void
  onDescription: (t: string) => void
  onAnalyze: () => void
}

const HINTS = ['cooked in olive oil', 'restaurant portion', 'half portion', 'with sauce', 'extra cheese', 'oat milk']
const STEPS = ['Identifying foods', 'Estimating portions', 'Scoring food quality', 'Computing 25 micronutrients', 'Checking gut & metabolic load']

function Analyzing() {
  const spin = useRef(new Animated.Value(0)).current
  const [step, setStep] = useState(0)
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    const t = setInterval(() => setStep(s => (s + 1) % STEPS.length), 1800)
    return () => { loop.stop(); clearInterval(t) }
  }, [spin])
  return (
    <Card style={{ marginTop: space.xl }}>
      <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
          <Logo size={88} />
        </Animated.View>
        <Text style={[type.title, { marginTop: space.xl }]}>Analyzing your meal</Text>
        <Text style={[type.unit, { marginTop: space.s }]}>{STEPS[step].toUpperCase()}…</Text>
        <View style={{ flexDirection: 'row', gap: 5, marginTop: space.l }}>
          {STEPS.map((_, i) => (
            <View key={i} style={{ width: i === step ? 16 : 5, height: 5, borderRadius: 3, backgroundColor: i <= step ? color.text : color.textFaint }} />
          ))}
        </View>
      </View>
    </Card>
  )
}

export function LogMealView({ m, h }: { m: LogMealModel; h: LogMealHandlers }) {
  const canAnalyze = m.photos.length > 0 || m.description.trim().length >= 3
  const addHint = (hint: string) => {
    tap()
    const d = m.description.trim()
    h.onDescription(d ? `${d}, ${hint}` : hint)
  }

  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <KeyboardAvoidingView behavior="padding">
        <Header eyebrow={m.yesterday ? 'Yesterday' : 'New meal'} title="What did you eat?" onBack={h.onClose} />

        <Segmented
          options={[{ value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }, { value: 'snack', label: 'Snack' }]}
          value={m.mealType} onChange={h.onMealType}
        />
        <View style={{ alignItems: 'center', marginTop: space.m }}>
          <Chip label={m.yesterday ? 'Logging for yesterday' : 'Log for yesterday'} icon="calendar-outline" active={m.yesterday} onPress={h.onToggleYesterday} />
        </View>

        {m.analyzing ? <Analyzing /> : (
          <>
            {/* CAPTURE */}
            <Label>Photo</Label>
            <Card>
              {m.photos.length === 0 ? (
                <View style={{ alignItems: 'center' }}>
                  <View style={{
                    alignSelf: 'stretch', height: 150, borderRadius: radius.m, borderWidth: 1.5, borderStyle: 'dashed',
                    borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(0.015),
                  }}>
                    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="scan-outline" size={26} color={color.text} />
                    </View>
                    <Text style={[type.title, { marginTop: space.m }]}>Snap your plate</Text>
                    <Text style={[type.caption, { marginTop: 2 }]}>Up to 4 angles of the same meal</Text>
                  </View>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingTop: 6, paddingRight: 6 }}>
                  {m.photos.map((uri, i) => (
                    <View key={uri}>
                      <Image source={{ uri }} style={{ width: 120, height: 150, borderRadius: radius.m, backgroundColor: color.inset }} />
                      <Pressable onPress={() => h.onRemovePhoto(i)} hitSlop={8}
                        style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="close" size={14} color={color.bg} />
                      </Pressable>
                    </View>
                  ))}
                  {m.photos.length < 4 ? (
                    <Pressable onPress={h.onCamera}
                      style={{ width: 90, height: 150, borderRadius: radius.m, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="add" size={24} color={color.textSecondary} />
                      <Text style={[type.unit, { marginTop: 4 }]}>ANGLE</Text>
                    </Pressable>
                  ) : null}
                </ScrollView>
              )}
              <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.l }}>
                <Button label="Camera" icon="camera-outline" onPress={h.onCamera} style={{ flex: 1 }} />
                <Button label="Library" icon="images-outline" variant="secondary" onPress={h.onLibrary} style={{ flex: 1 }} />
              </View>
            </Card>

            {/* DESCRIBE */}
            <Label>{m.photos.length ? 'Add context' : 'Or describe it'}</Label>
            <Card>
              <TextInput
                value={m.description}
                onChangeText={t => h.onDescription(t.slice(0, 1200))}
                placeholder={m.photos.length ? 'Oils, sauces, portion size…' : '3 scrambled eggs, 2 slices sourdough, half an avocado'}
                placeholderTextColor={color.textFaint}
                selectionColor={color.text}
                multiline
                style={{
                  minHeight: 96, color: color.text, fontSize: 15, lineHeight: 22, fontFamily: font.regular, textAlignVertical: 'top',
                  borderRadius: radius.m, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline, padding: space.m + 2,
                }}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: space.m }}>
                {HINTS.map(hint => <Chip key={hint} label={`+ ${hint}`} onPress={() => addHint(hint)} />)}
              </View>
              <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
                Oils, sauces and portions make the micronutrient estimate noticeably better.
              </Text>
            </Card>

            <Button label="Analyze meal" icon="sparkles-outline" onPress={h.onAnalyze} disabled={!canAnalyze} style={{ marginTop: space.xl }} />
            <Text style={[type.unit, { textAlign: 'center', marginTop: space.m, color: color.textFaint }]}>
              YOU REVIEW EVERYTHING BEFORE IT'S SAVED
            </Text>
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  )
}

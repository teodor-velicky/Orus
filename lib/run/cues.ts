// Spoken + haptic cues during a run. Voice can be muted; haptics always fire.

import * as Speech from 'expo-speech'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'

const MUTE_KEY = 'orus.run.voiceMuted'
let muted = false
AsyncStorage.getItem(MUTE_KEY).then(v => { muted = v === '1' }).catch(() => {})

export const isVoiceMuted = () => muted

export function setVoiceMuted(on: boolean) {
  muted = on
  if (on) Speech.stop()
  AsyncStorage.setItem(MUTE_KEY, on ? '1' : '0').catch(() => {})
}

export type CueStrength = 'step' | 'warn' | 'info'

export function cue(text: string, strength: CueStrength = 'info') {
  if (strength === 'step') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  else if (strength === 'warn') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  if (muted) return
  try {
    // Step changes interrupt whatever is being said; pace nags never do.
    if (strength === 'step') Speech.stop()
    Speech.speak(text, { rate: 1.02, pitch: 1 })
  } catch { /* speech unavailable */ }
}

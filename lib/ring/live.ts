// Live ring state for the UI. Tiny external store + useSyncExternalStore hook.

import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type RingStatus = 'unavailable' | 'unpaired' | 'scanning' | 'connecting' | 'connected' | 'disconnected'

export interface Reading { value: number; at: number }

export interface RingLiveState {
  status: RingStatus
  device: { id: string; name: string } | null
  battery: { pct: number; charging: boolean } | null
  live: boolean
  sharing: boolean
  syncing: boolean
  hr: Reading | null
  hrv: Reading | null
  spo2: Reading | null
  skinTemp: Reading | null
  /** Recent heart rate samples (for the live chart), newest last. */
  hrTrail: number[]
  /** Recent per-second motion (ENMO, g), newest last. */
  motionTrail: number[]
  lastUploadAt: number | null
  error: string | null
  /** Diagnostics: last packets in and out, newest last ("hh:mm:ss < uart 01 02 …"). */
  log: string[]
}

let state: RingLiveState = {
  status: 'unavailable', device: null, battery: null, live: false, sharing: false, syncing: false,
  hr: null, hrv: null, spo2: null, skinTemp: null, hrTrail: [], motionTrail: [],
  lastUploadAt: null, error: null, log: [],
}

const listeners = new Set<() => void>()

export function getRing(): RingLiveState {
  return state
}

export function patchRing(patch: Partial<RingLiveState>): void {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
  if ('hr' in patch || 'hrv' in patch || 'spo2' in patch || 'skinTemp' in patch || 'battery' in patch) saveReadings()
}

// ─── Last known readings ───
//
// Opening the app after a while used to show blanks until the ring connected
// and measured again. The last readings are kept on the phone and restored at
// launch; every one carries its timestamp, so the UI can show its age.

const READINGS_KEY = 'orus.ring.lastReadings'
let saveTimer: ReturnType<typeof setTimeout> | null = null

function saveReadings() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const { hr, hrv, spo2, skinTemp, battery } = state
    AsyncStorage.setItem(READINGS_KEY, JSON.stringify({ hr, hrv, spo2, skinTemp, battery })).catch(() => {})
  }, 5000)
}

/** Restore the last readings at launch. Never overwrites something fresher. */
export async function hydrateRing(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(READINGS_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as Partial<Pick<RingLiveState, 'hr' | 'hrv' | 'spo2' | 'skinTemp' | 'battery'>>
    state = {
      ...state,
      hr: state.hr ?? saved.hr ?? null,
      hrv: state.hrv ?? saved.hrv ?? null,
      spo2: state.spo2 ?? saved.spo2 ?? null,
      skinTemp: state.skinTemp ?? saved.skinTemp ?? null,
      battery: state.battery ?? saved.battery ?? null,
    }
    listeners.forEach(l => l())
  } catch { /* nothing stored yet */ }
}

export function pushTrail(key: 'hrTrail' | 'motionTrail', values: number[], max = 120): void {
  patchRing({ [key]: [...state[key], ...values].slice(-max) } as Partial<RingLiveState>)
}

const LOG_MAX = 120

/** Record a raw packet for the diagnostics panel. */
export function logPacket(direction: '<' | '>', channel: string, bytes: Uint8Array, note = ''): void {
  const t = new Date()
  const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join(' ')
  patchRing({ log: [...state.log, `${hh} ${direction} ${channel} ${hex}${note ? ` ${note}` : ''}`].slice(-LOG_MAX) })
}

export function clearLog(): void {
  patchRing({ log: [] })
}

export function subscribeRing(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useRing(): RingLiveState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
  )
}

/** A reading is "fresh" for the live UI for this long. */
export const isFresh = (r: Reading | null, ms = 30_000) => !!r && Date.now() - r.at < ms

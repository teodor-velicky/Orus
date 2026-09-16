// Live ring state for the UI. Tiny external store + useSyncExternalStore hook.

import { useSyncExternalStore } from 'react'

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
}

let state: RingLiveState = {
  status: 'unavailable', device: null, battery: null, live: false, sharing: false, syncing: false,
  hr: null, hrv: null, spo2: null, skinTemp: null, hrTrail: [], motionTrail: [],
  lastUploadAt: null, error: null,
}

const listeners = new Set<() => void>()

export function getRing(): RingLiveState {
  return state
}

export function patchRing(patch: Partial<RingLiveState>): void {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

export function pushTrail(key: 'hrTrail' | 'motionTrail', values: number[], max = 120): void {
  patchRing({ [key]: [...state[key], ...values].slice(-max) } as Partial<RingLiveState>)
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

// Live run recorder: phone GPS + ring heart rate.
//
// Location keeps flowing with the screen locked via a background location
// task (needs the sideloaded build). In Expo Go, background location isn't
// available, so it falls back to foreground-only updates — keep the screen on.
//
// State lives in a tiny external store (like the ring) and is persisted every
// few seconds, so a crash or an iOS kill never loses a run.

import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { getRing, isFresh, subscribeRing } from '../ring/live'
import { startLive, stopLive } from '../ring/service'
import { GeoPoint, haversine, HrSample } from './geo'
import { cue } from './cues'
import { advance, initialStep, paceCue, paceStatus, progress, stepCue, StepState, Workout } from './workout'

export const LOCATION_TASK = 'orus-run-location'
const STORE_KEY = 'orus.run.recording'

export type RecorderStatus = 'idle' | 'acquiring' | 'running' | 'paused'

export interface RecorderState {
  status: RecorderStatus
  startedAt: number | null
  pausedMs: number
  pauseStartedAt: number | null
  seg: number
  points: GeoPoint[]
  hr: HrSample[]
  distanceM: number
  /** Elapsed active seconds at each completed km. */
  kmMarks: number[]
  lastFix: GeoPoint | null
  accuracy: number | null
  permission: 'unknown' | 'granted' | 'denied'
  background: boolean
  ringLive: boolean
  error: string | null
  /** Guided session from the plan; null = free run. */
  workout: Workout | null
  step: StepState
}

const initial: RecorderState = {
  status: 'idle', startedAt: null, pausedMs: 0, pauseStartedAt: null, seg: 0, points: [], hr: [],
  distanceM: 0, kmMarks: [], lastFix: null, accuracy: null, permission: 'unknown', background: false,
  ringLive: false, error: null, workout: null, step: initialStep(),
}

let state: RecorderState = initial
const listeners = new Set<() => void>()

function patch(p: Partial<RecorderState>) {
  state = { ...state, ...p }
  listeners.forEach(l => l())
  schedulePersist()
}

export const getRecorder = () => state

export function useRecorder(): RecorderState {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
  )
}

export function activeSeconds(s: RecorderState, now = Date.now()): number {
  if (!s.startedAt) return 0
  const pausedNow = s.pauseStartedAt ? now - s.pauseStartedAt : 0
  return Math.max(0, Math.round((now - s.startedAt - s.pausedMs - pausedNow) / 1000))
}

/** Pace over the last ~30 s of movement (s/km), or null when standing. */
export function currentPace(s: RecorderState, windowS = 30): number | null {
  const pts = s.points
  if (pts.length < 2 || s.status !== 'running') return null
  const last = pts[pts.length - 1]
  if (Date.now() - last.t > 15_000) return null
  let d = 0
  let i = pts.length - 1
  while (i > 0 && last.t - pts[i - 1].t <= windowS * 1000 && pts[i - 1].seg === last.seg) {
    d += haversine(pts[i - 1], pts[i])
    i--
  }
  const dt = (last.t - pts[i].t) / 1000
  if (dt < 8 || d < 15) return null
  return Math.round(dt / (d / 1000))
}

// ─── Location intake ───

const MAX_ACCURACY = 35

function onLocations(locations: Location.LocationObject[]) {
  for (const loc of locations) {
    const p: GeoPoint = {
      t: loc.timestamp, lat: loc.coords.latitude, lng: loc.coords.longitude,
      alt: loc.coords.altitude, acc: loc.coords.accuracy, seg: state.seg,
    }
    const upd: Partial<RecorderState> = { lastFix: p, accuracy: p.acc ?? null }
    if (state.status === 'running' && (p.acc == null || p.acc <= MAX_ACCURACY)) {
      const prev = state.points[state.points.length - 1]
      let add = 0
      if (prev && prev.seg === p.seg) {
        const dt = (p.t - prev.t) / 1000
        if (dt <= 0) { patch(upd); continue }
        add = haversine(prev, p)
        if (add / dt > 9) { patch(upd); continue } // GPS jump
      }
      const distanceM = state.distanceM + add
      const kmMarks = [...state.kmMarks]
      if (Math.floor(distanceM / 1000) > kmMarks.length) kmMarks.push(activeSeconds(state, p.t))
      Object.assign(upd, { points: [...state.points, p], distanceM, kmMarks })
    }
    patch(upd)
    stepTick()
  }
}

try {
  if (Platform.OS !== 'web') {
    TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
      if (error) { patch({ error: error.message }); return }
      if (data?.locations?.length) onLocations(data.locations)
    })
  }
} catch (e) {
  console.warn('location task unavailable', e)
}

let watcher: Location.LocationSubscription | null = null

async function startLocation(): Promise<void> {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') {
    patch({ permission: 'denied', error: 'Location permission is needed to record GPS runs.' })
    throw new Error('Location permission denied')
  }
  patch({ permission: 'granted', error: null })
  if (Platform.OS === 'web') {
    watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000 }, l => onLocations([l]))
    return
  }
  try {
    const bg = await Location.requestBackgroundPermissionsAsync()
    if (bg.status !== 'granted') throw new Error('no background permission')
    if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        activityType: Location.ActivityType.Fitness,
        distanceInterval: 3,
        timeInterval: 1000,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      })
    }
    patch({ background: true })
  } catch {
    // Expo Go / "While using" permission: foreground updates only.
    if (!watcher) {
      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 1000 },
        l => onLocations([l]),
      )
    }
    patch({ background: false })
  }
}

async function stopLocation(): Promise<void> {
  watcher?.remove()
  watcher = null
  if (Platform.OS !== 'web') {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
    } catch { /* not started */ }
  }
}

// ─── Ring heart rate ───

let unsubRing: (() => void) | null = null

function startHr() {
  const ring = getRing()
  if (ring.device && ring.status === 'connected') {
    startLive('workout').then(() => patch({ ringLive: true })).catch(() => {})
  }
  unsubRing?.()
  unsubRing = subscribeRing(() => {
    const r = getRing()
    if (state.status !== 'running' || !r.hr || !isFresh(r.hr, 10_000)) return
    const last = state.hr[state.hr.length - 1]
    if (last && r.hr.at <= last.t) return
    patch({ hr: [...state.hr, { t: r.hr.at, bpm: r.hr.value }] })
  })
}

function stopHr() {
  unsubRing?.()
  unsubRing = null
  if (state.ringLive) stopLive()
}

// ─── Controls ───

/** Start GPS so accuracy is visible before the run starts. */
export async function acquire(): Promise<void> {
  if (state.status !== 'idle') return
  patch({ status: 'acquiring' })
  try {
    await startLocation()
  } catch {
    patch({ status: 'idle' })
  }
}

/** Start recording. Pass a workout to be guided step by step, or nothing for a free run. */
export async function start(workout: Workout | null = null): Promise<void> {
  if (state.status === 'idle') await acquire()
  if (state.status !== 'acquiring') return
  patch({
    status: 'running', startedAt: Date.now(), pausedMs: 0, pauseStartedAt: null, seg: 0, points: [], hr: [], distanceM: 0, kmMarks: [],
    workout, step: initialStep(),
  })
  startHr()
  startTicker()
  if (workout?.steps[0]) cue(stepCue(workout.steps[0]), 'step')
}

// ─── Workout guidance ───

let ticker: ReturnType<typeof setInterval> | null = null
let lastPaceAlert = 0
let countdownDone = -1

function startTicker() {
  if (ticker) return
  ticker = setInterval(stepTick, 1000)
}

function stopTicker() {
  if (ticker) clearInterval(ticker)
  ticker = null
}

/** Advance through steps and call out pace. Runs every second and on each GPS fix. */
function stepTick() {
  const w = state.workout
  if (!w || state.status !== 'running' || state.step.complete) return
  const act = activeSeconds(state)
  const next = advance(w, state.step, state.distanceM, act)
  if (next !== state.step) {
    patch({ step: next })
    lastPaceAlert = Date.now() // give the new step a moment before nagging
    if (next.complete) cue('Workout complete. Great work. Keep jogging easy or finish the run.', 'step')
    else cue(stepCue(w.steps[next.index]), 'step')
    return
  }
  const pr = progress(w, state.step, state.distanceM, act)
  const step = pr.step
  if (!step) return

  // Countdown before the step ends: 10 s for timed steps, 100 m for distance reps.
  if (countdownDone !== state.step.index && pr.remaining != null && (step.kind === 'work' || step.kind === 'recovery')) {
    if (pr.unit === 's' && pr.remaining <= 10 && step.durationS! > 20) { countdownDone = state.step.index; cue('10 seconds', 'info') }
    if (pr.unit === 'm' && pr.remaining <= 100 && step.distanceM! >= 400) { countdownDone = state.step.index; cue('100 metres to go', 'info') }
  }

  const status = paceStatus(step, currentPace(state, 20), pr.doneS)
  if ((status === 'fast' || status === 'slow') && Date.now() - lastPaceAlert > 30_000) {
    lastPaceAlert = Date.now()
    const text = paceCue(status, step)
    if (text) cue(text, 'warn')
  }
}

/** Skip / lap button: end the current step now. */
export function skipStep(): void {
  const w = state.workout
  if (!w || state.step.complete) return
  const next = advance(w, state.step, state.distanceM, activeSeconds(state), true)
  patch({ step: next })
  lastPaceAlert = Date.now()
  cue(next.complete ? 'Workout complete.' : stepCue(w.steps[next.index]), 'step')
}

/** Drop the guidance and keep recording as a free run. */
export function endWorkout(): void {
  if (state.workout) patch({ step: { ...state.step, complete: true } })
}

export function pause(): void {
  if (state.status !== 'running') return
  patch({ status: 'paused', pauseStartedAt: Date.now() })
}

export function resume(): void {
  if (state.status !== 'paused') return
  patch({ status: 'running', pausedMs: state.pausedMs + (Date.now() - (state.pauseStartedAt ?? Date.now())), pauseStartedAt: null, seg: state.seg + 1 })
}

export interface Recording {
  startedAt: number
  endedAt: number
  pausedMs: number
  points: GeoPoint[]
  hr: HrSample[]
  hrSource: 'ring' | null
}

/** Stop sensors and hand back the recording. Call `discard()` once it's saved. */
export async function finish(): Promise<Recording | null> {
  if (!state.startedAt) return null
  // Finishing while paused ends the run at the moment it was paused.
  const endedAt = state.pauseStartedAt ?? Date.now()
  await stopLocation()
  stopHr()
  stopTicker()
  // Frozen (and still persisted) until the run is saved or discarded.
  patch({ status: 'paused', pauseStartedAt: endedAt })
  return {
    startedAt: state.startedAt, endedAt, pausedMs: state.pausedMs,
    points: state.points, hr: state.hr, hrSource: state.hr.length ? 'ring' : null,
  }
}

export async function discard(): Promise<void> {
  await stopLocation()
  stopHr()
  stopTicker()
  state = { ...initial, permission: state.permission }
  listeners.forEach(l => l())
  await AsyncStorage.removeItem(STORE_KEY).catch(() => {})
}

// ─── Persistence ───

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist() {
  if (persistTimer || state.status === 'idle' || state.status === 'acquiring') return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const { status, startedAt, pausedMs, pauseStartedAt, seg, points, hr, distanceM, kmMarks, workout, step } = state
    if (status === 'idle' || status === 'acquiring') return
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ status, startedAt, pausedMs, pauseStartedAt, seg, points, hr, distanceM, kmMarks, workout, step })).catch(() => {})
  }, 5000)
}

/**
 * Restore an unfinished run after the app was killed. It comes back paused
 * (the gap is excluded) so the runner decides whether to resume or finish.
 */
export async function restoreRecording(): Promise<boolean> {
  if (state.status !== 'idle') return state.status === 'running' || state.status === 'paused'
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as Partial<RecorderState>
    if (!saved.startedAt) return false
    const lastT = saved.points?.[saved.points.length - 1]?.t ?? saved.startedAt
    state = {
      ...initial, ...saved,
      status: 'paused',
      pauseStartedAt: saved.pauseStartedAt ?? lastT,
    } as RecorderState
    listeners.forEach(l => l())
    await startLocation().catch(() => {})
    startHr()
    startTicker()
    return true
  } catch {
    return false
  }
}

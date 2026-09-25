// Ring service: Bluetooth connection, decoder dispatch, live state,
// per-minute upload and nightly rollups. One instance for the app.
//
// Rings store history on-device, so Orus does not need a permanent
// connection: it connects when the app is open, pulls history since the
// last sync, and streams live data only while a live screen asks for it.

import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { BleManager, Device, Subscription } from 'react-native-ble-plx'
import { supabase } from '../supabase'
import { buildSleepSessions } from '../health'
import { addDays, fromIso, localIso } from '../format'
import { colmiDecoder } from './colmi'
import { frameNote } from './custom'
import { enmo, MinuteAggregator, MinuteRow, rollupDay, rmssd } from './aggregate'
import { fromBase64, toBase64 } from './packet'
import { getRing, hydrateRing, patchRing, pushTrail, logPacket } from './live'
import { broadcastVitals } from './share'
import { isExpoGo } from '../env'
import type { RingDecoder, RingEvent } from './types'

const DEVICE_KEY = 'orus.ring.device'
const HISTORY_KEY = 'orus.ring.historySince'
const decoder: RingDecoder = colmiDecoder

let manager: BleManager | null | undefined
function ble(): BleManager | null {
  if (manager !== undefined) return manager
  if (isExpoGo) return (manager = null)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager: Manager } = require('react-native-ble-plx') as typeof import('react-native-ble-plx')
    // With a restore identifier, iOS keeps the connection across app
    // termination and relaunches Orus in the background when the ring has
    // something to say. Without it, everything stops when the app closes.
    manager = new Manager({
      restoreStateIdentifier: 'orus-ring',
      restoreStateFunction: restored => {
        const peripheral = restored?.connectedPeripherals?.[0]
        if (!peripheral) return
        wantConnected = true
        adopt(peripheral).catch(e => console.warn('ring restore', e))
      },
    })
  } catch {
    manager = null // Expo Go: native module missing
  }
  return manager
}

const aggregator = new MinuteAggregator()
// Decoders drive multi-step exchanges (sequential history) through this.
decoder.attach?.({
  send: (packets) => send(packets),
  emit: (events) => handle(events),
})
let device: Device | null = null
let subs: Subscription[] = []
let liveTimer: ReturnType<typeof setInterval> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let wantConnected = false
/** Recent beat-to-beat intervals, for the live HRV tile. */
let liveRr: number[] = []

export async function initRing(): Promise<void> {
  // No ring paired ⇒ stay completely inert: don't create the Bluetooth
  // manager (that alone triggers the iOS Bluetooth permission prompt).
  const saved = await AsyncStorage.getItem(DEVICE_KEY)
  if (!saved) return patchRing({ status: isExpoGo ? 'unavailable' : 'unpaired' })
  // Show the last readings straight away rather than blanks while we connect.
  await hydrateRing()
  const m = ble()
  if (!m) return patchRing({ status: 'unavailable' })
  patchRing({ device: JSON.parse(saved), status: 'disconnected' })
  wantConnected = true
  connect().catch(() => {})

  m.onStateChange(state => {
    if (state === 'PoweredOn' && wantConnected && getRing().status !== 'connected') {
      reconnectAttempts = 0
      connect().catch(() => {})
    }
  }, false)

  if (!flushTimer) flushTimer = setInterval(() => { flush().catch(e => console.warn('ring flush', e)) }, 60_000)
  AppState.addEventListener('change', s => {
    if (s === 'active' && wantConnected && getRing().status !== 'connected') connect().catch(() => {})
    if (s !== 'active') flush(true).catch(() => {})
  })
}

// ─── Pairing ───

export function scan(onFound: (d: { id: string; name: string; rssi: number | null }) => void): () => void {
  const m = ble()
  if (!m) {
    patchRing({ status: 'unavailable' })
    return () => {}
  }
  patchRing({ status: 'scanning', error: null })
  const seen = new Set<string>()
  m.startDeviceScan(null, { allowDuplicates: false }, (error, d) => {
    if (error) return patchRing({ error: error.message, status: 'unpaired' })
    if (!d || seen.has(d.id) || !decoder.matches(d.name ?? d.localName)) return
    seen.add(d.id)
    onFound({ id: d.id, name: d.name ?? d.localName ?? 'Ring', rssi: d.rssi })
  })
  const stop = () => {
    m.stopDeviceScan().catch(() => {})
    if (getRing().status === 'scanning') patchRing({ status: getRing().device ? 'disconnected' : 'unpaired' })
  }
  setTimeout(stop, 20_000)
  return stop
}

export async function pair(d: { id: string; name: string }): Promise<void> {
  ble()?.stopDeviceScan().catch(() => {})
  await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify({ id: d.id, name: d.name }))
  await AsyncStorage.removeItem(HISTORY_KEY)
  patchRing({ device: d, status: 'disconnected' })
  wantConnected = true
  if (!flushTimer) initRing().catch(() => {})
  else await connect()
}

export async function forget(): Promise<void> {
  wantConnected = false
  await disconnect()
  await AsyncStorage.multiRemove([DEVICE_KEY, HISTORY_KEY])
  patchRing({ device: null, status: 'unpaired', battery: null, live: false })
}

// ─── Connection ───

/** Wire up notifications on an already-connected device (state restoration). */
async function adopt(d: Device): Promise<void> {
  const m = ble()
  if (!m) return
  device = await d.discoverAllServicesAndCharacteristics()
  const services = new Set((await device.services()).map(s => s.uuid.toUpperCase()))
  subs.forEach(s => s.remove())
  subs = []
  for (const ch of decoder.channels) {
    if (!services.has(ch.service.toUpperCase())) continue
    subs.push(device.monitorCharacteristicForService(ch.service, ch.notify, (err, c) => {
      if (err || !c?.value) return
      const bytes = fromBase64(c.value)
      const events = decoder.decode(ch.id, bytes, Date.now())
      logPacket('<', ch.id, bytes, events.length ? events.map(e => e.type).join(',') : frameNote(bytes))
      handle(events)
    }))
  }
  subs.push(m.onDeviceDisconnected(d.id, () => onDisconnected()))
  patchRing({ device: { id: d.id, name: d.name ?? getRing().device?.name ?? 'Ring' }, status: 'connected' })
  startPing()
  if (!flushTimer) flushTimer = setInterval(() => { flush().catch(() => {}) }, 60_000)
}

async function connect(): Promise<void> {
  const m = ble()
  const saved = getRing().device
  if (!m || !saved || getRing().status === 'connecting' || getRing().status === 'connected') return
  patchRing({ status: 'connecting', error: null })
  try {
    const d = await m.connectToDevice(saved.id, { timeout: 45_000 })
    device = await d.discoverAllServicesAndCharacteristics()
    reconnectAttempts = 0

    const services = new Set((await device.services()).map(s => s.uuid.toUpperCase()))
    for (const ch of decoder.channels) {
      if (!services.has(ch.service.toUpperCase())) continue
      subs.push(device.monitorCharacteristicForService(ch.service, ch.notify, (err, c) => {
        if (err || !c?.value) return
        const bytes = fromBase64(c.value)
        const events = decoder.decode(ch.id, bytes, Date.now())
        logPacket('<', ch.id, bytes, events.length ? events.map(e => e.type).join(',') : frameNote(bytes))
        handle(events)
      }))
    }
    subs.push(m.onDeviceDisconnected(saved.id, () => onDisconnected()))

    patchRing({ status: 'connected' })
    startPing()
    await send(decoder.onConnect(new Date()))
    await syncHistory()
  } catch (e) {
    patchRing({ status: 'disconnected', error: (e as Error).message })
    scheduleReconnect()
  }
}

async function disconnect(): Promise<void> {
  stopPing()
  stopLive()
  decoder.reset?.()
  subs.forEach(s => s.remove())
  subs = []
  if (device) await device.cancelConnection().catch(() => {})
  device = null
  await flush(true).catch(() => {})
}

function onDisconnected() {
  stopPing()
  decoder.reset?.()
  subs.forEach(s => s.remove())
  subs = []
  device = null
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null }
  patchRing({ status: getRing().device ? 'disconnected' : 'unpaired', live: false })
  flush(true).catch(() => {})
  scheduleReconnect()
}

/**
 * Rings drop an idle link to save battery, so ask for the battery level every
 * 45 s. It doubles as a liveness check: a failed write means we're gone.
 */
let pingTimer: ReturnType<typeof setInterval> | null = null

function startPing() {
  if (pingTimer || !decoder.ping) return
  pingTimer = setInterval(() => {
    if (getRing().status !== 'connected' || !device) return
    send(decoder.ping!()).catch(() => {})
  }, 45_000)
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = null
}

function scheduleReconnect() {
  if (!wantConnected || reconnectTimer) return
  // Backs off to a minute; iOS lets us keep retrying in the background.
  const delay = Math.min(60_000, 2_000 * 2 ** reconnectAttempts++)
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect().catch(() => {}) }, delay)
}

async function send(packets: { channel: string; bytes: Uint8Array }[]): Promise<void> {
  if (!device) return
  for (const p of packets) {
    const ch = decoder.channels.find(c => c.id === p.channel)
    if (!ch) continue
    logPacket('>', p.channel, p.bytes)
    const b64 = toBase64(p.bytes)
    try {
      await device.writeCharacteristicWithResponseForService(ch.service, ch.write, b64)
    } catch {
      await device.writeCharacteristicWithoutResponseForService(ch.service, ch.write, b64).catch(() => {})
    }
    await new Promise(r => setTimeout(r, 40))
  }
}

// ─── Live streaming ───

/** 'workout' streams heart rate only (runs); 'vitals' rotates HR / temp / HRV / SpO₂. */
export async function startLive(mode: 'vitals' | 'workout' = 'vitals'): Promise<void> {
  if (!device) return
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; await send(decoder.liveStop()).catch(() => {}) }
  liveRr = []
  await send(decoder.liveStart(mode))
  liveTimer = setInterval(() => { send(decoder.liveKeepAlive()).catch(() => {}) }, 10_000)
  patchRing({ live: true })
}

export function stopLive(): void {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null }
  if (device) send(decoder.liveStop()).catch(() => {})
  patchRing({ live: false })
}

export function setSharing(on: boolean): void {
  patchRing({ sharing: on })
}

/**
 * A single sync pass for the background task. iOS gives roughly 30 seconds,
 * so everything is capped: connect, pull what the ring stored, upload, stop.
 */
export async function backgroundSync(): Promise<'synced' | 'no-ring' | 'unreachable'> {
  const saved = await AsyncStorage.getItem(DEVICE_KEY)
  if (!saved) return 'no-ring'
  if (!getRing().device) patchRing({ device: JSON.parse(saved), status: 'disconnected' })
  wantConnected = true
  const deadline = <T>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))])

  if (getRing().status !== 'connected') await deadline(connect(), 20_000)
  if (getRing().status !== 'connected') return 'unreachable'
  await deadline(syncHistory(), 20_000)
  await flush(true).catch(() => {})
  return 'synced'
}

// ─── Events ───

function handle(events: RingEvent[]) {
  const now = Date.now()
  for (const e of events) {
    aggregator.add(e)
    const recent = 'at' in e && now - e.at < 60_000
    switch (e.type) {
      case 'hr':
        if (recent) { patchRing({ hr: { value: e.bpm, at: e.at } }); pushTrail('hrTrail', [e.bpm]) }
        break
      case 'hrv':
        if (recent) patchRing({ hrv: { value: e.ms, at: e.at } })
        break
      case 'rr': {
        // The live HRV tile: RMSSD over the last ~60 beats, once there are enough.
        if (!recent) break
        liveRr = [...liveRr, ...e.intervalsMs].slice(-60)
        const ms = liveRr.length >= 20 ? rmssd(liveRr) : null
        if (ms != null) patchRing({ hrv: { value: ms, at: e.at } })
        break
      }
      case 'spo2':
        if (recent) patchRing({ spo2: { value: e.pct, at: e.at } })
        break
      case 'skin_temp':
        if (recent) patchRing({ skinTemp: { value: e.celsius, at: e.at } })
        break
      case 'accel': {
        if (!recent) break
        // Collapse to ~1 value per second for the chart.
        const per = Math.max(1, Math.round(e.hz))
        const out: number[] = []
        for (let i = 0; i < e.samples.length; i += per) {
          const chunk = e.samples.slice(i, i + per)
          out.push(chunk.reduce((a, s) => a + enmo(s), 0) / chunk.length)
        }
        pushTrail('motionTrail', out)
        break
      }
      case 'battery':
        patchRing({ battery: { pct: e.pct, charging: e.charging } })
        break
      case 'history_done':
        patchRing({ syncing: false })
        AsyncStorage.setItem(HISTORY_KEY, String(Date.now())).catch(() => {})
        flush(true).catch(() => {})
        break
      case 'notice':
        patchRing({ error: e.message })
        break
    }
  }
  const s = getRing()
  if (s.sharing && s.live) broadcastVitals(s)
}

// ─── History + upload ───

export async function syncHistory(): Promise<void> {
  if (!device) return
  const since = await AsyncStorage.getItem(HISTORY_KEY)
  const from = since ? new Date(Number(since) - 3600_000) : addDays(new Date(), -7)
  if (getRing().syncing) return
  patchRing({ syncing: true, error: null })
  // The decoder sends follow-up requests itself and emits history_done at the end.
  await send(decoder.historyRequests(from))
  // Safety net if a decoder never reports completion.
  setTimeout(() => {
    if (getRing().syncing) { patchRing({ syncing: false }); flush(true).catch(() => {}) }
  }, 5 * 60_000)
}

let flushing = false

export async function flush(includeCurrent = false): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id
    const deviceName = getRing().device?.name ?? 'Ring'
    if (!userId) return

    const minutes = aggregator.drainMinutes(Date.now(), includeCurrent)
    const segments = aggregator.drainSleep()
    const days = new Set<string>()

    for (let i = 0; i < minutes.length; i += 500) {
      const batch = minutes.slice(i, i + 500)
      const { error } = await supabase.from('ring_minutes').upsert(
        batch.map(m => ({ ...m, user_id: userId })),
        { onConflict: 'user_id,minute' },
      )
      if (error) throw new Error(`ring_minutes: ${error.message}`)
      batch.forEach(m => days.add(localIso(new Date(m.minute))))
    }

    if (segments.length) {
      const sessions = buildSleepSessions(userId, deviceName, segments)
      if (sessions.length) {
        const { error } = await supabase.from('sleep_sessions').upsert(
          sessions.map(s => ({ ...s, updated_at: new Date().toISOString() })),
          { onConflict: 'user_id,night,source' },
        )
        if (error) throw new Error(`sleep_sessions: ${error.message}`)
        sessions.forEach(s => days.add(s.night))
      }
    }

    for (const day of days) await rollup(userId, deviceName, day)
    if (minutes.length || segments.length) patchRing({ lastUploadAt: Date.now() })
  } finally {
    flushing = false
  }
}

/** Recompute ring_daily for a local date from stored minutes + that night's sleep. */
async function rollup(userId: string, deviceName: string, date: string): Promise<void> {
  const dayStart = fromIso(date)
  const from = new Date(dayStart.getTime() - 12 * 3600_000) // previous noon: covers the night
  const to = addDays(dayStart, 1)

  const [{ data: rows }, { data: night }] = await Promise.all([
    supabase.from('ring_minutes').select('minute, hr_avg, hr_min, hr_max, hrv_ms, skin_temp_c, spo2_pct, motion_g, steps')
      .eq('user_id', userId).gte('minute', from.toISOString()).lt('minute', to.toISOString()).limit(2000),
    supabase.from('sleep_sessions').select('start_at, end_at')
      .eq('user_id', userId).eq('night', date).eq('source', deviceName).maybeSingle(),
  ])
  const window = night ? { start: new Date(night.start_at).getTime(), end: new Date(night.end_at).getTime() } : undefined
  const relevant = ((rows ?? []) as MinuteRow[]).filter(m => {
    const t = new Date(m.minute).getTime()
    return t >= dayStart.getTime() || (window && t >= window.start && t < window.end)
  })
  if (!relevant.length) return

  const day = rollupDay(date, relevant, window)
  const { sleep_minutes_with_hr: _unused, ...values } = day
  const { error } = await supabase.from('ring_daily').upsert(
    { ...values, user_id: userId, source: deviceName, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,date' },
  )
  if (error) throw new Error(`ring_daily: ${error.message}`)
}

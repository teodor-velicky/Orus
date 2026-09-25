// The contract between the ring's Bluetooth bytes and the rest of Orus.
//
// A decoder turns raw notification packets into RingEvents. Everything
// downstream (live UI, per-minute storage, nightly rollups, partner sharing)
// consumes only these events, so the decoder can evolve independently.
//
// Units are fixed here — convert inside the decoder:
//   hr bpm · hrv ms (RMSSD) · rr ms · temp °C · spo2 % · accel g · at epoch ms

import type { SleepStage } from '../types'

export type RingEvent =
  | { type: 'hr'; at: number; bpm: number }
  | { type: 'hrv'; at: number; ms: number }
  /** Beat-to-beat intervals. Orus derives RMSSD per minute when present. */
  | { type: 'rr'; at: number; intervalsMs: number[] }
  | { type: 'spo2'; at: number; pct: number }
  | { type: 'skin_temp'; at: number; celsius: number }
  /** One or more accelerometer samples in g; `at` is the first sample's time. */
  | { type: 'accel'; at: number; hz: number; samples: [number, number, number][] }
  /** Steps taken since the previous steps event (not a daily total). */
  | { type: 'steps'; at: number; count: number }
  /** A contiguous stage segment from the ring's sleep log. */
  | { type: 'sleep_segment'; start: number; end: number; stage: Exclude<SleepStage, 'in_bed'> }
  | { type: 'battery'; at: number; pct: number; charging: boolean }
  | { type: 'device_info'; at: number; model?: string; firmware?: string }
  /** Decoder finished answering a history request. */
  | { type: 'history_done'; at: number; kind: string }
  /** Something the user should see, e.g. "ring not worn correctly". */
  | { type: 'notice'; at: number; message: string }

/** A GATT characteristic pair the decoder wants to talk over. */
export interface RingChannel {
  id: string
  service: string
  write: string
  notify: string
}

export type Outgoing = { channel: string; bytes: Uint8Array }[]

/** Lets a decoder drive multi-step exchanges (sequential history requests). */
export interface RingIO {
  send(packets: Outgoing): Promise<void>
  emit(events: RingEvent[]): void
}

export interface RingDecoder {
  name: string
  /** Called once; `io` stays valid across reconnects. */
  attach?(io: RingIO): void
  /** Called on disconnect to drop partial buffers and pending steps. */
  reset?(): void
  channels: RingChannel[]
  /** Match an advertised device during scanning. */
  matches(deviceName: string | null): boolean
  /** Packets sent right after connecting (set time, request battery, …). */
  onConnect(now: Date): { channel: string; bytes: Uint8Array }[]
  /** Packets that request stored history (sleep, HR log, temp, steps) since `since`. */
  historyRequests(since: Date): { channel: string; bytes: Uint8Array }[]
  /** Start/keep-alive/stop live streaming. Called every ~10 s while live. */
  liveStart(mode?: 'vitals' | 'workout'): { channel: string; bytes: Uint8Array }[]
  liveKeepAlive(): { channel: string; bytes: Uint8Array }[]
  liveStop(): { channel: string; bytes: Uint8Array }[]
  /** Harmless packet sent on a timer so an idle ring doesn't drop the link. */
  ping?(): { channel: string; bytes: Uint8Array }[]
  /** Raw notification → zero or more events. Must never throw. */
  decode(channel: string, bytes: Uint8Array, receivedAt: number): RingEvent[]
}

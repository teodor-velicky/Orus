// Colmi R-series base decoder: UART channel, set time, battery.
// Everything else (history, live measurements, motion, big data) lives in
// lib/ring/custom.ts, which takes precedence for any packet it handles.

import type { RingChannel, RingDecoder, RingEvent } from './types'
import { custom } from './custom'
import { isValidPacket, makePacket } from './packet'

export const UART: RingChannel = {
  id: 'uart',
  service: '6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E',
  write: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E',
  notify: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
}

const CMD = { SET_TIME: 0x01, BATTERY: 0x03 } as const

const bcd = (n: number) => ((Math.floor(n / 10) & 0xf) << 4) | (n % 10)

/** The ring keeps local wall-clock time, BCD-encoded. */
function setTimePacket(d: Date): Uint8Array {
  return makePacket(CMD.SET_TIME, [
    bcd(d.getFullYear() % 2000), bcd(d.getMonth() + 1), bcd(d.getDate()),
    bcd(d.getHours()), bcd(d.getMinutes()), bcd(d.getSeconds()),
    1, // language: English
  ])
}

const uart = (bytes: Uint8Array) => ({ channel: UART.id, bytes })

function decodeBuiltIn(bytes: Uint8Array, at: number): RingEvent[] {
  if (!isValidPacket(bytes)) return []
  if (bytes[0] === CMD.BATTERY) return [{ type: 'battery', at, pct: bytes[1], charging: bytes[2] === 1 }]
  return []
}

export const colmiDecoder: RingDecoder = {
  name: 'Colmi',
  channels: [UART, ...custom.extraChannels],

  attach: (io) => custom.attach(io),
  reset: () => custom.reset(),

  matches: (name) => !!name && (/^R0\d/i.test(name) || /colmi/i.test(name) || custom.matches(name)),

  onConnect: (now) => [
    uart(setTimePacket(now)),
    uart(makePacket(CMD.BATTERY)),
    ...custom.onConnect(now),
  ],

  historyRequests: (since) => custom.historyRequests(since),
  liveStart: (mode) => custom.liveStart(mode),
  liveKeepAlive: () => custom.liveKeepAlive(),
  liveStop: () => custom.liveStop(),
  ping: () => [uart(makePacket(CMD.BATTERY))],

  decode(channel, bytes, receivedAt) {
    try {
      const fromCustom = custom.decode(channel, bytes, receivedAt)
      if (fromCustom !== null) return fromCustom
      return channel === UART.id ? decodeBuiltIn(bytes, receivedAt) : []
    } catch (e) {
      console.warn('ring decode failed', e)
      return []
    }
  },
}

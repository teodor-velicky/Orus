// Colmi UART framing: 16-byte packets,
//   [0] command · [1..14] payload · [15] checksum = sum(bytes 0..14) & 0xFF

import { encode, decode } from 'base64-arraybuffer'

export function checksum(packet: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < 15; i++) sum += packet[i]
  return sum & 0xff
}

export function makePacket(command: number, payload: number[] = []): Uint8Array {
  const p = new Uint8Array(16)
  p[0] = command & 0xff
  payload.slice(0, 14).forEach((b, i) => { p[i + 1] = b & 0xff })
  p[15] = checksum(p)
  return p
}

export function isValidPacket(p: Uint8Array): boolean {
  return p.length === 16 && checksum(p) === p[15]
}

export const toBase64 = (bytes: Uint8Array) =>
  encode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
export const fromBase64 = (b64: string) => new Uint8Array(decode(b64))

export const hex = (bytes: Uint8Array) =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ')

/** Little-endian readers for decoders. */
export const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
export const i16 = (b: Uint8Array, i: number) => { const v = u16(b, i); return v & 0x8000 ? v - 0x10000 : v }
export const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

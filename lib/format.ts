// Dates are handled in LOCAL time: a "day" is the user's calendar day.

export function localIso(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** ISO date string → Date at local midnight. */
export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** [start, end) timestamps for a local calendar day. */
export function dayBounds(iso: string): { start: string; end: string } {
  const s = fromIso(iso)
  return { start: s.toISOString(), end: addDays(s, 1).toISOString() }
}

export function lastNDates(n: number, end: Date = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => localIso(addDays(end, i - n + 1)))
}

export function weekdayShort(iso: string): string {
  return fromIso(iso).toLocaleDateString('en-US', { weekday: 'narrow' })
}

export function prettyDate(iso: string): string {
  return fromIso(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function shortDate(d: string | Date): string {
  const date = typeof d === 'string' ? (d.length === 10 ? fromIso(d) : new Date(d)) : d
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function clock(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function hm(minutes: number | null | undefined): string {
  if (minutes == null || !isFinite(minutes)) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !isFinite(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function avg(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

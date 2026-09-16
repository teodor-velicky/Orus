// GPS track math for runs. Pure — no React Native imports (unit-tested).

/** One GPS fix. `t` is epoch ms. `seg` increments after every pause so paused gaps never count. */
export interface GeoPoint {
  t: number
  lat: number
  lng: number
  alt?: number | null
  acc?: number | null
  seg?: number
}

/** Heart-rate sample: epoch ms + bpm. */
export interface HrSample { t: number; bpm: number }

export interface Split {
  /** 1-based km index; the last split may be partial. */
  km: number
  distanceM: number
  durationS: number
  paceS: number
  avgHr: number | null
  elevDeltaM: number
}

const R = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Human running tops out ~12 m/s; anything faster between fixes is a GPS jump. */
const MAX_SPEED = 9
const MAX_ACCURACY_M = 35

/** Drop inaccurate fixes and teleports. Keeps order. */
export function cleanTrack(points: GeoPoint[]): GeoPoint[] {
  const out: GeoPoint[] = []
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    if (p.acc != null && p.acc > MAX_ACCURACY_M) continue
    const prev = out[out.length - 1]
    if (prev && (prev.seg ?? 0) === (p.seg ?? 0)) {
      const dt = (p.t - prev.t) / 1000
      if (dt <= 0) continue
      if (haversine(prev, p) / dt > MAX_SPEED) continue
    }
    out.push(p)
  }
  return out
}

/** Cumulative distance per point (segment breaks add nothing). */
export function cumulative(points: GeoPoint[]): number[] {
  const d: number[] = []
  points.forEach((p, i) => {
    const prev = points[i - 1]
    d.push(i === 0 ? 0 : d[i - 1] + ((prev.seg ?? 0) === (p.seg ?? 0) ? haversine(prev, p) : 0))
  })
  return d
}

export const trackDistance = (points: GeoPoint[]) => {
  const c = cumulative(points)
  return c[c.length - 1] ?? 0
}

/** Seconds spent moving faster than a slow walk, within segments. */
export function movingTime(points: GeoPoint[], minSpeed = 0.8): number {
  let s = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if ((a.seg ?? 0) !== (b.seg ?? 0)) continue
    const dt = (b.t - a.t) / 1000
    if (dt <= 0 || dt > 60) continue
    if (haversine(a, b) / dt >= minSpeed) s += dt
  }
  return Math.round(s)
}

/** Total climb with a hysteresis threshold so GPS altitude noise doesn't add up. */
export function elevationGain(points: GeoPoint[], threshold = 4): number {
  let gain = 0
  let ref: number | null = null
  for (const p of points) {
    if (p.alt == null || !isFinite(p.alt)) continue
    if (ref == null) { ref = p.alt; continue }
    if (p.alt - ref >= threshold) { gain += p.alt - ref; ref = p.alt }
    else if (ref - p.alt >= threshold) ref = p.alt
  }
  return Math.round(gain)
}

/** Average bpm of samples within [from, to] ms. */
export function avgHrBetween(hr: HrSample[], from: number, to: number): number | null {
  const xs = hr.filter(h => h.t >= from && h.t <= to).map(h => h.bpm)
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

/** Per-kilometre splits, interpolating the exact km crossing time. */
export function splits(points: GeoPoint[], hr: HrSample[] = [], unitM = 1000): Split[] {
  if (points.length < 2) return []
  const cum = cumulative(points)
  const total = cum[cum.length - 1]
  const out: Split[] = []
  let startT = points[0].t
  let startAlt = points[0].alt ?? null
  let pausedInSplit = 0
  let next = unitM
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if ((a.seg ?? 0) !== (b.seg ?? 0)) { pausedInSplit += b.t - a.t; continue }
    while (cum[i] >= next) {
      const f = cum[i] === cum[i - 1] ? 1 : (next - cum[i - 1]) / (cum[i] - cum[i - 1])
      const t = a.t + (b.t - a.t) * f
      const alt = a.alt != null && b.alt != null ? a.alt + (b.alt - a.alt) * f : null
      const dur = (t - startT - pausedInSplit) / 1000
      out.push({
        km: out.length + 1, distanceM: unitM, durationS: Math.round(dur), paceS: Math.round(dur / (unitM / 1000)),
        avgHr: avgHrBetween(hr, startT, t), elevDeltaM: alt != null && startAlt != null ? Math.round(alt - startAlt) : 0,
      })
      startT = t
      startAlt = alt
      pausedInSplit = 0
      next += unitM
    }
  }
  const restM = total - (next - unitM)
  const last = points[points.length - 1]
  if (restM >= 50) {
    const dur = (last.t - startT - pausedInSplit) / 1000
    out.push({
      km: out.length + 1, distanceM: Math.round(restM), durationS: Math.round(dur), paceS: Math.round(dur / (restM / 1000)),
      avgHr: avgHrBetween(hr, startT, last.t),
      elevDeltaM: last.alt != null && startAlt != null ? Math.round(last.alt - startAlt) : 0,
    })
  }
  return out
}

/**
 * Fastest time over `distanceM` anywhere in the track (sliding window on
 * cumulative distance, pauses excluded). null when the run is shorter.
 */
export function fastestSegment(points: GeoPoint[], distanceM: number): number | null {
  if (points.length < 2) return null
  const cum = cumulative(points)
  if (cum[cum.length - 1] < distanceM) return null
  // Active time excluding pause gaps.
  const act: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const same = (points[i - 1].seg ?? 0) === (points[i].seg ?? 0)
    act.push(act[i - 1] + (same ? (points[i].t - points[i - 1].t) / 1000 : 0))
  }
  let best = Infinity
  let j = 0
  for (let i = 0; i < points.length; i++) {
    while (j < points.length && cum[j] - cum[i] < distanceM) j++
    if (j >= points.length) break
    const over = cum[j] - cum[i]
    const f = over > 0 ? distanceM / over : 1
    best = Math.min(best, (act[j] - act[i]) * f)
  }
  return isFinite(best) ? Math.round(best) : null
}

export const EFFORT_DISTANCES = [1000, 5000, 10000, 21097.5, 42195] as const

export function bestEfforts(points: GeoPoint[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of EFFORT_DISTANCES) {
    const s = fastestSegment(points, d)
    if (s != null) out[String(d)] = s
  }
  return out
}

/** Douglas–Peucker in local metres. Keeps first/last and segment boundaries. */
export function simplify(points: GeoPoint[], toleranceM = 4): GeoPoint[] {
  if (points.length <= 2) return points
  const lat0 = rad(points[0].lat)
  const xy = points.map(p => ({ x: rad(p.lng) * R * Math.cos(lat0), y: rad(p.lat) * R }))
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  for (let i = 1; i < points.length; i++) {
    if ((points[i].seg ?? 0) !== (points[i - 1].seg ?? 0)) { keep[i] = 1; keep[i - 1] = 1 }
  }
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    const a = xy[s], b = xy[e]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      // Loops start and end in the same place: fall back to distance from the start point.
      const d = len < 1
        ? Math.hypot(xy[i].x - a.x, xy[i].y - a.y)
        : Math.abs(dy * xy[i].x - dx * xy[i].y + b.x * a.y - b.y * a.x) / len
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx >= 0 && maxD > toleranceM) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Keep at most one HR sample per `stepS` seconds (averaged). */
export function downsampleHr(hr: HrSample[], stepS = 5): HrSample[] {
  const buckets = new Map<number, number[]>()
  for (const h of hr) {
    if (!(h.bpm >= 30 && h.bpm <= 230)) continue
    const k = Math.floor(h.t / (stepS * 1000))
    const b = buckets.get(k) ?? []
    b.push(h.bpm)
    buckets.set(k, b)
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0])
    .map(([k, xs]) => ({ t: k * stepS * 1000, bpm: Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) }))
}

/** Speed series (m/s) in time buckets for charts; paused buckets are null. */
export function speedSeries(points: GeoPoint[], buckets = 60): (number | null)[] {
  if (points.length < 2) return []
  const t0 = points[0].t
  const span = points[points.length - 1].t - t0 || 1
  const dist = new Array<number>(buckets).fill(0)
  const time = new Array<number>(buckets).fill(0)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if ((a.seg ?? 0) !== (b.seg ?? 0)) continue
    const k = Math.min(buckets - 1, Math.floor(((a.t - t0) / span) * buckets))
    dist[k] += haversine(a, b)
    time[k] += (b.t - a.t) / 1000
  }
  // Light smoothing so the chart reads as effort, not GPS jitter.
  const raw = dist.map((d, i) => (time[i] > 0 && d > 0 ? d / time[i] : null))
  return raw.map((v, i) => {
    if (v == null) return null
    const w = [raw[i - 1], v, raw[i + 1]].filter((x): x is number => x != null)
    return w.reduce((a, x) => a + x, 0) / w.length
  })
}

/** Bucketed bpm series aligned with speedSeries. */
export function hrSeries(hr: HrSample[], from: number, to: number, buckets = 60): (number | null)[] {
  const span = to - from || 1
  const sums = new Array<number>(buckets).fill(0)
  const counts = new Array<number>(buckets).fill(0)
  for (const h of hr) {
    if (h.t < from || h.t > to) continue
    const k = Math.min(buckets - 1, Math.floor(((h.t - from) / span) * buckets))
    sums[k] += h.bpm
    counts[k]++
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : null))
}

// ─── Formatting ───

/** 272 → "4:32" */
export function paceText(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm == null || !isFinite(secondsPerKm) || secondsPerKm <= 0 || secondsPerKm > 3600) return '—'
  const m = Math.floor(secondsPerKm / 60)
  const s = Math.round(secondsPerKm % 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}

/** 1199 → "19:59", 5025 → "1:23:45" */
export function raceTime(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '—'
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export const km = (m: number | null | undefined, digits = 2) =>
  m == null ? '—' : (m / 1000).toFixed(digits)

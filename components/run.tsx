// Running visuals — mono, luminance-encoded like the rest of Orus.
import React, { useState } from 'react'
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native'
import Svg, { Circle, Defs, G, Line as SvgLine, LinearGradient as SvgGradient, Path, Rect, Stop } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, ink, radius, space, type } from '../lib/theme'
import { paceText, raceTime } from '../lib/run/geo'
import type { Zone } from '../lib/run/zones'
import type { PlannedRun } from '../lib/run/plan'
import type { RunSplit } from '../lib/types'
import { addDays, fromIso, localIso } from '../lib/format'
import { tap } from './ui'

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0)
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))]
}

// ─── Route ───

type LatLng = [number, number]

/**
 * GPS route drawn on a dot grid (no map tiles — pure shape). Segment
 * brightness encodes speed: faster = brighter.
 */
export function RouteMap({ route, height = 220, speeds, live = false, thumb = false }: {
  route: LatLng[]
  height?: number
  /** Optional per-point speed (same length as route) for luminance. */
  speeds?: (number | null)[]
  live?: boolean
  thumb?: boolean
}) {
  const [width, onLayout] = useWidth()
  const pad = thumb ? 6 : 22
  if (route.length < 2) {
    return (
      <View onLayout={onLayout} style={{ height, borderRadius: thumb ? radius.s : radius.m, backgroundColor: alpha(0.02), alignItems: 'center', justifyContent: 'center' }}>
        {thumb ? <Ionicons name="navigate-outline" size={16} color={color.textFaint} /> : <Text style={type.caption}>{live ? 'Waiting for GPS…' : 'No GPS route'}</Text>}
      </View>
    )
  }
  const lat0 = (route[0][0] * Math.PI) / 180
  const xs = route.map(p => p[1] * Math.cos(lat0))
  const ys = route.map(p => -p[0])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = maxX - minX || 1e-5
  const spanY = maxY - minY || 1e-5
  const scale = width > 0 ? Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY) : 0
  const offX = (width - spanX * scale) / 2
  const offY = (height - spanY * scale) / 2
  const pts = route.map((_, i) => ({ x: offX + (xs[i] - minX) * scale, y: offY + (ys[i] - minY) * scale }))
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const sp = speeds?.filter((v): v is number => v != null) ?? []
  const lo = sp.length ? Math.min(...sp) : 0
  const hi = sp.length ? Math.max(...sp) : 1
  const start = pts[0]
  const end = pts[pts.length - 1]
  const grid = thumb ? 10 : 18
  return (
    <View onLayout={onLayout} style={{ height, borderRadius: thumb ? radius.s : radius.m, overflow: 'hidden', backgroundColor: alpha(0.015) }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <G>
            {Array.from({ length: Math.ceil(width / grid) }, (_, i) =>
              Array.from({ length: Math.ceil(height / grid) }, (_, j) => (
                <Circle key={`${i}-${j}`} cx={i * grid + grid / 2} cy={j * grid + grid / 2} r={0.7} fill={alpha(0.07)} />
              )))}
          </G>
          <Path d={d} stroke={alpha(0.08)} strokeWidth={thumb ? 5 : 12} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {speeds && sp.length > 1 && !thumb ? (
            pts.slice(1).map((p, i) => {
              const v = speeds[i + 1] ?? speeds[i]
              const t = v == null ? 0.4 : (v - lo) / (hi - lo || 1)
              return <SvgLine key={i} x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y} stroke={ink(t * 100, 0.3)} strokeWidth={3} strokeLinecap="round" />
            })
          ) : (
            <Path d={d} stroke={color.text} strokeWidth={thumb ? 1.6 : 2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {thumb ? null : <Circle cx={start.x} cy={start.y} r={5} fill={color.bg} stroke={color.text} strokeWidth={2} />}
          <Circle cx={end.x} cy={end.y} r={thumb ? 2.5 : live ? 9 : 5} fill={live ? alpha(0.18) : color.text} />
          {live ? <Circle cx={end.x} cy={end.y} r={4.5} fill={color.text} /> : null}
        </Svg>
      ) : null}
    </View>
  )
}

// ─── Heart-rate zones ───

const ZONE_INK = [alpha(0.2), alpha(0.38), alpha(0.58), alpha(0.8), color.text]

/** Horizontal time-in-zone bars, Z5 on top. */
export function ZoneBars({ zones, seconds }: { zones: Zone[]; seconds: number[] }) {
  const total = seconds.reduce((a, b) => a + b, 0) || 1
  const max = Math.max(...seconds, 1)
  return (
    <View style={{ gap: space.m }}>
      {[...zones].reverse().map(z => {
        const s = seconds[z.n - 1] ?? 0
        return (
          <View key={z.n} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <View style={{ width: 74 }}>
              <Text style={[type.caption, { color: color.text, fontFamily: font.medium }]}>Z{z.n} <Text style={{ color: color.textSecondary, fontFamily: font.regular }}>{z.name}</Text></Text>
              <Text style={[type.unit, { fontSize: 9.5 }]}>{z.lo}–{z.hi}</Text>
            </View>
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: alpha(0.05), overflow: 'hidden' }}>
              <View style={{ width: `${(s / max) * 100}%`, height: 10, borderRadius: 5, backgroundColor: ZONE_INK[z.n - 1] }} />
            </View>
            <View style={{ width: 62, alignItems: 'flex-end' }}>
              <Text style={[type.data, { fontSize: 13 }]}>{raceTime(s)}</Text>
              <Text style={[type.unit, { fontSize: 9.5 }]}>{Math.round((s / total) * 100)}%</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** Five-segment live zone indicator. */
export function ZoneStrip({ zones, bpm }: { zones: Zone[]; bpm: number | null }) {
  const active = bpm == null ? 0 : zones.reduce((acc, z) => (bpm >= z.lo ? z.n : acc), 0)
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {zones.map(z => (
          <View key={z.n} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: z.n === active ? color.text : z.n < active ? alpha(0.3) : alpha(0.07) }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
        {zones.map(z => (
          <Text key={z.n} style={[type.unit, { flex: 1, textAlign: 'center', fontSize: 9.5, color: z.n === active ? color.text : color.textTertiary }]}>Z{z.n}</Text>
        ))}
      </View>
    </View>
  )
}

/** HR line over horizontal zone bands. */
export function HrZoneChart({ values, zones, height = 150 }: { values: (number | null)[]; zones: Zone[]; height?: number }) {
  const [width, onLayout] = useWidth()
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null)
  if (pts.length < 2) {
    return <View onLayout={onLayout} style={{ height, borderRadius: radius.m, backgroundColor: alpha(0.02), alignItems: 'center', justifyContent: 'center' }}><Text style={type.caption}>No heart rate for this run</Text></View>
  }
  const labelW = 26
  const lo = Math.min(zones[0].lo - 10, ...pts.map(p => p.v))
  const hi = Math.max(zones[4].hi, ...pts.map(p => p.v))
  const plotW = Math.max(0, width - labelW)
  const y = (b: number) => (1 - (b - lo) / (hi - lo)) * height
  const x = (i: number) => labelW + (i / Math.max(1, values.length - 1)) * plotW
  const d = pts.map((p, k) => `${k ? 'L' : 'M'} ${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const area = `${d} L ${x(pts[pts.length - 1].i)} ${height} L ${x(pts[0].i)} ${height} Z`
  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <SvgGradient id="hrfill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.text} stopOpacity={0.2} />
              <Stop offset="1" stopColor={color.text} stopOpacity={0} />
            </SvgGradient>
          </Defs>
          {zones.map(z => (
            <G key={z.n}>
              <Rect x={labelW} y={y(z.hi)} width={plotW} height={Math.max(0, y(z.lo) - y(z.hi))} fill={alpha(0.012 * z.n)} />
              <SvgLine x1={labelW} x2={width} y1={y(z.lo)} y2={y(z.lo)} stroke={alpha(0.07)} strokeDasharray="2 4" />
            </G>
          ))}
          <Path d={area} fill="url(#hrfill)" />
          <Path d={d} stroke={color.text} strokeWidth={1.8} fill="none" strokeLinejoin="round" />
        </Svg>
      ) : <View style={{ height }} />}
      {width > 0 ? zones.map(z => (
        <Text key={z.n} style={[type.unit, { position: 'absolute', left: 0, top: (y(z.lo) + y(z.hi)) / 2 - 7, fontSize: 9 }]}>Z{z.n}</Text>
      )) : null}
    </View>
  )
}

// ─── Splits ───

export function SplitsTable({ splits }: { splits: RunSplit[] }) {
  const full = splits.filter(s => s.distanceM >= 900)
  const fastest = full.length ? Math.min(...full.map(s => s.paceS)) : 0
  const slowest = full.length ? Math.max(...full.map(s => s.paceS)) : 1
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingBottom: space.s, borderBottomWidth: 1, borderBottomColor: color.hairline }}>
        <Text style={[type.label, { width: 34, fontSize: 9 }]}>KM</Text>
        <Text style={[type.label, { width: 52, fontSize: 9 }]}>PACE</Text>
        <View style={{ flex: 1 }} />
        <Text style={[type.label, { width: 44, fontSize: 9, textAlign: 'right' }]}>HR</Text>
        <Text style={[type.label, { width: 44, fontSize: 9, textAlign: 'right' }]}>ELEV</Text>
      </View>
      {splits.map(s => {
        const partial = s.distanceM < 900
        // Faster = longer, brighter bar
        const t = partial || slowest === fastest ? 0.5 : 1 - (s.paceS - fastest) / (slowest - fastest)
        const best = !partial && s.paceS === fastest && full.length > 1
        return (
          <View key={s.km} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: alpha(0.03) }}>
            <Text style={[type.data, { width: 34, fontSize: 13, color: color.textSecondary }]}>{partial ? (s.distanceM / 1000).toFixed(1) : s.km}</Text>
            <Text style={[type.data, { width: 52, fontSize: 13, color: best ? color.text : color.textSecondary }]}>{paceText(s.paceS)}</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: alpha(0.04), marginRight: space.s }}>
              <View style={{ width: `${30 + t * 70}%`, height: 6, borderRadius: 3, backgroundColor: best ? color.text : ink(t * 100, 0.2) }} />
            </View>
            <Text style={[type.data, { width: 44, fontSize: 13, textAlign: 'right', color: color.textSecondary }]}>{s.avgHr ?? '—'}</Text>
            <Text style={[type.data, { width: 44, fontSize: 13, textAlign: 'right', color: color.textTertiary }]}>{s.elevDeltaM > 0 ? '+' : ''}{s.elevDeltaM}</Text>
          </View>
        )
      })}
    </View>
  )
}

// ─── Plan ───

export const SESSION_ICON: Record<PlannedRun['kind'], keyof typeof Ionicons.glyphMap> = {
  rest: 'moon-outline', recovery: 'leaf-outline', easy: 'walk-outline', long: 'infinite-outline',
  tempo: 'trending-up-outline', intervals: 'flash-outline', race_pace: 'speedometer-outline', marathon_pace: 'speedometer-outline',
}

/** Seven day columns; key sessions are filled, done days get a check. */
export function PlanStrip({ days, selected, onSelect }: { days: PlannedRun[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {days.map((d, i) => {
        const on = i === selected
        return (
          <Pressable key={d.date} onPress={() => { tap(); onSelect(i) }}
            style={{ alignItems: 'center', gap: 6, width: 42, paddingVertical: 8, borderRadius: radius.m, backgroundColor: on ? color.inset : 'transparent', borderWidth: 1, borderColor: on ? color.hairlineStrong : 'transparent' }}>
            <Text style={[type.label, { fontSize: 9, color: on ? color.text : color.textTertiary }]}>
              {i === 0 ? 'NOW' : fromIso(d.date).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}
            </Text>
            <View style={{
              width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
              backgroundColor: d.key ? color.text : d.kind === 'rest' ? 'transparent' : color.insetStrong,
              borderWidth: 1, borderColor: d.kind === 'rest' ? color.hairline : 'transparent',
            }}>
              <Ionicons name={d.done ? 'checkmark' : SESSION_ICON[d.kind]} size={14} color={d.key ? color.bg : d.kind === 'rest' ? color.textTertiary : color.text} />
            </View>
            <Text style={[type.unit, { fontSize: 9, color: on ? color.text : color.textTertiary }]}>{d.distanceKm ? Math.round(d.distanceKm) : '·'}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ─── Calendar ───

export interface CalendarActivity {
  key: string
  date: string
  kind: 'run' | 'gym' | 'other'
  title: string
  sub: string
  /** Run distance in km (sizes the dot). */
  km?: number
  runId?: string
  sessionId?: string
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Month grid; each day shows run (dot sized by km), gym (square) and other (ring) marks. */
export function MonthCalendar({ month, activities, selected, onSelect, onMonth, filter = 'all' }: {
  /** 'YYYY-MM' */
  month: string
  activities: CalendarActivity[]
  selected: string | null
  onSelect: (date: string) => void
  onMonth: (delta: number) => void
  filter?: 'all' | 'run' | 'gym'
}) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => localIso(addDays(first, i))),
  ]
  while (cells.length % 7) cells.push(null)
  const today = localIso()
  const byDay = new Map<string, CalendarActivity[]>()
  for (const a of activities) {
    const list = byDay.get(a.date) ?? []
    list.push(a)
    byDay.set(a.date, list)
  }
  const inMonth = activities.filter(a => a.date.startsWith(month))
  const runKm = inMonth.filter(a => a.kind === 'run').reduce((s, a) => s + (a.km ?? 0), 0)
  const activeDays = new Set(inMonth.map(a => a.date)).size
  const isCurrent = month === today.slice(0, 7)
  const dim = (k: CalendarActivity['kind']) => filter !== 'all' && filter !== k

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.l }}>
        <Pressable hitSlop={12} onPress={() => { tap(); onMonth(-1) }} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: color.inset }}>
          <Ionicons name="chevron-back" size={15} color={color.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={type.title}>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
          <Text style={[type.unit, { marginTop: 2 }]}>{activeDays} ACTIVE DAYS · {runKm.toFixed(1)} KM</Text>
        </View>
        <Pressable hitSlop={12} disabled={isCurrent} onPress={() => { tap(); onMonth(1) }} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: color.inset, opacity: isCurrent ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={15} color={color.text} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: space.s }}>
        {WEEKDAYS.map((d, i) => <Text key={i} style={[type.label, { flex: 1, textAlign: 'center', fontSize: 9 }]}>{d}</Text>)}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {cells.slice(r * 7, r * 7 + 7).map((date, c) => {
            if (!date) return <View key={c} style={{ flex: 1, height: 50 }} />
            const acts = byDay.get(date) ?? []
            const run = acts.filter(a => a.kind === 'run')
            const km = run.reduce((s, a) => s + (a.km ?? 0), 0)
            const gym = acts.some(a => a.kind === 'gym')
            const other = acts.some(a => a.kind === 'other')
            const on = date === selected
            const future = date > today
            const dot = run.length ? Math.max(6, Math.min(16, 5 + km * 0.7)) : 0
            return (
              <Pressable key={c} disabled={future} onPress={() => { tap(); onSelect(date) }} style={{ flex: 1, height: 50, alignItems: 'center', paddingTop: 5 }}>
                <View style={{
                  width: 40, height: 44, borderRadius: 12, alignItems: 'center',
                  backgroundColor: on ? color.insetStrong : 'transparent', borderWidth: 1,
                  borderColor: on ? color.hairlineStrong : date === today ? color.hairline : 'transparent',
                }}>
                  <Text style={{ fontFamily: date === today ? font.semibold : font.regular, fontSize: 12, marginTop: 4, color: future ? color.textFaint : acts.length ? color.text : color.textTertiary }}>
                    {Number(date.slice(8))}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 18 }}>
                    {run.length ? <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color.text, opacity: dim('run') ? 0.2 : 1 }} /> : null}
                    {gym ? <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: alpha(0.6), opacity: dim('gym') ? 0.25 : 1 }} /> : null}
                    {other ? <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.2, borderColor: alpha(0.55), opacity: filter === 'all' ? 1 : 0.25 }} /> : null}
                  </View>
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l, marginTop: space.m }}>
        {[
          { l: 'Run', el: <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.text }} /> },
          { l: 'Strength', el: <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: alpha(0.6) }} /> },
          { l: 'Other', el: <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.2, borderColor: alpha(0.55) }} /> },
        ].map(x => (
          <View key={x.l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{x.el}<Text style={type.caption}>{x.l}</Text></View>
        ))}
      </View>
    </View>
  )
}

/** Big live number with a mono label (recording screen). */
export function LiveStat({ value, label, unit, big = false }: { value: string; label: string; unit?: string; big?: boolean }) {
  const size = big ? 64 : 30
  return (
    <View style={{ alignItems: 'center', flex: big ? undefined : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={[type.hero, { fontSize: size, lineHeight: size * 1.08, letterSpacing: -size * 0.04 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        {unit ? <Text style={[type.unit, { fontSize: big ? 13 : 11 }]}>{unit}</Text> : null}
      </View>
      <Text style={[type.label, { marginTop: 2, fontSize: 9 }]}>{label}</Text>
    </View>
  )
}

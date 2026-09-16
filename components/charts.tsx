// Orus mono charts v2 — gauges, smooth areas, rounded bars, donuts.
// Intensity = luminance. No hue anywhere.
import React, { useEffect, useId, useRef, useState } from 'react'
import { Animated, Easing, LayoutChangeEvent, Pressable, Text, View } from 'react-native'
import Svg, { Circle, Defs, G, Line as SvgLine, LinearGradient as SvgGradient, Path, Rect, Stop } from 'react-native-svg'
import { alpha, color, font, ink, radius, space, type } from '../lib/theme'
import type { SleepSession, SleepStage } from '../lib/types'
import { tap } from './ui'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedPath = Animated.createAnimatedComponent(Path)

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const useSvgId = () => `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0)
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))]
}

function useSweep(value: number | null, duration = 900) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(v, {
      toValue: clamp(value ?? 0) / 100,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [value, v, duration])
  return v
}

// ─── Rings & gauges ───

/** Full circular progress ring. */
export function Ring({
  value, size = 120, stroke = 6, children,
}: {
  value: number | null
  size?: number
  stroke?: number
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const sweep = useSweep(value)
  const dash = sweep.interpolate({ inputRange: [0, 1], outputRange: [c, 0] })
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={alpha(0.08)} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color.text} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={dash} strokeLinecap="round"
        />
      </Svg>
      {children}
    </View>
  )
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const s = polar(cx, cy, r, from)
  const e = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

/**
 * 270° gauge with tick marks — the hero element. Value in the middle,
 * mono label underneath. `null` renders an empty dash.
 */
export function Gauge({
  value, size = 120, stroke = 7, label, display, unit, sub, ticks = true,
}: {
  value: number | null
  size?: number
  stroke?: number
  label?: string
  /** Text in the center; defaults to the rounded value. */
  display?: string
  unit?: string
  sub?: string
  ticks?: boolean
}) {
  const id = useSvgId()
  const cx = size / 2
  const cy = size / 2
  const r = (size - stroke) / 2 - (ticks ? 5 : 0)
  const from = -135
  const to = 135
  const len = (2 * Math.PI * r * (to - from)) / 360
  const sweep = useSweep(value)
  const offset = sweep.interpolate({ inputRange: [0, 1], outputRange: [len, 0] })
  const big = size >= 140
  const valueSize = size * (big ? 0.27 : 0.25)
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size * 0.9, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute', top: 0 }}>
          <Defs>
            <SvgGradient id={id} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={color.text} stopOpacity={0.45} />
              <Stop offset="1" stopColor={color.text} stopOpacity={1} />
            </SvgGradient>
          </Defs>
          {ticks ? (
            <G>
              {Array.from({ length: 28 }, (_, i) => {
                const deg = from + ((to - from) * i) / 27
                const a = polar(cx, cy, size / 2 - 1, deg)
                const b = polar(cx, cy, size / 2 - 4, deg)
                return <SvgLine key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={alpha(i % 9 === 0 ? 0.28 : 0.1)} strokeWidth={1} />
              })}
            </G>
          ) : null}
          <Path d={arcPath(cx, cy, r, from, to)} stroke={alpha(0.08)} strokeWidth={stroke} fill="none" strokeLinecap="round" />
          <AnimatedPath
            d={arcPath(cx, cy, r, from, to)}
            stroke={`url(#${id})`} strokeWidth={stroke} fill="none" strokeLinecap="round"
            strokeDasharray={`${len} ${len}`} strokeDashoffset={offset}
          />
        </Svg>
        <View style={{ alignItems: 'center', marginTop: size * 0.04 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[type.hero, { fontSize: valueSize, lineHeight: valueSize * 1.1, letterSpacing: -valueSize * 0.04, color: value == null ? color.textFaint : color.text }]}>
              {display ?? (value == null ? '—' : String(Math.round(value)))}
            </Text>
            {unit ? <Text style={[type.unit, { fontSize: big ? 12 : 10 }]}>{unit}</Text> : null}
          </View>
          {sub ? (
            <Text numberOfLines={1} adjustsFontSizeToFit
              style={[type.caption, { fontSize: big ? 12 : 10, marginTop: 1, maxWidth: size * 0.6, textAlign: 'center' }]}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
      {label ? <Text style={[type.label, { marginTop: -size * 0.02 }]}>{label}</Text> : null}
    </View>
  )
}

/** Tiny ring for lists (meal scores, week strip). */
export function MiniRing({ value, size = 34, stroke = 3, children }: {
  value: number | null; size?: number; stroke?: number; children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = clamp(value ?? 0) / 100
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={alpha(0.1)} strokeWidth={stroke} fill="none" />
        {pct > 0 ? (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={ink(value ?? 0, 0.45)} strokeWidth={stroke} fill="none"
            strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" />
        ) : null}
      </Svg>
      {children}
    </View>
  )
}

/** Donut with segments (e.g. macro calorie split). Center content via children. */
export function Donut({ parts, size = 120, stroke = 12, children }: {
  parts: { value: number; label: string }[]
  size?: number
  stroke?: number
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const total = parts.reduce((a, p) => a + p.value, 0)
  const shades = [color.text, alpha(0.55), alpha(0.28), alpha(0.14)]
  const gap = total > 0 ? 3 : 0
  let acc = 0
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={alpha(0.06)} strokeWidth={stroke} fill="none" />
        {total > 0 && parts.map((p, i) => {
          const len = (p.value / total) * c
          const el = len > gap ? (
            <Circle key={p.label} cx={size / 2} cy={size / 2} r={r} stroke={shades[i % shades.length]} strokeWidth={stroke} fill="none"
              strokeDasharray={`${len - gap} ${c}`} strokeDashoffset={-acc} />
          ) : null
          acc += len
          return el
        })}
      </Svg>
      {children}
    </View>
  )
}

export const LEGEND_SHADES = [color.text, alpha(0.55), alpha(0.28), alpha(0.14)]

export function Legend({ items }: { items: { label: string; value?: string }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space.l, rowGap: space.s }}>
      {items.map((it, i) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LEGEND_SHADES[i % LEGEND_SHADES.length] }} />
          <Text style={type.caption}>{it.label}{it.value ? <Text style={{ color: color.text, fontFamily: font.medium }}> {it.value}</Text> : null}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── Bars ───

/** Thin horizontal progress. `pct` may exceed 100 (bar caps). */
export function Progress({ pct, height = 5 }: { pct: number; height?: number }) {
  const w = clamp(pct)
  return (
    <View style={{ height, borderRadius: height, backgroundColor: alpha(0.07), overflow: 'hidden' }}>
      <View style={{ width: `${w}%`, height, borderRadius: height, backgroundColor: ink(w, 0.4) }} />
    </View>
  )
}

export function MetricBar({ label, valueText, pct, sub }: {
  label: string; valueText: string; pct: number; sub?: string
}) {
  return (
    <View style={{ marginBottom: space.l }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
        <Text style={[type.sub, { color: color.text }]}>{label}</Text>
        <Text style={[type.unit, { color: color.textSecondary }]}>{valueText}</Text>
      </View>
      <Progress pct={pct} />
      {sub ? <Text style={[type.caption, { marginTop: 6 }]}>{sub}</Text> : null}
    </View>
  )
}

/** Rounded vertical bars; highlighted bar is solid, others dim. Dashed target line. */
export function Bars({
  values, labels, height = 110, highlight, target, onSelect, formatValue,
}: {
  values: (number | null)[]
  labels?: string[]
  height?: number
  highlight?: number
  target?: number
  onSelect?: (index: number) => void
  formatValue?: (v: number) => string
}) {
  const [width, onLayout] = useWidth()
  const max = Math.max(target ?? 0, ...values.map(v => v ?? 0), 1) * 1.08
  const n = Math.max(values.length, 1)
  const gap = n > 20 ? 3 : n > 10 ? 5 : 8
  const bw = width > 0 ? (width - gap * (n - 1)) / n : 0
  const hl = highlight ?? values.length - 1
  const topLabel = formatValue && values[hl] != null ? formatValue(values[hl]!) : null
  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {[0.25, 0.5, 0.75].map(f => (
            <SvgLine key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={alpha(0.04)} strokeWidth={1} />
          ))}
          {target ? (
            <SvgLine x1={0} x2={width} y1={height - (target / max) * height} y2={height - (target / max) * height}
              stroke={alpha(0.3)} strokeDasharray="2 4" strokeWidth={1} />
          ) : null}
          {values.map((v, i) => {
            const h = v ? Math.max(4, (v / max) * height) : 4
            const on = i === hl
            return (
              <Rect key={i} x={i * (bw + gap)} y={height - h} width={Math.max(bw, 1)} height={h}
                rx={Math.min(6, bw / 2)} fill={v ? (on ? color.text : alpha(0.22)) : alpha(0.06)} />
            )
          })}
        </Svg>
      ) : <View style={{ height }} />}
      {onSelect && width > 0 ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height, flexDirection: 'row', gap }}>
          {values.map((_, i) => <Pressable key={i} style={{ flex: 1 }} onPress={() => { tap(); onSelect(i) }} />)}
        </View>
      ) : null}
      {topLabel ? null : null}
      {labels ? (
        <View style={{ flexDirection: 'row', gap, marginTop: 8 }}>
          {labels.map((l, i) => (
            <Text key={i} style={[type.unit, { width: bw, textAlign: 'center', fontSize: 9.5, color: i === hl ? color.text : color.textTertiary }]} numberOfLines={1}>{l}</Text>
          ))}
        </View>
      ) : null}
    </View>
  )
}

// ─── Lines ───

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.18
    const c1 = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t }
    const c2 = { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t }
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`
  }
  return d
}

/**
 * Smooth area chart with gradient fill, dashed average line and a glowing
 * end point. Nulls are skipped.
 */
export function AreaChart({
  values, height = 120, showAverage = true, labels, strokeWidth = 2, minSpan,
}: {
  values: (number | null)[]
  height?: number
  showAverage?: boolean
  labels?: string[]
  strokeWidth?: number
  /** Minimum vertical range, so flat data doesn't look dramatic. */
  minSpan?: number
}) {
  const id = useSvgId()
  const [width, onLayout] = useWidth()
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null)
  if (pts.length < 2) {
    return (
      <View onLayout={onLayout} style={{ height, alignItems: 'center', justifyContent: 'center', borderRadius: radius.m, backgroundColor: alpha(0.02) }}>
        <Text style={type.caption}>Not enough data yet</Text>
      </View>
    )
  }
  const rawMin = Math.min(...pts.map(p => p.v))
  const rawMax = Math.max(...pts.map(p => p.v))
  const span = Math.max(rawMax - rawMin, minSpan ?? 0) || 1
  const mid = (rawMax + rawMin) / 2
  const lo = mid - span / 2
  const pad = 10
  const x = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * (width - 8) + 4)
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2)
  const points = pts.map(p => ({ x: x(p.i), y: y(p.v) }))
  const line = smoothPath(points)
  const area = `${line} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`
  const avg = pts.reduce((a, p) => a + p.v, 0) / pts.length
  const last = points[points.length - 1]
  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <SvgGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.text} stopOpacity={0.22} />
              <Stop offset="1" stopColor={color.text} stopOpacity={0} />
            </SvgGradient>
          </Defs>
          <Path d={area} fill={`url(#${id})`} />
          {showAverage ? (
            <SvgLine x1={0} x2={width} y1={y(avg)} y2={y(avg)} stroke={alpha(0.22)} strokeDasharray="2 5" strokeWidth={1} />
          ) : null}
          <Path d={line} stroke={color.text} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={last.x} cy={last.y} r={7} fill={alpha(0.12)} />
          <Circle cx={last.x} cy={last.y} r={3.5} fill={color.text} />
        </Svg>
      ) : <View style={{ height }} />}
      {labels ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          {labels.map((l, i) => <Text key={i} style={[type.unit, { fontSize: 9.5 }]}>{l}</Text>)}
        </View>
      ) : null}
    </View>
  )
}

/** Back-compat name. */
export function LineChart({ values, height = 72, strokeWidth = 1.5 }: { values: (number | null)[]; height?: number; strokeWidth?: number }) {
  return <AreaChart values={values} height={height} strokeWidth={strokeWidth} showAverage={false} />
}

/** Minimal inline sparkline for tiles. */
export function Sparkline({ values, height = 28 }: { values: (number | null)[]; height?: number }) {
  const [width, onLayout] = useWidth()
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null)
  if (pts.length < 2) return <View onLayout={onLayout} style={{ height }} />
  const min = Math.min(...pts.map(p => p.v))
  const span = Math.max(...pts.map(p => p.v)) - min || 1
  const points = pts.map(p => ({
    x: (p.i / Math.max(1, values.length - 1)) * (width - 6) + 3,
    y: 3 + (1 - (p.v - min) / span) * (height - 6),
  }))
  const last = points[points.length - 1]
  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Path d={smoothPath(points)} stroke={alpha(0.7)} strokeWidth={1.5} fill="none" strokeLinecap="round" />
          <Circle cx={last.x} cy={last.y} r={2.5} fill={color.text} />
        </Svg>
      ) : <View style={{ height }} />}
    </View>
  )
}

/** Min–max range bar with a marker (e.g. heart rate day range). */
export function RangeBar({ min, max, value, lo, hi, height = 8 }: {
  min: number | null; max: number | null; value?: number | null; lo: number; hi: number; height?: number
}) {
  const [width, onLayout] = useWidth()
  const pos = (v: number) => ((clamp(v, lo, hi) - lo) / (hi - lo)) * width
  return (
    <View onLayout={onLayout} style={{ height: height + 6, justifyContent: 'center' }}>
      <View style={{ height, borderRadius: height, backgroundColor: alpha(0.06) }} />
      {min != null && max != null && width > 0 ? (
        <View style={{ position: 'absolute', left: pos(min), width: Math.max(height, pos(max) - pos(min)), height, borderRadius: height, backgroundColor: alpha(0.35) }} />
      ) : null}
      {value != null && width > 0 ? (
        <View style={{ position: 'absolute', left: pos(value) - (height + 6) / 2, width: height + 6, height: height + 6, borderRadius: height, backgroundColor: color.text, borderWidth: 2, borderColor: color.bg }} />
      ) : null}
    </View>
  )
}

// ─── Week strip ───

/** Centered 7-day selector; each day shows a mini ring of that day's score. */
export function WeekStrip({ days, selected, onSelect }: {
  days: { date: string; score: number | null }[]
  selected: string
  onSelect: (date: string) => void
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.l }}>
      {days.map(d => {
        const [y, m, dd] = d.date.split('-').map(Number)
        const dt = new Date(y, m - 1, dd)
        const active = d.date === selected
        return (
          <Pressable key={d.date} onPress={() => { tap(); onSelect(d.date) }}
            style={{ alignItems: 'center', gap: 6, paddingVertical: 8, width: 44, borderRadius: radius.m, backgroundColor: active ? color.inset : 'transparent', borderWidth: 1, borderColor: active ? color.hairlineStrong : 'transparent' }}>
            <Text style={[type.label, { fontSize: 9, color: active ? color.text : color.textTertiary }]}>
              {dt.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}
            </Text>
            <MiniRing value={d.score} size={30} stroke={2.5}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11, color: active ? color.text : color.textSecondary }}>{dd}</Text>
            </MiniRing>
          </Pressable>
        )
      })}
    </View>
  )
}

// ─── Sleep ───

const STAGE_ROW: Record<SleepStage, number> = { awake: 0, rem: 1, core: 2, asleep: 2, deep: 3, in_bed: 0 }
const STAGE_INK: Record<SleepStage, string> = {
  awake: alpha(0.22), rem: alpha(0.5), core: alpha(0.75), asleep: alpha(0.75), deep: color.text, in_bed: alpha(0.06),
}

/** Hypnogram: awake on top, deep at the bottom, rounded blocks. */
export function Hypnogram({ session, height = 120 }: { session: SleepSession; height?: number }) {
  const [width, onLayout] = useWidth()
  const labelW = 42
  const total = Math.max(1, (new Date(session.end_at).getTime() - new Date(session.start_at).getTime()) / 60000)
  const rowH = height / 4
  const hasStages = session.stages.some(s => s.v === 'deep' || s.v === 'rem' || s.v === 'core')
  const plotW = Math.max(0, width - labelW)
  const rows = hasStages ? ['Awake', 'REM', 'Core', 'Deep'] : ['Awake', '', 'Asleep', '']
  return (
    <View onLayout={onLayout} style={{ flexDirection: 'row' }}>
      <View style={{ width: labelW, height }}>
        {rows.map((l, r) => (
          <Text key={r} style={[type.unit, { position: 'absolute', top: rowH * r + rowH / 2 - 7, fontSize: 9 }]}>{l}</Text>
        ))}
      </View>
      {plotW > 0 ? (
        <Svg width={plotW} height={height}>
          {[0, 1, 2, 3].map(r => (
            <Rect key={r} x={0} y={rowH * r + 3} width={plotW} height={rowH - 6} rx={5} fill={alpha(0.025)} />
          ))}
          {session.stages.map((s, i) => {
            const row = hasStages ? STAGE_ROW[s.v] : (s.v === 'awake' ? 0 : 2)
            return (
              <Rect key={i} x={(s.s / total) * plotW} y={row * rowH + 4}
                width={Math.max(2, (s.d / total) * plotW)} height={rowH - 8} rx={4} fill={STAGE_INK[s.v]} />
            )
          })}
        </Svg>
      ) : null}
    </View>
  )
}

/** Stacked horizontal share bar with legend. */
export function StackBar({ parts, height = 12 }: { parts: { value: number; label: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <View>
      <View style={{ flexDirection: 'row', height, borderRadius: height, overflow: 'hidden', backgroundColor: alpha(0.06), gap: 2 }}>
        {parts.map((p, i) => p.value > 0 ? (
          <View key={p.label} style={{ flex: p.value / total, backgroundColor: LEGEND_SHADES[i % LEGEND_SHADES.length] }} />
        ) : null)}
      </View>
      <View style={{ marginTop: space.m }}>
        <Legend items={parts.map(p => ({ label: p.label, value: `${Math.round((p.value / total) * 100)}%` }))} />
      </View>
    </View>
  )
}

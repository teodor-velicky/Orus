// Orus body map — ported from Somata's anatomical torso, redrawn mono.
//
// Faint silhouette + reference anatomy; the five scored organs brighten with
// their score and glow when selected. Score callouts sit either side of the
// body with leader lines. Organs AND callouts are tappable.
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop } from 'react-native-svg'
import { alpha, color, font, ink, radius, type } from '../lib/theme'
import type { BodySystem } from '../lib/types'
import { tap } from './ui'

export interface OrganState { score: number; confidence: number }

/** Below this confidence an organ stays neutral (not enough data). */
export const MIN_CONFIDENCE = 0.15

export const ORGAN: Record<BodySystem, { organ: string; short: string }> = {
  hormonal: { organ: 'Thyroid & endocrine', short: 'Hormonal' },
  cardiovascular: { organ: 'Heart & vessels', short: 'Heart' },
  metabolic: { organ: 'Liver', short: 'Metabolic' },
  digestion: { organ: 'Stomach', short: 'Digestion' },
  gut_microbiome: { organ: 'Intestines', short: 'Gut' },
}

// viewBox: body lives in 0..240, with 60 units of callout room either side.
const VB = { x: -60, y: 0, w: 360, h: 360 }

const GLOW: Record<BodySystem, { cx: number; cy: number; r: number }> = {
  hormonal: { cx: 120, cy: 82, r: 28 },
  cardiovascular: { cx: 122, cy: 136, r: 38 },
  metabolic: { cx: 92, cy: 186, r: 36 },
  digestion: { cx: 144, cy: 184, r: 36 },
  gut_microbiome: { cx: 120, cy: 262, r: 52 },
}

/** Callout anchor in viewBox units (pill center) and side. */
const CALLOUT: Record<BodySystem, { x: number; y: number; side: 'l' | 'r' }> = {
  hormonal: { x: -24, y: 62, side: 'l' },
  metabolic: { x: -24, y: 192, side: 'l' },
  cardiovascular: { x: 264, y: 118, side: 'r' },
  digestion: { x: 264, y: 204, side: 'r' },
  gut_microbiome: { x: 264, y: 290, side: 'r' },
}

const PILL_W = 68 // viewBox units
const PILL_H = 38

export function BodyMap({ states, selected, onSelect, width }: {
  states: Partial<Record<BodySystem, OrganState>>
  selected: BodySystem | null
  onSelect: (s: BodySystem) => void
  width: number
}) {
  const scale = width / VB.w
  const height = VB.h * scale
  const sw = 1.4

  const stateOf = (id: BodySystem) => {
    const st = states[id]
    const active = !!st && st.confidence >= MIN_CONFIDENCE
    return {
      active,
      score: active ? st!.score : 0,
      isSelected: selected === id,
      dimmed: selected != null && selected !== id,
    }
  }

  const organ = (
    id: BodySystem,
    draw: (p: { stroke: string; fill: string; fillOpacity: number; detail: string }) => React.ReactNode,
  ) => {
    const { active, score, isSelected, dimmed } = stateOf(id)
    const stroke = isSelected ? color.text : active ? ink(score, 0.35) : alpha(0.2)
    return (
      <G key={id} opacity={dimmed ? 0.4 : 1}>
        <Circle cx={GLOW[id].cx} cy={GLOW[id].cy} r={GLOW[id].r * (isSelected ? 1.25 : 1)} fill={`url(#glow_${id})`} />
        {draw({
          stroke,
          fill: color.text,
          fillOpacity: active ? (isSelected ? 0.3 : 0.06 + (score / 100) * 0.14) : 0.02,
          detail: isSelected ? alpha(0.8) : alpha(active ? 0.35 : 0.15),
        })}
      </G>
    )
  }

  const outline = alpha(0.16)
  const faint = alpha(0.07)

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}>
        <Defs>
          {(Object.keys(GLOW) as BodySystem[]).map(id => {
            const { active, score, isSelected } = stateOf(id)
            const strength = isSelected ? 0.34 : active ? 0.06 + (score / 100) * 0.12 : 0
            return (
              <RadialGradient key={id} id={`glow_${id}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={color.text} stopOpacity={strength} />
                <Stop offset="60%" stopColor={color.text} stopOpacity={strength * 0.3} />
                <Stop offset="100%" stopColor={color.text} stopOpacity={0} />
              </RadialGradient>
            )
          })}
        </Defs>

        {/* Leader lines */}
        {(Object.keys(CALLOUT) as BodySystem[]).map(id => {
          const c = CALLOUT[id]
          const g = GLOW[id]
          const { isSelected } = stateOf(id)
          const x1 = c.side === 'l' ? c.x + PILL_W / 2 : c.x - PILL_W / 2
          const elbow = c.side === 'l' ? 58 : 182
          return (
            <G key={`lead_${id}`}>
              <Path
                d={`M ${x1} ${c.y} L ${elbow} ${c.y} L ${g.cx + (c.side === 'l' ? -6 : 6)} ${g.cy}`}
                stroke={isSelected ? alpha(0.7) : alpha(0.14)} strokeWidth={1} fill="none"
                strokeDasharray={isSelected ? undefined : '2 3'}
              />
              <Circle cx={g.cx + (c.side === 'l' ? -6 : 6)} cy={g.cy} r={2.2} fill={isSelected ? color.text : alpha(0.35)} />
            </G>
          )
        })}

        {/* ══ Silhouette ══ */}
        <G pointerEvents="none">
          <Ellipse cx={120} cy={34} rx={21} ry={24} stroke={outline} strokeWidth={sw} fill={alpha(0.015)} />
          <Path d="M109 55 C110 62 108 68 104 73 M131 55 C130 62 132 68 136 73" stroke={outline} strokeWidth={sw} fill="none" />
          <Path
            d="M104 73 C 94 77, 78 81, 66 92 C 56 101, 52 114, 54 130 C 56 148, 58 164, 60 180
               C 62 220, 66 256, 76 300 C 84 332, 100 346, 120 346 C 140 346, 156 332, 164 300
               C 174 256, 178 220, 180 180 C 182 164, 184 148, 186 130 C 188 114, 184 101, 174 92
               C 162 81, 146 77, 136 73"
            stroke={outline} strokeWidth={sw} fill={alpha(0.012)}
          />
          <Path d="M66 92 C 58 100, 52 112, 50 126 M174 92 C 182 100, 188 112, 190 126" stroke={faint} strokeWidth={sw} fill="none" />
          {/* Reference anatomy */}
          <Path d="M76 98 C 92 92, 106 92, 116 96 M164 98 C 148 92, 134 92, 124 96" stroke={faint} strokeWidth={sw} fill="none" />
          <Path d="M120 98 L120 158" stroke={faint} strokeWidth={sw} fill="none" />
          <Path d="M112 106 C 100 106, 88 118, 86 136 C 84 152, 88 164, 96 168 C 104 170, 110 164, 112 154 Z" stroke={faint} strokeWidth={sw} fill="none" />
          <Path d="M128 106 C 140 106, 152 118, 154 136 C 156 152, 152 164, 144 168 C 136 170, 130 164, 128 154 Z" stroke={faint} strokeWidth={sw} fill="none" />
          <Path d="M88 318 C 100 328, 140 328, 152 318" stroke={faint} strokeWidth={sw} fill="none" />
        </G>

        {/* ══ Scored organs ══ */}
        {organ('hormonal', ({ stroke, fill, fillOpacity, detail }) => (
          <>
            <Path d="M116 74 C 111 75, 108 81, 110 87 C 112 92, 116 93, 118 89 C 119 86, 119 78, 116 74 Z" stroke={stroke} strokeWidth={sw} fill={fill} fillOpacity={fillOpacity} />
            <Path d="M124 74 C 129 75, 132 81, 130 87 C 128 92, 124 93, 122 89 C 121 86, 121 78, 124 74 Z" stroke={stroke} strokeWidth={sw} fill={fill} fillOpacity={fillOpacity} />
            <Path d="M118 82 Q 120 84 122 82" stroke={detail} strokeWidth={sw} fill="none" />
          </>
        ))}
        {organ('cardiovascular', ({ stroke, fill, fillOpacity, detail }) => (
          <>
            <Path d="M124 114 C 123 106, 128 101, 134 103 M124 114 C 120 108, 114 107, 111 110" stroke={stroke} strokeWidth={sw} fill="none" />
            <Path
              d="M122 116 C 114 110, 103 112, 100 121 C 97 130, 102 140, 112 148 C 118 153, 124 156, 128 158
                 C 137 151, 143 141, 144 131 C 145 121, 139 113, 131 114 C 127 114, 124 115, 122 116 Z"
              stroke={stroke} strokeWidth={sw} fill={fill} fillOpacity={fillOpacity}
            />
            <Path d="M124 120 C 126 130, 127 142, 127 152" stroke={detail} strokeWidth={sw * 0.8} fill="none" />
          </>
        ))}
        {organ('metabolic', ({ stroke, fill, fillOpacity, detail }) => (
          <>
            <Path
              d="M66 176 C 74 166, 96 162, 114 168 C 120 170, 122 176, 119 182 C 114 192, 102 199, 88 200
                 C 78 200, 70 195, 66 188 C 64 184, 64 180, 66 176 Z"
              stroke={stroke} strokeWidth={sw} fill={fill} fillOpacity={fillOpacity}
            />
            <Path d="M96 166 C 98 176, 98 188, 96 199" stroke={detail} strokeWidth={sw * 0.8} fill="none" />
            <Ellipse cx={100} cy={198} rx={4.5} ry={3} stroke={detail} strokeWidth={sw * 0.8} fill="none" />
          </>
        ))}
        {organ('digestion', ({ stroke, fill, fillOpacity, detail }) => (
          <>
            <Path d="M126 160 C 124 152, 126 144, 130 138" stroke={stroke} strokeWidth={sw} fill="none" />
            <Path
              d="M126 164 C 132 158, 146 158, 154 166 C 162 174, 163 186, 156 194 C 150 201, 140 203, 133 198
                 C 127 194, 124 186, 125 177 C 125 172, 125 168, 126 164 Z"
              stroke={stroke} strokeWidth={sw} fill={fill} fillOpacity={fillOpacity}
            />
            <Path d="M134 170 C 140 168, 148 170, 152 175 M132 180 C 138 178, 146 180, 150 185" stroke={detail} strokeWidth={sw * 0.7} fill="none" />
          </>
        ))}
        {organ('gut_microbiome', ({ stroke, fill, fillOpacity, detail }) => (
          <>
            <Path
              d="M88 300 C 84 282, 82 258, 84 236 C 85 226, 90 220, 99 219 L 141 219 C 150 220, 155 226, 156 236
                 C 158 258, 156 282, 152 300 C 150 306, 144 309, 138 307 M 102 307 C 96 309, 90 306, 88 300"
              stroke={stroke} strokeWidth={sw} fill={fill} fillOpacity={fillOpacity * 0.6}
            />
            <Path d="M104 219 L104 226 M120 219 L120 226 M136 219 L136 226" stroke={detail} strokeWidth={sw * 0.7} fill="none" />
            <Path
              d="M96 240 C 108 234, 132 234, 144 240 C 132 248, 108 248, 96 254 C 108 262, 132 260, 144 254
                 C 132 268, 108 270, 96 268 C 106 278, 134 276, 144 268 C 134 286, 106 288, 98 282"
              stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round"
            />
          </>
        ))}
      </Svg>

      {/* Organ touch targets — native views, reliable on every platform */}
      {(Object.keys(GLOW) as BodySystem[]).map(id => {
        const g = GLOW[id]
        const r = g.r * 0.85 * scale
        return (
          <Pressable
            key={`hit_${id}`}
            accessibilityLabel={ORGAN[id].organ}
            onPress={() => { tap(); onSelect(id) }}
            style={{ position: 'absolute', left: (g.cx - VB.x) * scale - r, top: (g.cy - VB.y) * scale - r, width: r * 2, height: r * 2, borderRadius: r }}
          />
        )
      })}

      {/* Callout pills (RN views so text renders with the app fonts) */}
      {(Object.keys(CALLOUT) as BodySystem[]).map(id => {
        const c = CALLOUT[id]
        const { active, score, isSelected } = stateOf(id)
        const w = PILL_W * scale
        const h = PILL_H * scale
        return (
          <Pressable
            key={`pill_${id}`}
            onPress={() => { tap(); onSelect(id) }}
            hitSlop={6}
            style={{
              position: 'absolute',
              left: (c.x - VB.x) * scale - w / 2,
              top: (c.y - VB.y) * scale - h / 2,
              width: w, height: h,
              borderRadius: radius.s,
              borderWidth: 1,
              borderColor: isSelected ? color.text : color.hairlineStrong,
              backgroundColor: isSelected ? color.text : color.inset,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text numberOfLines={1} style={[type.label, { fontSize: 8, lineHeight: 10, letterSpacing: 1, color: isSelected ? color.bg : color.textTertiary }]}>
              {ORGAN[id].short}
            </Text>
            <Text style={{ fontFamily: font.semibold, fontSize: 15, lineHeight: 18, letterSpacing: -0.4, color: isSelected ? color.bg : active ? color.text : color.textFaint }}>
              {active ? Math.round(score) : '—'}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

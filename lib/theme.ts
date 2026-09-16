// Orus design tokens — v2 "mono panels".
//
// Bevel-style structure (centered heroes, gauges, layered rounded panels,
// dense tiles, smooth charts) rendered in pure monochrome:
//   · no hue anywhere — hierarchy comes from luminance, weight and space
//   · data intensity = white at varying opacity (`ink`)
//   · panels are raised with a faint top-lit gradient + hairline highlight
//   · Geist for everything; Geist Mono for small uppercase labels and units

export const color = {
  bg: '#050505',

  // Panels: gradient from top → bottom, plus a highlight border.
  panelTop: '#131315',
  panelBottom: '#0C0C0D',
  panel: '#0F0F11',
  inset: '#18181B', // nested wells inside panels
  insetStrong: '#212125',
  highlight: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.06)',
  hairlineStrong: 'rgba(255,255,255,0.12)',

  text: '#F5F5F4',
  textSecondary: '#A3A3A1',
  textTertiary: '#65656A',
  textFaint: '#3C3C40',

  action: '#F5F5F4',
  onAction: '#050505',

  // Back-compat aliases used by older screens
  surface: '#0F0F11',
  surfaceRaised: '#18181B',
} as const

/** White at an opacity mapped from a 0-100 value — data intensity. */
export function ink(pct: number, min = 0.2): string {
  const t = Math.max(0, Math.min(100, pct)) / 100
  return `rgba(245, 245, 244, ${(min + (1 - min) * t).toFixed(3)})`
}

export const alpha = (a: number) => `rgba(245, 245, 244, ${a})`

export const space = {
  xxs: 2,
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  screen: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

export const radius = { xs: 8, s: 12, m: 18, l: 28, pill: 999 } as const

export const font = {
  light: 'Geist_300Light',
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
  // Back-compat
  display: 'Geist_600SemiBold',
  displayItalic: 'Geist_300Light',
} as const

const tabular = ['tabular-nums'] as ('tabular-nums')[]

export const type = {
  /** Huge centered numbers inside gauges and heroes. */
  hero: { fontFamily: font.semibold, fontSize: 56, lineHeight: 60, letterSpacing: -2.2, color: color.text, fontVariant: tabular },
  /** Screen titles — centered. */
  display: { fontFamily: font.semibold, fontSize: 26, lineHeight: 32, letterSpacing: -0.8, color: color.text },
  /** Panel titles. */
  title: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3, color: color.text },
  number: { fontFamily: font.semibold, fontSize: 28, lineHeight: 32, letterSpacing: -1, color: color.text, fontVariant: tabular },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.text },
  bodyStrong: { fontFamily: font.medium, fontSize: 15, lineHeight: 22, color: color.text },
  sub: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.textSecondary },
  caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: color.textTertiary },
  /** Mono uppercase micro-label. */
  label: {
    fontFamily: font.monoMedium, fontSize: 10, lineHeight: 14, letterSpacing: 1.4,
    textTransform: 'uppercase' as const, color: color.textTertiary,
  },
  unit: { fontFamily: font.mono, fontSize: 11, lineHeight: 14, color: color.textTertiary },
  data: { fontFamily: font.medium, fontSize: 14, lineHeight: 18, color: color.text, fontVariant: tabular },
} as const

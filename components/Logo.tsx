// The Orus mark: a ring with a single bright node — same as the app icon.
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'
import { color } from '../lib/theme'

export function Logo({ size = 64 }: { size?: number }) {
  const r = size * 0.36
  const c = size / 2
  return (
    <Svg width={size} height={size}>
      <Defs>
        <LinearGradient id="orusLogo" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={color.text} stopOpacity={0.35} />
          <Stop offset="1" stopColor={color.text} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Circle cx={c} cy={c} r={r} stroke="url(#orusLogo)" strokeWidth={size * 0.055} fill="none" />
      <Circle cx={c} cy={c - r} r={size * 0.06} fill={color.text} />
    </Svg>
  )
}

// Orus UI kit v2 — mono panels. Screens should only build chrome from here.
import React, { useRef } from 'react'
import {
  ActivityIndicator, Animated, Pressable, RefreshControl, ScrollView, StyleProp,
  Text, TextInput, TextInputProps, TextStyle, View, ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { alpha, color, font, radius, space, type } from '../lib/theme'
import { firstName, useSession } from '../lib/session'

export const tap = () => Haptics.selectionAsync().catch(() => {})

type IconName = keyof typeof Ionicons.glyphMap

// ─── Layout ───

export function Screen({
  children, scroll = true, onRefresh, refreshing = false, edges = ['top'], bottomInset = 128,
}: {
  children: React.ReactNode
  scroll?: boolean
  onRefresh?: () => void
  refreshing?: boolean
  edges?: ('top' | 'bottom')[]
  bottomInset?: number
}) {
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <StatusBar style="light" />
      {/* Soft top glow — the only "light source" in the UI */}
      <LinearGradient
        colors={['rgba(255,255,255,0.055)', 'rgba(255,255,255,0)']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }}
        pointerEvents="none"
      />
      <SafeAreaView edges={edges} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: space.screen, paddingTop: space.s, paddingBottom: bottomInset }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh
              ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.textSecondary} />
              : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, paddingHorizontal: space.screen, paddingTop: space.s }}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  )
}

/** Centered screen header: optional back (left) and action (right). */
export function Header({
  eyebrow, title, right, onBack, subtitle,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  right?: React.ReactNode
  onBack?: () => void
}) {
  return (
    <View style={{ marginBottom: space.xl, marginTop: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        <View style={{ width: 44, alignItems: 'flex-start' }}>
          {onBack ? <IconButton name="chevron-back" onPress={onBack} /> : null}
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          {eyebrow ? <Text style={[type.label, { marginBottom: 4 }]} numberOfLines={1}>{eyebrow}</Text> : null}
          <Text style={[type.display, { textAlign: 'center' }]} numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={[type.sub, { textAlign: 'center', marginTop: 4 }]}>{subtitle}</Text> : null}
        </View>
        <View style={{ width: 44, alignItems: 'flex-end' }}>{right}</View>
      </View>
    </View>
  )
}

/** Centered section divider: ── LABEL ── (or label + action when `right` is given). */
export function Label({ children, right, style }: {
  children: React.ReactNode; right?: React.ReactNode; style?: StyleProp<ViewStyle>
}) {
  if (right) {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.m, paddingHorizontal: space.xs }, style]}>
        <Text style={type.label}>{children}</Text>
        {right}
      </View>
    )
  }
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.xl, marginBottom: space.m }, style]}>
      <View style={{ flex: 1, height: 1, backgroundColor: color.hairline }} />
      <Text style={type.label}>{children}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: color.hairline }} />
    </View>
  )
}

/**
 * Raised panel. Optional header row: title (+ icon) left, `action` right.
 * Tappable panels get a chevron and press feedback.
 */
export function Card({
  children, style, onPress, padded = true, title, icon, action, inset = false,
}: {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  padded?: boolean
  title?: string
  icon?: IconName
  action?: React.ReactNode
  /** Nested well inside another panel. */
  inset?: boolean
}) {
  const body = (pressed: boolean) => (
    <View style={[{
      borderRadius: inset ? radius.m : radius.l,
      borderWidth: 1,
      borderColor: inset ? color.hairline : color.highlight,
      overflow: 'hidden',
      backgroundColor: inset ? color.inset : color.panel,
    }, style]}>
      {!inset ? (
        <LinearGradient
          colors={[color.panelTop, color.panelBottom]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}
      {pressed ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: alpha(0.04) }} /> : null}
      <View style={{ padding: padded ? (inset ? space.m + 2 : space.l + 2) : 0 }}>
        {title || action ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: children ? space.l : 0, paddingHorizontal: padded ? 0 : space.l + 2, paddingTop: padded ? 0 : space.l + 2 }}>
            {icon ? <Ionicons name={icon} size={15} color={color.textSecondary} /> : null}
            {title ? <Text style={[type.title, { fontSize: 15, flex: 1 }]} numberOfLines={1}>{title}</Text> : <View style={{ flex: 1 }} />}
            {action}
            {onPress && title ? <Ionicons name="chevron-forward" size={15} color={color.textTertiary} /> : null}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  )
  if (!onPress) return body(false)
  return (
    <Pressable onPress={() => { tap(); onPress() }}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  )
}

export const Panel = Card

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: color.hairline }, style]} />
}

// ─── Controls ───

export function Button({
  label, onPress, variant = 'primary', loading = false, disabled = false, icon, style,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  loading?: boolean
  disabled?: boolean
  icon?: IconName
  style?: StyleProp<ViewStyle>
}) {
  const scale = useRef(new Animated.Value(1)).current
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
  const fg = variant === 'primary' ? color.onAction : variant === 'ghost' ? color.textSecondary : color.text
  return (
    <Animated.View style={[{ transform: [{ scale }], opacity: disabled ? 0.35 : 1 }, style]}>
      <Pressable
        onPress={() => { tap(); onPress() }}
        onPressIn={() => to(0.97)}
        onPressOut={() => to(1)}
        disabled={disabled || loading}
        style={{
          height: variant === 'ghost' ? 44 : 52,
          borderRadius: radius.pill,
          flexDirection: 'row', gap: space.s,
          alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: space.xl,
          backgroundColor: variant === 'primary' ? color.action : variant === 'secondary' ? color.inset : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: color.hairlineStrong,
        }}
      >
        {loading ? <ActivityIndicator color={fg} /> : (
          <>
            {icon ? <Ionicons name={icon} size={17} color={fg} /> : null}
            <Text style={{ color: fg, fontSize: 15, fontFamily: font.semibold, letterSpacing: -0.2 }}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  )
}

export function IconButton({ name, onPress, size = 18 }: { name: IconName; onPress: () => void; size?: number }) {
  return (
    <Pressable
      onPress={() => { tap(); onPress() }}
      hitSlop={10}
      style={({ pressed }) => ({
        width: 40, height: 40, borderRadius: 20,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: color.highlight,
        backgroundColor: pressed ? color.insetStrong : color.inset,
      })}
    >
      <Ionicons name={name} size={size} color={color.text} />
    </Pressable>
  )
}

export function Chip({ label, active = false, onPress, icon }: {
  label: string; active?: boolean; onPress?: () => void; icon?: IconName
}) {
  const inner = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: space.m + 2, paddingVertical: 7,
      borderRadius: radius.pill, borderWidth: 1,
      borderColor: active ? color.text : color.hairline,
      backgroundColor: active ? color.text : color.inset,
    }}>
      {icon ? <Ionicons name={icon} size={12} color={active ? color.bg : color.textSecondary} /> : null}
      <Text style={{ color: active ? color.bg : color.textSecondary, fontSize: 12.5, fontFamily: font.medium }}>{label}</Text>
    </View>
  )
  return onPress ? <Pressable onPress={() => { tap(); onPress() }}>{inner}</Pressable> : inner
}

export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <View style={{
      flexDirection: 'row', padding: 3, borderRadius: radius.pill,
      borderWidth: 1, borderColor: color.hairline, backgroundColor: color.inset,
    }}>
      {options.map(o => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => { tap(); onChange(o.value) }}
            style={{
              flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center',
              backgroundColor: active ? color.text : 'transparent',
            }}
          >
            <Text style={{ fontSize: 12.5, fontFamily: font.semibold, color: active ? color.bg : color.textSecondary }}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Avatar({ name, size = 28, active = false }: { name: string | null | undefined; size?: number; active?: boolean }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: active ? color.text : color.insetStrong, borderWidth: 1, borderColor: color.hairlineStrong,
    }}>
      <Text style={{ fontFamily: font.semibold, fontSize: size * 0.42, color: active ? color.bg : color.text }}>
        {(name?.trim()[0] ?? '·').toUpperCase()}
      </Text>
    </View>
  )
}

// ─── Data display ───

export function Stat({
  value, unit, label, size = 'm', align = 'center',
}: {
  value: string
  unit?: string
  label?: string
  size?: 's' | 'm' | 'l'
  align?: 'left' | 'center'
}) {
  const fontSize = size === 'l' ? 48 : size === 'm' ? 28 : 20
  return (
    <View style={{ alignItems: align === 'center' ? 'center' : 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={[type.number, { fontSize, lineHeight: fontSize * 1.15, letterSpacing: -fontSize * 0.035 }]}>{value}</Text>
        {unit ? <Text style={type.unit}>{unit}</Text> : null}
      </View>
      {label ? <Text style={[type.label, { marginTop: 3, fontSize: 9 }]}>{label}</Text> : null}
    </View>
  )
}

/** Small metric panel: icon + label, big value, optional delta and footer (sparkline). */
export function Tile({
  icon, label, value, unit, delta, footer, onPress, style,
}: {
  icon?: IconName
  label: string
  value: string
  unit?: string
  delta?: string
  footer?: React.ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const content = (pressed: boolean) => (
    <View style={[{
      flex: 1, borderRadius: radius.l, borderWidth: 1, borderColor: color.highlight,
      overflow: 'hidden', backgroundColor: color.panel, padding: space.l,
    }, style]}>
      <LinearGradient colors={[color.panelTop, color.panelBottom]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {pressed ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: alpha(0.04) }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? <Ionicons name={icon} size={13} color={color.textSecondary} /> : null}
        <Text style={[type.label, { flex: 1 }]} numberOfLines={1}>{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: space.m }}>
        <Text style={[type.number, { fontSize: 26 }]}>{value}</Text>
        {unit ? <Text style={type.unit}>{unit}</Text> : null}
      </View>
      {delta ? <Text style={[type.caption, { marginTop: 2 }]}>{delta}</Text> : null}
      {footer ? <View style={{ marginTop: space.m }}>{footer}</View> : null}
    </View>
  )
  if (!onPress) return content(false)
  return <Pressable style={{ flex: 1 }} onPress={() => { tap(); onPress() }}>{({ pressed }) => content(pressed)}</Pressable>
}

export function Row({
  label, value, sub, onPress, last = false, icon, right,
}: {
  label: string
  value?: string
  sub?: string
  onPress?: () => void
  last?: boolean
  icon?: IconName
  right?: React.ReactNode
}) {
  const content = (pressed: boolean) => (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: space.m,
      paddingVertical: space.m + 1,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: color.hairline,
      opacity: pressed ? 0.6 : 1,
    }}>
      {icon ? (
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: color.inset, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.hairline }}>
          <Ionicons name={icon} size={15} color={color.text} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={[type.caption, { marginTop: 1 }]} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {right}
      {value ? <Text style={[type.data, { color: color.textSecondary }]}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={15} color={color.textTertiary} /> : null}
    </View>
  )
  if (!onPress) return content(false)
  return <Pressable onPress={() => { tap(); onPress() }}>{({ pressed }) => content(pressed)}</Pressable>
}

export function Field(props: TextInputProps & { label?: string; suffix?: string }) {
  const { label, suffix, style, ...rest } = props
  return (
    <View style={{ marginBottom: space.l }}>
      {label ? <Text style={[type.label, { marginBottom: space.s, marginLeft: space.xs }]}>{label}</Text> : null}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: color.hairline, borderRadius: radius.m,
        backgroundColor: color.inset, paddingHorizontal: space.l,
      }}>
        <TextInput
          placeholderTextColor={color.textFaint}
          selectionColor={color.text}
          style={[{ flex: 1, color: color.text, fontSize: 15, fontFamily: font.regular, paddingVertical: 14 }, style as StyleProp<TextStyle>]}
          {...rest}
        />
        {suffix ? <Text style={type.unit}>{suffix}</Text> : null}
      </View>
    </View>
  )
}

export function Loading() {
  return (
    <View style={{ paddingVertical: 80, alignItems: 'center' }}>
      <ActivityIndicator color={color.textSecondary} />
    </View>
  )
}

export function Empty({ title, message, action, onAction, icon = 'sparkles-outline' }: {
  title: string; message?: string; action?: string; onAction?: () => void; icon?: IconName
}) {
  return (
    <Card style={{ alignItems: 'center' }}>
      <View style={{ alignItems: 'center', paddingVertical: space.l }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center', marginBottom: space.l }}>
          <Ionicons name={icon} size={22} color={color.textSecondary} />
        </View>
        <Text style={[type.title, { textAlign: 'center' }]}>{title}</Text>
        {message ? <Text style={[type.sub, { textAlign: 'center', marginTop: space.s, maxWidth: 290 }]}>{message}</Text> : null}
        {action && onAction ? (
          <Button label={action} onPress={onAction} variant="secondary" style={{ marginTop: space.xl, alignSelf: 'stretch' }} />
        ) : null}
      </View>
    </Card>
  )
}

export function Bullet({ children, glyph = '•' }: { children: React.ReactNode; glyph?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.m, marginBottom: space.s }}>
      <Text style={[type.sub, { color: color.textTertiary, width: 10 }]}>{glyph}</Text>
      <Text style={[type.sub, { flex: 1, color: color.text }]}>{children}</Text>
    </View>
  )
}

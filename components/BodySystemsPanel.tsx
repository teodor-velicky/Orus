// Body map + inline detail for the selected organ (Food tab).
import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { color, space, type } from '../lib/theme'
import { SYSTEM_INFO, SYSTEM_ORDER } from '../lib/systems'
import type { BodySystem, Pattern, SystemScore } from '../lib/types'
import { BodyMap, MIN_CONFIDENCE, ORGAN, OrganState } from './BodyMap'
import { Button, Card } from './ui'
import { Gauge, Progress } from './charts'

export function BodySystemsPanel({ systems, onOpenSystem }: {
  systems: { scores: SystemScore[]; patterns: Pattern[] } | null
  onOpenSystem: (id: BodySystem) => void
}) {
  const [width, setWidth] = useState(0)

  const states = useMemo(() => {
    const out: Partial<Record<BodySystem, OrganState>> = {}
    for (const s of systems?.scores ?? []) {
      if (s.meta.mealCount > 0) out[s.system] = { score: s.score, confidence: s.confidence }
    }
    return out
  }, [systems])

  // Default to the system that needs the most attention.
  const weakest = useMemo(() => SYSTEM_ORDER
    .filter(id => (states[id]?.confidence ?? 0) >= MIN_CONFIDENCE)
    .sort((a, b) => (states[a]!.score) - (states[b]!.score))[0] ?? null, [states])

  const [picked, setPicked] = useState<BodySystem | null>(null)
  const selected = picked ?? weakest
  const score = systems?.scores.find(s => s.system === selected)
  const hasData = !!selected && (states[selected]?.confidence ?? 0) >= MIN_CONFIDENCE

  // The two drivers costing the most points.
  const drivers = score
    ? [...score.drivers].sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score)).slice(0, 2)
    : []

  return (
    <Card>
      <View onLayout={e => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ alignItems: 'center' }}>
        {width > 0 ? <BodyMap states={states} selected={selected} onSelect={setPicked} width={width} /> : <View style={{ height: 300 }} />}
      </View>

      {selected ? (
        <Card inset style={{ marginTop: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
            <Gauge value={hasData ? score!.score : null} size={78} stroke={5} ticks={false} />
            <View style={{ flex: 1 }}>
              <Text style={type.title}>{SYSTEM_INFO[selected].name}</Text>
              <Text style={[type.caption, { marginTop: 2 }]}>
                {ORGAN[selected].organ}{hasData ? ` · ${Math.round(score!.confidence * 100)}% confidence` : ''}
              </Text>
            </View>
          </View>

          {hasData ? (
            <View style={{ marginTop: space.l, gap: space.m }}>
              {drivers.map(d => (
                <View key={d.factor}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={[type.caption, { color: color.text }]}>{d.label ?? d.factor}</Text>
                    <Text style={type.unit}>
                      {d.value != null ? `${d.value}${d.unit?.startsWith(':') ? '' : ' '}${d.unit ?? ''}` : ''}
                      {d.target != null ? ` / ${d.target}` : ''}
                    </Text>
                  </View>
                  <Progress pct={d.score} height={4} />
                </View>
              ))}
              <Button label={`Open ${SYSTEM_INFO[selected].name.toLowerCase()}`} variant="secondary" icon="arrow-forward"
                onPress={() => onOpenSystem(selected)} style={{ marginTop: space.xs }} />
            </View>
          ) : (
            <Text style={[type.sub, { marginTop: space.m }]}>
              {SYSTEM_INFO[selected].blurb} Not enough meals in this window yet.
            </Text>
          )}
        </Card>
      ) : null}
    </Card>
  )
}

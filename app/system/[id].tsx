import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { loadSystemScores, SYSTEM_INFO, systemCache } from '../../lib/systems'
import { color, space, type } from '../../lib/theme'
import { Card, Header, Label, Loading, Screen } from '../../components/ui'
import { Gauge, MetricBar, Progress } from '../../components/charts'
import type { BodySystem, Driver, SystemScore } from '../../lib/types'

function driverPct(d: Driver): number {
  if (d.value == null || d.target == null) return d.score
  if (d.lowerIsBetter) return d.score
  return d.target > 0 ? Math.min(100, (d.value / d.target) * 100) : d.score
}

export default function SystemDetail() {
  const { id, userId } = useLocalSearchParams<{ id: BodySystem; userId: string }>()
  const router = useRouter()
  const [score, setScore] = useState<SystemScore | null>(
    systemCache.get(userId)?.scores.find(s => s.system === id) ?? null,
  )

  useEffect(() => {
    if (score || !userId) return
    loadSystemScores(userId).then(r => setScore(r.scores.find(s => s.system === id) ?? null))
  }, [id, userId, score])

  const info = SYSTEM_INFO[id]
  return (
    <Screen bottomInset={space.xxxl}>
      <Header eyebrow="Body system" title={info?.name ?? id} onBack={() => router.back()} />
      {!score ? <Loading /> : (
        <>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Gauge value={score.score} size={172} stroke={10} label="Score"
                sub={`${Math.round(score.confidence * 100)}% confidence`} />
              <Text style={[type.sub, { textAlign: 'center', marginTop: space.l }]}>{info?.blurb}</Text>
              <Text style={[type.unit, { textAlign: 'center', marginTop: space.s }]}>
                {score.meta.mealCount} MEALS · {score.meta.dayCount} DAYS
              </Text>
            </View>
          </Card>

          <Label>What drives it</Label>
          {score.drivers.map(d => (
            <Card key={d.factor} style={{ marginBottom: space.s }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={type.bodyStrong}>{d.label ?? d.factor}</Text>
                <Text style={[type.data, { color: color.textSecondary }]}>
                  {d.value != null ? `${d.value}${d.unit?.startsWith(':') ? '' : ' '}${d.unit ?? ''}` : ''}
                </Text>
              </View>
              <View style={{ marginVertical: space.m }}>
                <Progress pct={driverPct(d)} height={4} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={type.caption}>
                  {d.target != null ? `${d.lowerIsBetter ? 'Keep under' : 'Target'} ${d.target} ${d.unit ?? ''}` : ''}
                </Text>
                <Text style={type.caption}>score {d.score} · weight {Math.round(d.weight * 100)}%</Text>
              </View>
              <Text style={[type.sub, { marginTop: space.m }]}>{d.note}</Text>
              {d.breakdown?.length ? (
                <View style={{ marginTop: space.l }}>
                  {d.breakdown.map(b => <MetricBar key={b.id} label={b.label} pct={b.pct} valueText={`${b.pct}%`} />)}
                </View>
              ) : null}
            </Card>
          ))}
          <Text style={[type.caption, { marginTop: space.l, textAlign: 'center' }]}>
            Scores are computed deterministically from your logged meals — the AI only extracts what's on the plate.
            Low confidence means few meals or uncertain estimates, not a bad diet.
          </Text>
        </>
      )}
    </Screen>
  )
}

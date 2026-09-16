// A single run — presentational.
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { num } from '../../lib/format'
import { paceText, raceTime } from '../../lib/run/geo'
import type { RunInsights } from '../../lib/run/analysis'
import type { Zone } from '../../lib/run/zones'
import type { RunAnalysis, RunSplit } from '../../lib/types'
import { Bullet, Button, Card, Chip, Header, Label, Screen } from '../ui'
import { AreaChart } from '../charts'
import { HrZoneChart, RouteMap, SplitsTable, ZoneBars } from '../run'

export interface RunDetailModel {
  isMe: boolean
  eyebrow: string
  title: string
  kind: string | null
  distanceM: number
  movingS: number
  elapsedS: number
  elevationM: number | null
  avgHr: number | null
  maxHr: number | null
  kcal: number | null
  trimp: number | null
  effort: number | null
  notes: string | null
  route: [number, number][]
  routeSpeeds: (number | null)[]
  insights: RunInsights
  zones: Zone[]
  zoneSeconds: number[] | null
  splits: RunSplit[]
  sourceText: string
  lite: boolean
  analysis: RunAnalysis | null
  analyzing: boolean
  canBackfillHr: boolean
  backfilling: boolean
}

export interface RunDetailHandlers {
  onBack: () => void
  onAnalyze: () => void
  onBackfillHr: () => void
  onDelete: () => void
}

const KIND_LABEL: Record<string, string> = {
  recovery: 'Recovery', easy: 'Easy', long: 'Long run', tempo: 'Tempo', intervals: 'Intervals', race: 'Race',
}

function Metric({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: space.s }}>
      <Text style={[type.number, { fontSize: 20 }]}>{value}{unit ? <Text style={type.unit}> {unit}</Text> : null}</Text>
      <Text style={[type.label, { fontSize: 9, marginTop: 2 }]}>{label}</Text>
    </View>
  )
}

export function RunDetailView({ m, h }: { m: RunDetailModel; h: RunDetailHandlers }) {
  const i = m.insights
  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow={m.eyebrow} title={m.title} onBack={h.onBack} />

      {m.route.length > 1 ? (
        <Card padded={false}>
          <RouteMap route={m.route} speeds={m.routeSpeeds} height={240} />
          {m.kind ? (
            <View style={{ position: 'absolute', top: space.m, left: space.m }}>
              <Chip label={KIND_LABEL[m.kind] ?? m.kind} active />
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* HERO */}
      <Card style={{ marginTop: m.route.length > 1 ? space.m : 0 }}>
        <View style={{ alignItems: 'center', marginBottom: space.l }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={[type.hero, { fontSize: 60, lineHeight: 64 }]}>{num(m.distanceM / 1000, 2)}</Text>
            <Text style={[type.unit, { fontSize: 14 }]}>km</Text>
          </View>
          <Text style={type.label}>Distance</Text>
        </View>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.hairline, paddingTop: space.s }}>
          <Metric value={raceTime(m.movingS)} label="Moving" />
          <Metric value={paceText(i.paceS)} unit="/km" label="Avg pace" />
          <Metric value={m.elevationM != null ? String(Math.round(m.elevationM)) : '—'} unit="m" label="Climb" />
        </View>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.hairline, paddingTop: space.s, marginTop: space.s }}>
          <Metric value={m.avgHr ? String(Math.round(m.avgHr)) : '—'} unit="bpm" label="Avg HR" />
          <Metric value={m.maxHr ? String(Math.round(m.maxHr)) : '—'} unit="bpm" label="Max HR" />
          <Metric value={m.kcal ? num(m.kcal) : '—'} label="kcal" />
          <Metric value={m.trimp ? String(Math.round(m.trimp)) : '—'} label="Load" />
        </View>
        {m.canBackfillHr ? (
          <Button label="Get heart rate from Apple Health" icon="heart-outline" variant="secondary" loading={m.backfilling} onPress={h.onBackfillHr} style={{ marginTop: space.l }} />
        ) : null}
      </Card>

      {/* EFFECT */}
      {i.effect || i.decouplingPct != null || i.splitDeltaS != null ? (
        <>
          <Label>What it trained</Label>
          <Card>
            {i.effect ? (
              <View style={{ alignItems: 'center' }}>
                <Text style={type.display}>{i.effect.label}</Text>
                <Text style={[type.sub, { textAlign: 'center', marginTop: 4 }]}>{i.effect.detail}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.s, marginTop: i.effect ? space.l : 0 }}>
              <Card inset style={{ flex: 1 }}>
                <Text style={[type.label, { textAlign: 'center', fontSize: 9 }]}>Decoupling</Text>
                <Text style={[type.number, { textAlign: 'center', fontSize: 22, marginTop: 4 }]}>{i.decouplingPct != null ? `${i.decouplingPct}%` : '—'}</Text>
                <Text style={[type.caption, { textAlign: 'center', marginTop: 2 }]}>
                  {i.decouplingPct == null ? 'needs HR + GPS' : i.decouplingPct < 5 ? 'strong aerobic base' : i.decouplingPct < 10 ? 'some drift' : 'big drift — heat, fatigue or pace'}
                </Text>
              </Card>
              <Card inset style={{ flex: 1 }}>
                <Text style={[type.label, { textAlign: 'center', fontSize: 9 }]}>2nd half</Text>
                <Text style={[type.number, { textAlign: 'center', fontSize: 22, marginTop: 4 }]}>
                  {i.splitDeltaS != null ? `${i.splitDeltaS > 0 ? '+' : ''}${i.splitDeltaS}s` : '—'}
                </Text>
                <Text style={[type.caption, { textAlign: 'center', marginTop: 2 }]}>
                  {i.splitDeltaS == null ? 'per km vs 1st half' : i.splitDeltaS <= -3 ? 'negative split' : i.splitDeltaS <= 5 ? 'even pacing' : 'faded late'}
                </Text>
              </Card>
            </View>
          </Card>
        </>
      ) : null}

      {/* CHARTS */}
      {i.speed.some(v => v != null) ? (
        <>
          <Label>Pace</Label>
          <Card>
            <AreaChart values={i.speed} height={110} minSpan={0.6} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s }}>
              <Text style={type.unit}>FASTEST KM {paceText(i.fastestSplit)}</Text>
              <Text style={type.unit}>SLOWEST {paceText(i.slowestSplit)}</Text>
            </View>
          </Card>
        </>
      ) : null}

      {i.hr.some(v => v != null) ? (
        <>
          <Label>Heart rate</Label>
          <Card>
            <HrZoneChart values={i.hr} zones={m.zones} />
          </Card>
        </>
      ) : null}

      {m.zoneSeconds ? (
        <>
          <Label>Time in zones</Label>
          <Card>
            <ZoneBars zones={m.zones} seconds={m.zoneSeconds} />
            {i.easyPct != null ? <Text style={[type.caption, { textAlign: 'center', marginTop: space.l }]}>{i.easyPct}% easy (Z1–Z2)</Text> : null}
          </Card>
        </>
      ) : null}

      {m.splits.length ? (
        <>
          <Label>Splits</Label>
          <Card>
            <SplitsTable splits={m.splits} />
          </Card>
        </>
      ) : null}

      {/* COACH */}
      <Label>Coach</Label>
      <Card>
        {m.analysis ? (
          <>
            <View style={{ alignItems: 'center', marginBottom: space.l }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center', marginBottom: space.s }}>
                <Ionicons name="sparkles-outline" size={17} color={color.text} />
              </View>
              <Text style={[type.title, { textAlign: 'center' }]}>{m.analysis.headline}</Text>
              <Text style={[type.sub, { textAlign: 'center', marginTop: 4 }]}>{m.analysis.summary}</Text>
            </View>
            {m.analysis.highlights.length ? (
              <Card inset style={{ marginBottom: space.s }}>
                <Text style={[type.label, { marginBottom: space.s }]}>Observations</Text>
                {m.analysis.highlights.map((x, k) => <Bullet key={k}>{x}</Bullet>)}
              </Card>
            ) : null}
            {m.analysis.suggestions.length ? (
              <Card inset>
                <Text style={[type.label, { marginBottom: space.s }]}>Next time</Text>
                {m.analysis.suggestions.map((x, k) => <Bullet key={k} glyph="→">{x}</Bullet>)}
              </Card>
            ) : null}
            {m.isMe ? <Button label="Re-analyze" variant="ghost" icon="refresh" onPress={h.onAnalyze} loading={m.analyzing} style={{ marginTop: space.s }} /> : null}
          </>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <Text style={[type.sub, { textAlign: 'center' }]}>
              {m.lite ? 'This run has only a summary (no GPS or heart-rate detail), so the analysis will be brief.' : 'A short read of your pacing, heart rate and how this run fits your goal.'}
            </Text>
            {m.isMe ? <Button label="Analyze run" icon="sparkles-outline" variant="secondary" onPress={h.onAnalyze} loading={m.analyzing} style={{ marginTop: space.l, alignSelf: 'stretch' }} /> : null}
          </View>
        )}
      </Card>

      {m.notes ? (
        <Card inset style={{ marginTop: space.m }}>
          <Text style={[type.sub, { textAlign: 'center' }]}>{m.notes}</Text>
        </Card>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: space.xl, gap: 6 }}>
        {m.effort ? (
          <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: alpha(0.05) }}>
            <Text style={[type.caption, { color: color.textSecondary }]}>Felt {m.effort}/10</Text>
          </View>
        ) : null}
        <Text style={[type.caption, { textAlign: 'center', color: color.textFaint, fontFamily: font.regular }]}>{m.sourceText}</Text>
      </View>
      {m.isMe && !m.lite ? <Button label="Delete run" variant="ghost" icon="trash-outline" onPress={h.onDelete} style={{ marginTop: space.m }} /> : null}
    </Screen>
  )
}

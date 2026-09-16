import { Text, View } from 'react-native'
import { color, space, type } from '../../lib/theme'
import { avg, clock, fromIso, hm, prettyDate } from '../../lib/format'
import type { SleepSession } from '../../lib/types'
import { Card, Chip, Empty, Header, Label, Screen, Stat } from '../ui'
import { Bars, Donut, Gauge, Hypnogram, Legend } from '../charts'

export interface SleepModel {
  isMe: boolean
  eyebrow: string
  nights: SleepSession[]
  selected?: SleepSession
  sourcesForNight: string[]
  targetMin: number
}

export interface SleepHandlers {
  onBack: () => void
  onSelectNight: (night: string) => void
  onPreferSource: (source: string) => void
}

function bedMinutes(n: SleepSession) {
  const d = new Date(n.start_at)
  const m = d.getHours() * 60 + d.getMinutes()
  return m < 12 * 60 ? m + 24 * 60 : m
}

const fmtClockMin = (m: number | null) =>
  m == null ? '—' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`

export function SleepView({ m, h }: { m: SleepModel; h: SleepHandlers }) {
  const night = m.selected
  const last14 = m.nights.slice(-14)
  const week = m.nights.slice(-7)
  const avg7 = avg(week.map(n => n.asleep_min))
  const beds = week.map(bedMinutes)
  const bedAvg = avg(beds)
  const consistency = beds.length > 2 && bedAvg != null
    ? Math.round(Math.sqrt(beds.reduce((a, b) => a + (b - bedAvg) ** 2, 0) / beds.length))
    : null
  const hasStages = !!night && night.deep_min + night.rem_min + night.core_min > 0

  return (
    <Screen bottomInset={space.xxxl}>
      <Header eyebrow={m.eyebrow} title={night ? prettyDate(night.night).split(',')[0] + ' night' : 'Sleep'} onBack={h.onBack} />

      {m.nights.length === 0 || !night ? (
        <Empty icon="moon-outline" title="No sleep data yet"
          message="Wear your ring or watch to bed. Sleep from the ring, Garmin or Apple Watch lands here automatically." />
      ) : (
        <>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Gauge value={(night.asleep_min / m.targetMin) * 100} size={188} stroke={10}
                display={hm(night.asleep_min)} sub={`${clock(night.start_at)} – ${clock(night.end_at)}`} label="Asleep" />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: space.xl }}>
              <Stat value={`${Math.round((night.asleep_min / m.targetMin) * 100)}%`} label="of goal" size="s" />
              <Stat value={`${Math.round((night.asleep_min / Math.max(1, night.in_bed_min)) * 100)}%`} label="Efficiency" size="s" />
              <Stat value={hm(night.awake_min)} label="Awake" size="s" />
            </View>
          </Card>

          <Label>Stages</Label>
          <Card>
            <Hypnogram session={night} height={132} />
            {hasStages ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.xl }}>
                <Donut size={112} stroke={11} parts={[
                  { label: 'Deep', value: night.deep_min }, { label: 'Core', value: night.core_min },
                  { label: 'REM', value: night.rem_min }, { label: 'Awake', value: night.awake_min },
                ]}>
                  <Text style={[type.number, { fontSize: 18 }]}>{Math.round((night.deep_min / Math.max(1, night.asleep_min)) * 100)}%</Text>
                  <Text style={type.unit}>deep</Text>
                </Donut>
                <View style={{ flex: 1, gap: space.m }}>
                  {[
                    { l: 'Deep', v: night.deep_min, ref: '13–23%' },
                    { l: 'Core', v: night.core_min, ref: '45–55%' },
                    { l: 'REM', v: night.rem_min, ref: '20–25%' },
                    { l: 'Awake', v: night.awake_min, ref: '< 10%' },
                  ].map(x => (
                    <View key={x.l} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Text style={[type.sub, { color: color.text }]}>{x.l}</Text>
                      <Text style={type.unit}>{hm(x.v)} · {Math.round((x.v / Math.max(1, night.in_bed_min)) * 100)}% <Text style={{ color: color.textFaint }}>({x.ref})</Text></Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={[type.caption, { textAlign: 'center', marginTop: space.l }]}>This source doesn't report sleep stages.</Text>
            )}
          </Card>

          <Label>Last 14 nights</Label>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: space.xl }}>
              <Stat value={hm(avg7)} label="7-night avg" size="s" />
              <Stat value={fmtClockMin(bedAvg)} label="Avg bedtime" size="s" />
              <Stat value={consistency != null ? `±${consistency}m` : '—'} label="Consistency" size="s" />
            </View>
            <Bars
              values={last14.map(n => n.asleep_min)}
              labels={last14.map(n => String(fromIso(n.night).getDate()))}
              highlight={last14.findIndex(n => n.night === night.night)}
              target={m.targetMin}
              height={120}
              onSelect={i => h.onSelectNight(last14[i].night)}
            />
            <View style={{ marginTop: space.m }}>
              <Legend items={[{ label: 'Selected night' }, { label: `Goal ${m.targetMin / 60}h (dashed)` }]} />
            </View>
          </Card>

          {m.sourcesForNight.length > 1 && m.isMe ? (
            <>
              <Label>Preferred source</Label>
              <Card>
                <Text style={[type.sub, { textAlign: 'center', marginBottom: space.m }]}>Several devices tracked this night. Which should Orus trust?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
                  {m.sourcesForNight.map(s => <Chip key={s} label={s} active={s === night.source} onPress={() => h.onPreferSource(s)} />)}
                </View>
              </Card>
            </>
          ) : null}

          <Text style={[type.caption, { textAlign: 'center', marginTop: space.xl, color: color.textFaint }]}>
            Source {night.source} · rings and watches estimate stages from motion and heart rate — trust trends over single nights.
          </Text>
        </>
      )}
    </Screen>
  )
}

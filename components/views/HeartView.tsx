import { Text, View } from 'react-native'
import { color, space, type } from '../../lib/theme'
import { avg, num, shortDate } from '../../lib/format'
import type { DailyMetrics } from '../../lib/types'
import { Card, Header, Label, Screen, Stat, Tile } from '../ui'
import { AreaChart, RangeBar } from '../charts'

export interface HeartModel {
  eyebrow: string
  metrics: DailyMetrics[]
  today?: DailyMetrics
}

function Trend({ title, unit, values, digits = 0, note, labels, minSpan }: {
  title: string; unit: string; values: (number | null)[]; digits?: number; note?: string; labels?: string[]; minSpan?: number
}) {
  const latest = [...values].reverse().find(v => v != null) ?? null
  const base = avg(values.slice(0, -1))
  const delta = latest != null && base != null ? latest - base : null
  return (
    <>
      <Label>{title}</Label>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: space.l }}>
          <Stat value={num(latest, digits)} unit={unit} label="Latest" size="m" />
          <Stat value={delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(digits || 1)}`} unit={unit} label="vs 30-day avg" size="m" />
        </View>
        <AreaChart values={values} height={120} labels={labels} minSpan={minSpan} />
        {note ? <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>{note}</Text> : null}
      </Card>
    </>
  )
}

export function HeartView({ m, onBack }: { m: HeartModel; onBack: () => void }) {
  const t = m.today
  const col = (k: keyof DailyMetrics) => m.metrics.map(x => (x[k] as number | null) ?? null)
  const kind = t?.hrv_kind ?? 'rmssd'
  const ends = m.metrics.length ? [shortDate(m.metrics[0].date), shortDate(m.metrics[m.metrics.length - 1].date)] : undefined
  const vo2 = [...col('vo2max')].reverse().find(v => v != null) ?? null

  return (
    <Screen bottomInset={space.xxxl}>
      <Header eyebrow={m.eyebrow} title="Heart" onBack={onBack} />

      <Card>
        <View style={{ alignItems: 'center' }}>
          <Stat value={num(t?.resting_hr)} unit="bpm" label="Resting heart rate" size="l" />
        </View>
        <View style={{ marginTop: space.xl }}>
          <RangeBar min={t?.hr_min ?? null} max={t?.hr_max ?? null} value={t?.hr_avg ?? null} lo={35} hi={190} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s }}>
            <Text style={type.unit}>min {num(t?.hr_min)}</Text>
            <Text style={type.unit}>avg {num(t?.hr_avg)}</Text>
            <Text style={type.unit}>max {num(t?.hr_max)}</Text>
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.m }}>
        <Tile icon="water-outline" label="SpO₂" value={num(t?.spo2_pct)} unit="%" />
        <Tile icon="leaf-outline" label="Breaths" value={num(t?.respiratory_rate, 1)} unit="/min" />
        <Tile icon="speedometer-outline" label="VO₂ max" value={num(vo2, 1)} />
      </View>

      <Trend title="Resting heart rate" unit="bpm" values={col('resting_hr')} labels={ends} minSpan={6}
        note="A jump of 5+ bpm above baseline often precedes illness or poor recovery." />
      <Trend title={`HRV · ${kind === 'sdnn' ? 'SDNN' : 'RMSSD'}`} unit="ms" labels={ends} minSpan={12}
        values={m.metrics.map(x => (x.hrv_kind === kind ? x.hrv_ms : null))}
        note={kind === 'sdnn' ? 'From Apple Health. Compare only with yourself.' : 'Nightly ring RMSSD — never mixed with watch SDNN.'} />
      <Trend title="Skin temperature" unit="°C" digits={2} values={col('skin_temp_delta_c')} labels={ends} minSpan={0.8}
        note="Deviation from your 14-night median. +0.5 °C or more can precede illness; it also tracks the menstrual cycle." />
      <Trend title="Weight" unit="kg" digits={1} values={col('weight_kg')} labels={ends} minSpan={2} />

      <Text style={[type.caption, { textAlign: 'center', marginTop: space.xl, color: color.textFaint }]}>
        {t?.sources.length ? `Today from ${t.sources.join(', ')}` : 'No heart data today yet'}
      </Text>
    </Screen>
  )
}

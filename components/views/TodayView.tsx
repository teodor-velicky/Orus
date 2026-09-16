// Today — presentational. Data comes from app/(tabs)/today.tsx (live) or
// app/preview.tsx (sample data), so the design can be checked without an account.
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { clock, hm, num } from '../../lib/format'
import type { Readiness } from '../../lib/metrics'
import type { NutritionSummary } from '../../lib/meals'
import type { DailyMetrics, SleepSession } from '../../lib/types'
import { Card, Header, IconButton, Label, Screen, Stat, Tile } from '../ui'
import { AreaChart, Bars, Donut, Gauge, Hypnogram, Legend, Progress, Sparkline, WeekStrip } from '../charts'

export interface TodayModel {
  date: string
  eyebrow: string
  title: string
  isMe: boolean
  week: { date: string; score: number | null }[]
  readiness: Readiness
  sleep: { night?: SleepSession; score: number | null; targetMin: number }
  nutrition: { summary: NutritionSummary; targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number }; runBonus?: number }
  metrics?: DailyMetrics
  trend: DailyMetrics[]
  training: {
    dayVolumes: number[]; dayLabels: string[]; sessions: number; volumeKg: number; workouts: number
    runs: number; runKm: number
    /** Training load per day (runs + gym + workouts). */
    dayLoads: number[]
    form: number | null
  }
  sources: string[]
  syncedText?: string
  ring?: { name: string; connected: boolean; battery?: number; liveHr?: number }
}

export interface TodayHandlers {
  onSelectDate: (date: string) => void
  onRefresh?: () => void
  refreshing?: boolean
  onOpenSettings: () => void
  onOpenSleep: () => void
  onOpenHeart: () => void
  onOpenFood: () => void
  onOpenTrain: () => void
  onOpenRing: () => void
}

function insight(r: Readiness): { headline: string; body: string } {
  if (r.score == null) {
    return { headline: 'Waiting for data', body: 'Sync sleep and heart data from Apple Health or your ring to unlock readiness.' }
  }
  const weakest = [...r.parts].sort((a, b) => a.score - b.score)[0]
  const why = weakest && weakest.score < 60 ? ` ${weakest.label}: ${weakest.detail}.` : ''
  if (r.score >= 80) return { headline: 'Primed', body: `Recovery markers are strong — a good day to push.${why}` }
  if (r.score >= 60) return { headline: 'Balanced', body: `Train as planned and keep intensity honest.${why}` }
  if (r.score >= 40) return { headline: 'Strained', body: `Favour easy movement and an early night.${why}` }
  return { headline: 'Recover', body: `Your body is asking for rest today.${why}` }
}

/** Three columns with a fixed centre, so gauges and the numbers under them line up. */
const SIDE = { flex: 1, alignItems: 'center' } as const
const MIDDLE = { width: 150, alignItems: 'center' } as const

export function TodayView({ m, h }: { m: TodayModel; h: TodayHandlers }) {
  const r = m.readiness
  const ins = insight(r)
  const n = m.nutrition.summary
  const t = m.nutrition.targets
  const night = m.sleep.night
  const trend14 = m.trend.slice(-14)
  const macroKcal = { p: n.protein * 4, c: n.carbs * 4, f: n.fat * 9 }

  return (
    <Screen onRefresh={h.onRefresh} refreshing={h.refreshing}>
      <Header
        eyebrow={m.eyebrow}
        title={m.title}
        right={<IconButton name="settings-outline" onPress={h.onOpenSettings} />}
      />

      {m.ring ? (
        <View style={{ alignItems: 'center', marginTop: -space.s, marginBottom: space.l }}>
          <Card inset padded={false} onPress={h.onOpenRing} style={{ borderRadius: radius.pill }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 7, paddingLeft: 12, paddingRight: 30 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m.ring.connected ? color.text : color.textFaint }} />
              <Text style={[type.caption, { color: color.textSecondary }]}>
                {m.ring.name}{m.ring.battery != null ? ` · ${m.ring.battery}%` : ''}
              </Text>
              {m.ring.liveHr ? (
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.text }}>
                  <Ionicons name="heart" size={11} color={color.text} /> {m.ring.liveHr}
                </Text>
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}

      <WeekStrip days={m.week} selected={m.date} onSelect={h.onSelectDate} />

      {/* HERO: three gauges */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={[SIDE, { marginBottom: space.s }]}>
            <Gauge value={m.sleep.score} size={84} stroke={5} ticks={false} label="Sleep"
              display={night ? hm(night.asleep_min).replace(' ', '').replace(/m$/, '') : undefined} />
          </View>
          <View style={MIDDLE}>
            <Gauge value={r.score} size={144} stroke={9} label="Readiness" />
          </View>
          <View style={[SIDE, { marginBottom: space.s }]}>
            <Gauge value={n.quality} size={84} stroke={5} ticks={false} label="Food" />
          </View>
        </View>
        <View style={{ alignItems: 'center', marginTop: space.l, paddingHorizontal: space.s }}>
          <Text style={[type.title, { textAlign: 'center' }]}>{ins.headline}</Text>
          <Text style={[type.sub, { textAlign: 'center', marginTop: 4 }]}>{ins.body}</Text>
        </View>
        {r.parts.length ? (
          <Card inset style={{ marginTop: space.l }}>
            {r.parts.map((p, i) => (
              <View key={p.key} style={{ marginBottom: i === r.parts.length - 1 ? 0 : space.m }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={[type.caption, { color: color.text, fontFamily: font.medium }]}>{p.label}</Text>
                  <Text style={type.unit}>{p.detail}</Text>
                </View>
                <Progress pct={p.score} height={4} />
              </View>
            ))}
          </Card>
        ) : null}
      </Card>

      {/* VITALS */}
      <Label>Vitals</Label>
      <View style={{ flexDirection: 'row', gap: space.m }}>
        <Tile icon="heart-outline" label="Resting HR" value={num(m.metrics?.resting_hr)} unit="bpm" onPress={h.onOpenHeart}
          footer={<Sparkline values={trend14.map(x => x.resting_hr)} />} />
        <Tile icon="pulse-outline" label="HRV" value={num(m.metrics?.hrv_ms)} unit="ms" onPress={h.onOpenHeart}
          footer={<Sparkline values={trend14.map(x => (x.hrv_kind === m.metrics?.hrv_kind ? x.hrv_ms : null))} />} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.m, marginTop: space.m }}>
        <Tile icon="footsteps-outline" label="Steps" value={num(m.metrics?.steps)}
          delta={m.metrics?.active_kcal ? `${num(m.metrics.active_kcal)} active kcal` : undefined}
          footer={<Bars values={trend14.slice(-7).map(x => x.steps)} height={28} target={8000} />} />
        <Tile icon="thermometer-outline" label="Skin temp"
          value={m.metrics?.skin_temp_delta_c != null ? `${m.metrics.skin_temp_delta_c >= 0 ? '+' : ''}${m.metrics.skin_temp_delta_c.toFixed(1)}` : '—'}
          unit="°C" delta={m.metrics?.skin_temp_c != null ? `${m.metrics.skin_temp_c.toFixed(1)} °C nightly` : 'vs 14-night baseline'}
          onPress={h.onOpenHeart}
          footer={<Sparkline values={trend14.map(x => x.skin_temp_delta_c ?? null)} />} />
      </View>

      {/* SLEEP */}
      <Label>Sleep</Label>
      <Card onPress={h.onOpenSleep}>
        <View style={{ alignItems: 'center', marginBottom: space.l }}>
          <Stat value={night ? hm(night.asleep_min) : '—'} label={night ? `${clock(night.start_at)} – ${clock(night.end_at)}` : 'No sleep recorded'} size="m" />
        </View>
        {night ? <Hypnogram session={night} height={96} /> : null}
        {night && night.deep_min + night.rem_min > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: space.l }}>
            <Stat value={hm(night.deep_min)} label="Deep" size="s" />
            <Stat value={hm(night.rem_min)} label="REM" size="s" />
            <Stat value={`${Math.round((night.asleep_min / Math.max(1, night.in_bed_min)) * 100)}%`} label="Efficiency" size="s" />
          </View>
        ) : null}
      </Card>

      {/* NUTRITION */}
      <Label>Nutrition</Label>
      <Card onPress={h.onOpenFood}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl }}>
          <Donut size={128} stroke={11} parts={[
            { label: 'Protein', value: macroKcal.p }, { label: 'Carbs', value: macroKcal.c }, { label: 'Fat', value: macroKcal.f },
          ]}>
            <Text style={[type.number, { fontSize: 24 }]}>{num(n.kcal)}</Text>
            <Text style={type.unit}>of {num(t.kcal)}</Text>
            {m.nutrition.runBonus ? <Text style={[type.unit, { fontSize: 9.5, color: color.textSecondary }]}>+{num(m.nutrition.runBonus)} run</Text> : null}
          </Donut>
          <View style={{ flex: 1, gap: space.m }}>
            {[
              { l: 'Protein', v: n.protein, t: t.protein },
              { l: 'Carbs', v: n.carbs, t: t.carbs },
              { l: 'Fat', v: n.fat, t: t.fat },
              { l: 'Fiber', v: n.fiber, t: t.fiber },
            ].map(x => (
              <View key={x.l}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={[type.caption, { color: color.text }]}>{x.l}</Text>
                  <Text style={type.unit}>{Math.round(x.v)}/{x.t}g</Text>
                </View>
                <Progress pct={(x.v / x.t) * 100} height={4} />
              </View>
            ))}
          </View>
        </View>
        <View style={{ marginTop: space.l }}>
          <Legend items={[{ label: 'Protein' }, { label: 'Carbs' }, { label: 'Fat' }]} />
        </View>
      </Card>

      {/* TRAINING */}
      <Label>Training · 7 days</Label>
      <Card onPress={h.onOpenTrain}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: space.l }}>
          <Stat value={num(m.training.runKm, 1)} unit="km" label={`${m.training.runs} runs`} size="s" />
          <Stat value={String(m.training.sessions)} label="Gym" size="s" />
          <Stat value={num(m.training.volumeKg / 1000, 1)} unit="t" label="Volume" size="s" />
          <Stat value={m.training.form != null ? `${m.training.form >= 0 ? '+' : ''}${Math.round(m.training.form)}` : '—'} label="Form" size="s" />
        </View>
        <Bars values={m.training.dayLoads.map(v => v || null)} labels={m.training.dayLabels} height={70} />
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>Daily training load · runs, gym and workouts</Text>
      </Card>

      {/* HRV TREND */}
      {trend14.some(x => x.hrv_ms != null) ? (
        <>
          <Label>HRV · 14 days</Label>
          <Card onPress={h.onOpenHeart}>
            <AreaChart values={trend14.map(x => (x.hrv_kind === m.metrics?.hrv_kind ? x.hrv_ms : null))} height={110} minSpan={10} />
          </Card>
        </>
      ) : null}

      <Text style={[type.caption, { textAlign: 'center', marginTop: space.xl, color: color.textFaint }]}>
        {m.sources.length ? m.sources.join(' · ') : 'No health sources yet'}
        {m.syncedText ? `  ·  synced ${m.syncedText}` : ''}
      </Text>
      <View style={{ height: 1, marginTop: space.l, backgroundColor: alpha(0) }} />
    </Screen>
  )
}

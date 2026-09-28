// Today — presentational. Data comes from app/(tabs)/today.tsx (live) or
// app/preview.tsx (sample data), so the design can be checked without an account.
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { clock, hm, num } from '../../lib/format'
import type { Readiness } from '../../lib/metrics'
import type { NutritionSummary } from '../../lib/meals'
import type { DailyMetrics, SleepSession } from '../../lib/types'
import type { EnergyDay } from '../../lib/energy'
import type { HealthNote, Trend } from '../../lib/insights'
import type { SleepNeed } from '../../lib/sleep'
import type { StrainTarget } from '../../lib/strain'
import { Card, Header, IconButton, Label, Screen, Stat, Tile } from '../ui'
import { AreaChart, Bars, Donut, Gauge, Hypnogram, Legend, Progress, Sparkline, WeekStrip, StackBar } from '../charts'

export interface TodayModel {
  date: string
  eyebrow: string
  title: string
  isMe: boolean
  week: { date: string; score: number | null }[]
  readiness: Readiness
  sleep: {
    night?: SleepSession; score: number | null; targetMin: number; need?: SleepNeed | null; consistency?: number | null
    /** Need for tonight so far: today's strain and naps included. */
    tonight?: SleepNeed | null
  }
  /** Show the check-in prompt when yesterday has no journal entry. */
  journalDue: boolean
  /** Day strain 0-21 and today's target band from readiness. */
  strain: { value: number; activeMin: number; target: StrainTarget | null }
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
  /** Live heart rate when the ring is streaming, and last night's resting rate. */
  heart: {
    live: number | null
    resting: number | null
    /** Last beat seen, for the seconds before the stream picks up again. */
    recent?: { value: number; minutesAgo: number } | null
    /** Recent beats, drawn under a live rate. */
    trail?: number[]
  }
  /** Skin temperature: deviation once there's a baseline, otherwise last night or live. */
  skin: { delta: number | null; nightly: number | null; live: number | null; nightsToBaseline: number }
  energy: (EnergyDay & { eaten: number }) | null
  trends: Trend[]
  notes: HealthNote[]
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
  onOpenJournal: () => void
}

function insight(r: Readiness): { headline: string; body: string } {
  if (r.score == null) {
    return { headline: 'Waiting for data', body: 'Sync sleep and heart data from Apple Health or your ring to unlock readiness.' }
  }
  const weakest = [...r.parts].sort((a, b) => a.score - b.score)[0]
  const why = weakest && weakest.score < 60 ? ` ${weakest.label}: ${weakest.detail}.` : ''
  // Same bands as WHOOP recovery: 67 and up green, 34-66 yellow, 33 and under red.
  if (r.score >= 85) return { headline: 'Primed', body: `Everything lines up. A good day for your hardest session.${why}` }
  if (r.score >= 67) return { headline: 'Recovered', body: `Your body is ready for real work today.${why}` }
  if (r.score >= 34) return { headline: 'Hold steady', body: `Train as planned and keep the intensity honest.${why}` }
  return { headline: 'Recover', body: `Your body is asking for rest today.${why}` }
}

/** Three columns with a fixed centre, so gauges and the numbers under them line up. */
const SIDE = { flex: 1, alignItems: 'center' } as const
const MIDDLE = { width: 150, alignItems: 'center' } as const

/** Under the heart rate: how live the number is, and last night's resting rate. */
function heartDelta(heart: TodayModel['heart']): string {
  const resting = heart.resting != null ? ` · resting ${Math.round(heart.resting)}` : ''
  if (heart.live != null) return `live${resting}`
  if (heart.recent) {
    const { minutesAgo: ago } = heart.recent
    return `${ago < 2 ? 'a moment ago' : ago < 60 ? `${ago} min ago` : ago < 120 ? 'an hour ago' : `${Math.round(ago / 60)} h ago`}${resting}`
  }
  return heart.resting != null ? 'last night' : 'wear the ring overnight'
}

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
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m, marginBottom: 6 }}>
                  <Text style={[type.caption, { color: color.text, fontFamily: font.medium, flexShrink: 0 }]}>
                    {p.label}{p.provisional ? <Text style={{ color: color.textTertiary, fontFamily: font.regular }}> · calibrating</Text> : null}
                  </Text>
                  <Text style={[type.unit, { flex: 1, textAlign: 'right' }]} numberOfLines={2}>{p.detail}</Text>
                </View>
                <Progress pct={p.score} height={4} />
              </View>
            ))}
            {r.calibratingNights > 0 ? (
              <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
                {r.calibratingNights} more {r.calibratingNights === 1 ? 'night' : 'nights'} with the ring until HRV and resting HR use your own baseline.
              </Text>
            ) : null}
          </Card>
        ) : null}
      </Card>

      {m.journalDue && m.isMe ? (
        <Card inset onPress={h.onOpenJournal} style={{ marginTop: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Ionicons name="book-outline" size={18} color={color.text} />
            <View style={{ flex: 1 }}>
              <Text style={type.bodyStrong}>How was yesterday?</Text>
              <Text style={type.caption}>A 20-second check-in shows which habits move your recovery.</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={color.textTertiary} />
          </View>
        </Card>
      ) : null}

      {/* VITALS */}
      <Label>Vitals</Label>
      <View style={{ flexDirection: 'row', gap: space.m }}>
        <Tile icon={m.heart.live != null || m.heart.recent ? 'heart' : 'heart-outline'}
          label={m.heart.live != null ? 'Heart rate' : m.heart.recent ? 'Heart rate' : 'Resting HR'}
          value={num(m.heart.live ?? m.heart.recent?.value ?? m.heart.resting)} unit="bpm" onPress={h.onOpenHeart}
          delta={heartDelta(m.heart)}
          footer={m.heart.live != null && (m.heart.trail?.length ?? 0) > 1
            ? <Sparkline values={m.heart.trail!.slice(-40)} />
            : <Sparkline values={trend14.map(x => x.resting_hr)} />} />
        <Tile icon="pulse-outline" label="HRV" value={num(m.metrics?.hrv_ms)} unit="ms" onPress={h.onOpenHeart}
          footer={<Sparkline values={trend14.map(x => (x.hrv_kind === m.metrics?.hrv_kind ? x.hrv_ms : null))} />} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.m, marginTop: space.m }}>
        <Tile icon="footsteps-outline" label="Steps" value={num(m.metrics?.steps)}
          delta={m.energy?.active ? `${num(m.energy.active)} active kcal` : undefined}
          footer={<Bars values={trend14.slice(-7).map(x => x.steps)} height={28} target={8000} />} />
        <Tile icon="thermometer-outline" label="Skin temp"
          value={m.skin.delta != null ? `${m.skin.delta >= 0 ? '+' : ''}${m.skin.delta.toFixed(1)}`
            : m.skin.nightly != null ? m.skin.nightly.toFixed(1) : m.skin.live != null ? m.skin.live.toFixed(1) : '—'}
          unit="°C"
          delta={m.skin.delta != null ? `vs your usual · ${m.skin.nightly?.toFixed(1)} °C`
            : m.skin.nightly != null ? `last night · baseline in ${m.skin.nightsToBaseline}`
              : m.skin.live != null ? 'live · no night yet' : 'needs a night with the ring'}
          onPress={h.onOpenHeart}
          footer={<Sparkline values={trend14.map(x => x.skin_temp_delta_c ?? null)} />} />
      </View>

      {/* STRAIN */}
      <Label>Strain</Label>
      <Card onPress={h.onOpenTrain}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl }}>
          <Gauge value={(m.strain.value / 21) * 100} size={112} stroke={7} ticks={false} display={m.strain.value.toFixed(1)} label="of 21" />
          <View style={{ flex: 1 }}>
            {m.strain.target ? (
              <>
                <Text style={type.label}>Today's target</Text>
                <Text style={[type.title, { marginTop: 2 }]}>{m.strain.target.label} · {m.strain.target.lo}–{m.strain.target.hi}</Text>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(0.06), marginTop: space.m, overflow: 'hidden' }}>
                  <View style={{ position: 'absolute', left: `${(m.strain.target.lo / 21) * 100}%`, width: `${((m.strain.target.hi - m.strain.target.lo) / 21) * 100}%`, top: 0, bottom: 0, backgroundColor: alpha(0.18) }} />
                  <View style={{ width: `${Math.min(100, (m.strain.value / 21) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: color.text }} />
                </View>
                <Text style={[type.caption, { marginTop: space.s }]}>{m.strain.target.detail}</Text>
              </>
            ) : (
              <Text style={type.sub}>Heart-rate load for the whole day, 0 to 21. Each point is harder to earn than the last.</Text>
            )}
            <Text style={[type.unit, { marginTop: space.s }]}>{m.strain.activeMin} MIN ABOVE 50% HR RESERVE</Text>
          </View>
        </View>
      </Card>

      {/* SLEEP */}
      <Label>Sleep</Label>
      <Card onPress={h.onOpenSleep}>
        <View style={{ alignItems: 'center', marginBottom: space.l }}>
          <Stat value={night ? hm(night.asleep_min) : '—'} label={night ? `${clock(night.start_at)} – ${clock(night.end_at)}` : 'No sleep recorded'} size="m" />
          {m.sleep.need ? (
            <Text style={[type.caption, { textAlign: 'center', marginTop: space.s }]}>
              Needed {hm(m.sleep.need.needMin)}: {hm(m.sleep.need.baselineMin)} baseline
              {m.sleep.need.strainMin ? ` + ${m.sleep.need.strainMin}m strain` : ''}
              {m.sleep.need.debtMin ? ` + ${m.sleep.need.debtMin}m debt` : ''}
              {m.sleep.need.napMin ? ` − ${m.sleep.need.napMin}m nap` : ''}
              {m.sleep.consistency != null ? ` · consistency ${m.sleep.consistency}%` : ''}
            </Text>
          ) : null}
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

      {m.sleep.tonight ? (
        <Card inset style={{ marginTop: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Ionicons name="moon-outline" size={16} color={color.textSecondary} />
            <Text style={[type.sub, { flex: 1, color: color.text }]}>
              Tonight, aim for {hm(m.sleep.tonight.needMin)}
              <Text style={{ color: color.textSecondary }}>
                {m.sleep.tonight.strainMin || m.sleep.tonight.debtMin || m.sleep.tonight.napMin
                  ? ` (${[
                    m.sleep.tonight.strainMin ? `+${m.sleep.tonight.strainMin}m strain` : '',
                    m.sleep.tonight.debtMin ? `+${m.sleep.tonight.debtMin}m debt` : '',
                    m.sleep.tonight.napMin ? `−${m.sleep.tonight.napMin}m nap` : '',
                  ].filter(Boolean).join(', ')})`
                  : ''}
              </Text>
            </Text>
          </View>
        </Card>
      ) : null}

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

      {/* ENERGY */}
      {m.energy ? (
        <>
          <Label>Energy</Label>
          <Card>
            <View style={{ flexDirection: 'row' }}>
              {[
                { v: num(m.energy.total), l: 'Burned' },
                { v: num(m.energy.eaten), l: 'Eaten' },
                { v: `${m.energy.eaten - m.energy.total > 0 ? '+' : ''}${num(m.energy.eaten - m.energy.total)}`, l: 'Balance' },
              ].map(x => (
                <View key={x.l} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[type.number, { fontSize: 22 }]}>{x.v}</Text>
                  <Text style={[type.label, { fontSize: 9, marginTop: 2 }]}>{x.l}</Text>
                </View>
              ))}
            </View>
            <View style={{ marginTop: space.l }}>
              <StackBar parts={[
                { label: 'Resting', value: m.energy.basal },
                { label: 'Heart rate', value: Math.max(0, m.energy.active - Math.min(m.energy.active, m.energy.fromSteps)) },
                { label: 'Steps', value: Math.min(m.energy.active, m.energy.fromSteps) },
              ]} height={10} />
            </View>
            <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
              Resting burn from your body stats, plus activity from ring heart rate and steps
              {m.energy.hrCoverage < 0.5 ? '. Wear the ring more of the day for a closer figure.' : '.'}
            </Text>
          </Card>
        </>
      ) : null}

      {/* THIS WEEK */}
      {m.trends.some(t => t.current != null) ? (
        <>
          <Label>This week</Label>
          <Card style={{ paddingVertical: space.s }}>
            {m.trends.filter(t => t.current != null).map((t, i, all) => (
              <View key={t.key} style={{
                flexDirection: 'row', alignItems: 'center', paddingVertical: space.m,
                borderBottomWidth: i === all.length - 1 ? 0 : 1, borderBottomColor: color.hairline,
              }}>
                <Text style={[type.caption, { flex: 1, color: color.text, fontFamily: font.medium }]}>{t.label}</Text>
                <Text style={[type.data, { fontSize: 15, width: 90, textAlign: 'right' }]}>{t.text}</Text>
                <View style={{ width: 86, alignItems: 'flex-end' }}>
                  {t.deltaText ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      {t.better != null ? (
                        <Ionicons name={t.better ? 'arrow-up-circle' : 'arrow-down-circle'} size={12}
                          color={t.better ? color.text : color.textTertiary} />
                      ) : null}
                      <Text style={[type.unit, { color: t.better === true ? color.text : color.textTertiary }]}>{t.deltaText}</Text>
                    </View>
                  ) : <Text style={type.unit}>new</Text>}
                </View>
              </View>
            ))}
          </Card>
          <Text style={[type.caption, { textAlign: 'center', marginTop: space.s }]}>Last 7 days vs the 7 before. Arrow up means better, whichever way the number moved.</Text>
          {m.notes.map((n, i) => (
            <Card key={i} inset style={{ marginTop: space.s }}>
              <View style={{ flexDirection: 'row', gap: space.m }}>
                <Ionicons name={n.tone === 'watch' ? 'alert-circle-outline' : n.tone === 'good' ? 'checkmark-circle-outline' : 'information-circle-outline'}
                  size={16} color={n.tone === 'good' ? color.text : color.textSecondary} />
                <Text style={[type.sub, { flex: 1, color: color.text }]}>{n.text}</Text>
              </View>
            </Card>
          ))}
        </>
      ) : null}

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

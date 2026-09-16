// Train → Running. Presentational; data from app/(tabs)/train.tsx or app/preview.tsx.
import React, { useState } from 'react'
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { num } from '../../lib/format'
import { paceText, raceTime } from '../../lib/run/geo'
import type { GoalAssessment, PlannedRun, TrainingPaces } from '../../lib/run/plan'
import type { Zone } from '../../lib/run/zones'
import { Button, Card, Chip, Empty, Label, Row } from '../ui'
import { AreaChart, Bars, Gauge } from '../charts'
import { PlanStrip, RouteMap, SESSION_ICON, ZoneBars } from '../run'

export interface RunListItem {
  id: string
  title: string
  when: string
  km: number
  durationS: number
  paceS: number | null
  avgHr: number | null
  kind: string | null
  source: string
  route: [number, number][] | null
}

export interface RunningModel {
  isMe: boolean
  recording?: { status: 'running' | 'paused' | 'acquiring'; distanceKm: number; elapsedS: number }
  hrSource: 'ring' | 'health' | 'none'
  ringName?: string
  goal: GoalAssessment | null
  plan: { days: PlannedRun[]; weekKm: number; baseKm: number }
  paces: TrainingPaces | null
  vdot: number | null
  week: { km: number; runs: number; timeS: number; paceS: number | null }
  weeks: { km: number[]; labels: string[] }
  load: { ctl: number; atl: number; tsb: number; ctlSeries: number[]; form: { label: string; detail: string } } | null
  zones: { zones: Zone[]; seconds: number[]; easyPct: number | null; maxHr: number; restingHr: number; estimated: boolean }
  records: { label: string; timeS: number; date: string; runId: string }[]
  runs: RunListItem[]
}

export interface RunningHandlers {
  /** Free run — no targets. */
  onStartRun: () => void
  /** Guided run from a recommended session. */
  onStartWorkout: (day: PlannedRun) => void
  onOpenRun: (id: string) => void
  onOpenGoal: () => void
}

/** Three columns with a fixed centre, so gauges and the numbers under them line up. */
const SIDE = { flex: 1, alignItems: 'center' } as const
const MIDDLE = { width: 150, alignItems: 'center' } as const

const HR_SOURCE_TEXT = (m: RunningModel) =>
  m.hrSource === 'ring' ? `Live heart rate from ${m.ringName ?? 'your ring'}`
    : m.hrSource === 'health' ? 'GPS from this phone · heart rate from Apple Health afterwards'
      : 'Pace and distance from GPS · pair the ring for heart-rate zones'

function PaceRow({ label, value, sub, last }: { label: string; value: string; sub: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: color.hairline }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.caption, { color: color.text, fontFamily: font.medium }]}>{label}</Text>
        <Text style={[type.unit, { fontSize: 9.5, marginTop: 1 }]}>{sub}</Text>
      </View>
      <Text style={[type.data, { fontSize: 15 }]}>{value}<Text style={type.unit}> /km</Text></Text>
    </View>
  )
}

export function RunningSection({ m, h, calendar }: { m: RunningModel; h: RunningHandlers; calendar: React.ReactNode }) {
  const [day, setDay] = useState(0)
  const d = m.plan.days[day]
  const g = m.goal
  const weekPct = m.plan.weekKm ? (m.week.km / m.plan.weekKm) * 100 : 0

  return (
    <>
      {/* HERO */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={[SIDE, { marginBottom: space.s }]}>
            <Gauge value={m.vdot ? Math.min(100, ((m.vdot - 30) / 40) * 100) : null} size={84} stroke={5} ticks={false}
              label="VDOT" display={m.vdot ? m.vdot.toFixed(0) : undefined} />
          </View>
          <View style={MIDDLE}>
            <Gauge value={weekPct} size={144} stroke={9} label="This week" display={num(m.week.km, 1)} unit="km" sub={`of ${m.plan.weekKm} km plan`} />
          </View>
          <View style={[SIDE, { marginBottom: space.s }]}>
            <Gauge value={m.load ? Math.max(0, Math.min(100, 50 + m.load.tsb * 2)) : null} size={84} stroke={5} ticks={false}
              label="Form" display={m.load ? `${m.load.tsb >= 0 ? '+' : ''}${Math.round(m.load.tsb)}` : undefined} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: space.l }}>
          {[
            { v: String(m.week.runs), l: 'Runs' },
            { v: raceTime(m.week.timeS), l: 'Time' },
            { v: paceText(m.week.paceS), l: 'Avg pace' },
          ].map((x, i) => (
            <View key={x.l} style={i === 1 ? MIDDLE : SIDE}>
              <Text style={[type.number, { fontSize: 18 }]}>{x.v}</Text>
              <Text style={[type.label, { fontSize: 9, marginTop: 2 }]}>{x.l}</Text>
            </View>
          ))}
        </View>
        {m.isMe ? (
          m.recording ? (
            <Button label={`Resume run · ${m.recording.distanceKm.toFixed(2)} km`} icon="play" onPress={h.onStartRun} style={{ marginTop: space.xl }} />
          ) : (
            <Button label="Free run" icon="navigate" variant="secondary" onPress={h.onStartRun} style={{ marginTop: space.xl }} />
          )
        ) : null}
        {m.isMe ? (
          <Text style={[type.caption, { textAlign: 'center', marginTop: space.m, paddingHorizontal: space.m }]}>
            <Ionicons name={m.hrSource === 'none' ? 'heart-dislike-outline' : 'heart-outline'} size={11} color={color.textTertiary} />{'  '}{HR_SOURCE_TEXT(m)}
          </Text>
        ) : null}
      </Card>

      {/* PLAN */}
      <Label>Recommended</Label>
      <Card>
        <PlanStrip days={m.plan.days} selected={day} onSelect={setDay} />
        {d ? (
          <Card inset style={{ marginTop: space.l }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: d.key ? color.text : color.insetStrong, marginBottom: space.m }}>
                <Ionicons name={SESSION_ICON[d.kind]} size={21} color={d.key ? color.bg : color.text} />
              </View>
              <Text style={type.label}>{day === 0 ? 'Today' : new Date(`${d.date}T12:00`).toLocaleDateString('en-US', { weekday: 'long' })}</Text>
              <Text style={[type.display, { fontSize: 22, marginTop: 2 }]}>{d.title}</Text>
              <Text style={[type.sub, { textAlign: 'center', marginTop: 4 }]}>{d.detail}</Text>
              {d.kind !== 'rest' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, marginTop: space.m }}>
                  {d.distanceKm ? <Chip label={`${num(d.distanceKm, 1)} km`} icon="resize-outline" /> : null}
                  {d.pace ? <Chip label={`${d.pace} /km`} icon="speedometer-outline" /> : null}
                  {d.zone ? <Chip label={d.zone} icon="heart-outline" /> : null}
                </View>
              ) : null}
              {d.reason ? (
                <View style={{ flexDirection: 'row', gap: 6, marginTop: space.m, paddingHorizontal: space.m, paddingVertical: 8, borderRadius: radius.s, backgroundColor: alpha(0.04) }}>
                  <Ionicons name="information-circle-outline" size={14} color={color.textSecondary} />
                  <Text style={[type.caption, { flex: 1, color: color.textSecondary }]}>{d.reason}</Text>
                </View>
              ) : null}
              {d.done ? <Text style={[type.unit, { marginTop: space.m }]}>DONE ✓</Text> : null}
              {m.isMe && d.workout && !m.recording ? (
                <Button label={day === 0 ? 'Start this run' : 'Do this run now'} icon="play" onPress={() => h.onStartWorkout(d)}
                  variant={day === 0 ? 'primary' : 'secondary'} style={{ marginTop: space.l, alignSelf: 'stretch' }} />
              ) : null}
              {d.workout && d.workout.steps.some(st => st.pace) ? (
                <Text style={[type.caption, { textAlign: 'center', marginTop: space.s }]}>
                  {d.key ? 'Guided: voice tells you when to run, recover and if you drift off pace.' : 'Guided: you\'ll hear a cue if you run faster than easy pace.'}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : null}
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
          {m.plan.weekKm} km planned · built from your last 4 weeks ({num(m.plan.baseKm, 1)} km/wk){g ? ` and ${g.title}` : ''}. Adapts to readiness.
        </Text>
      </Card>

      {/* CALENDAR */}
      {calendar}

      {/* GOAL */}
      <Label>Goal</Label>
      {g ? (
        <Card onPress={m.isMe ? h.onOpenGoal : undefined}>
          <View style={{ alignItems: 'center' }}>
            <Text style={type.label}>{g.weeksLeft != null ? `${g.weeksLeft} weeks to race` : 'No race date'}</Text>
            <Text style={[type.display, { marginTop: 2 }]}>{g.title}</Text>
            <View style={{ marginTop: space.l }}>
              <Gauge value={g.progress} size={150} stroke={8} label={g.headline}
                display={g.predictedS ? raceTime(g.predictedS) : '—'} sub={g.predictedS ? 'predicted now' : undefined} />
            </View>
            <Text style={[type.sub, { textAlign: 'center', marginTop: space.m }]}>{g.detail}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', marginTop: space.l }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={[type.number, { fontSize: 18 }]}>{paceText(g.goalPaceS)}</Text>
                <Text style={[type.label, { fontSize: 9 }]}>Goal pace</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={[type.number, { fontSize: 18 }]}>{g.goalVdot.toFixed(1)}</Text>
                <Text style={[type.label, { fontSize: 9 }]}>Needs VDOT</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={[type.number, { fontSize: 18 }]}>{g.currentVdot?.toFixed(1) ?? '—'}</Text>
                <Text style={[type.label, { fontSize: 9 }]}>You now</Text>
              </View>
            </View>
          </View>
        </Card>
      ) : (
        <Empty icon="flag-outline" title="Set a running goal" message="A sub-20 5K, a first half marathon… Orus predicts your time and builds each week toward it."
          action={m.isMe ? 'Choose a goal' : undefined} onAction={m.isMe ? h.onOpenGoal : undefined} />
      )}

      {m.paces ? (
        <>
          <Label>Your paces</Label>
          <Card style={{ paddingVertical: space.s }}>
            <PaceRow label="Easy" sub="Z2 · most of your running" value={`${paceText(m.paces.easy[0])}–${paceText(m.paces.easy[1])}`} />
            <PaceRow label="Marathon" sub="Z3 · steady" value={paceText(m.paces.marathon)} />
            <PaceRow label="Threshold" sub="Z4 · comfortably hard, 20–40 min" value={paceText(m.paces.threshold)} />
            <PaceRow label="Interval" sub="Z5 · 3–5 min reps" value={paceText(m.paces.interval)} />
            <PaceRow label="Repetition" sub="short, fast, full recovery" value={paceText(m.paces.repetition)} last />
          </Card>
          <Text style={[type.caption, { textAlign: 'center', marginTop: space.s }]}>From VDOT {m.vdot?.toFixed(1)} — your best effort in the last 8 weeks.</Text>
        </>
      ) : null}

      {/* VOLUME */}
      <Label>Weekly distance</Label>
      <Card>
        <Bars values={m.weeks.km.map(v => v || null)} labels={m.weeks.labels} height={110} target={m.plan.weekKm} formatValue={v => `${v.toFixed(0)} km`} />
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>12 weeks · dashed line is this week's plan. Grow volume ~10 % per week at most.</Text>
      </Card>

      {/* LOAD */}
      {m.load ? (
        <>
          <Label>Fitness & form</Label>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: space.l }}>
              {[
                { v: Math.round(m.load.ctl), l: 'Fitness' },
                { v: Math.round(m.load.atl), l: 'Fatigue' },
                { v: `${m.load.tsb >= 0 ? '+' : ''}${Math.round(m.load.tsb)}`, l: 'Form' },
              ].map(x => (
                <View key={x.l} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[type.number, { fontSize: 22 }]}>{x.v}</Text>
                  <Text style={[type.label, { fontSize: 9 }]}>{x.l}</Text>
                </View>
              ))}
            </View>
            <AreaChart values={m.load.ctlSeries} height={100} showAverage={false} minSpan={10} />
            <View style={{ alignItems: 'center', marginTop: space.l }}>
              <Text style={type.title}>{m.load.form.label}</Text>
              <Text style={[type.sub, { textAlign: 'center', marginTop: 2 }]}>{m.load.form.detail}</Text>
            </View>
            <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>Runs, strength sessions and other workouts all count. Form feeds your readiness score.</Text>
          </Card>
        </>
      ) : null}

      {/* ZONES */}
      <Label>Intensity · 4 weeks</Label>
      <Card>
        {m.zones.seconds.some(s => s > 0) ? (
          <>
            <ZoneBars zones={m.zones.zones} seconds={m.zones.seconds} />
            <View style={{ alignItems: 'center', marginTop: space.l }}>
              <Text style={type.title}>{m.zones.easyPct}% easy</Text>
              <Text style={[type.sub, { textAlign: 'center', marginTop: 2 }]}>
                {m.zones.easyPct != null && m.zones.easyPct >= 75
                  ? 'Close to the 80/20 split most successful runners use.'
                  : 'Aim for ~80 % of time in Z1–Z2 — easy days easier, hard days harder.'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={[type.sub, { textAlign: 'center' }]}>Runs with heart rate (ring, Garmin via Apple Health or Strava) fill in your zones.</Text>
        )}
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
          Zones: max {m.zones.maxHr} · resting {m.zones.restingHr} bpm{m.zones.estimated ? ' (estimated — set exact values in Settings)' : ''}
        </Text>
      </Card>

      {/* RECORDS */}
      {m.records.length ? (
        <>
          <Label>Best efforts</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {m.records.map(r => (
              <View key={r.label} style={{ width: '48.8%' }}>
                <Card onPress={() => h.onOpenRun(r.runId)}>
                  <Text style={[type.label, { textAlign: 'center' }]}>{r.label}</Text>
                  <Text style={[type.number, { textAlign: 'center', marginTop: 4, fontSize: 24 }]}>{raceTime(r.timeS)}</Text>
                  <Text style={[type.unit, { textAlign: 'center', marginTop: 2 }]}>{r.date.toUpperCase()}</Text>
                </Card>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* RUNS */}
      <Label>Runs</Label>
      {m.runs.length === 0 ? (
        <Empty icon="navigate-outline" title="No runs yet" message="Record with the phone + ring, or run with your Garmin — it syncs in through Apple Health or Strava." />
      ) : (
        <Card style={{ paddingVertical: space.xs }}>
          {m.runs.map((r, i) => (
            <Row key={r.id} label={r.title} last={i === m.runs.length - 1} onPress={() => h.onOpenRun(r.id)}
              sub={[r.when, raceTime(r.durationS), r.paceS ? `${paceText(r.paceS)} /km` : null, r.avgHr ? `${r.avgHr} bpm` : null, r.source].filter(Boolean).join(' · ')}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                  <View style={{ width: 44, height: 44 }}><RouteMap route={r.route ?? []} height={44} thumb /></View>
                  <Text style={[type.data, { fontSize: 15, width: 48, textAlign: 'right' }]}>{r.km.toFixed(1)}<Text style={type.unit}> km</Text></Text>
                </View>
              }
            />
          ))}
        </Card>
      )}
    </>
  )
}

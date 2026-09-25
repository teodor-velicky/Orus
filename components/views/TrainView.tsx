import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { color, radius, space, type } from '../../lib/theme'
import { duration, num, shortDate } from '../../lib/format'
import { Button, Card, Empty, Header, Label, Row, Screen, Segmented, Stat, tap } from '../ui'
import { Bars, MetricBar } from '../charts'
import { CalendarActivity, MonthCalendar } from '../run'
import { RunningHandlers, RunningModel, RunningSection } from './RunningView'

export interface TrainItem {
  key: string
  kind: 'gym' | 'workout'
  title: string
  sub: string
  icon: 'barbell-outline' | 'navigate-outline' | 'fitness-outline'
  sessionId?: string
}

export interface TrainTemplate {
  id: string
  name: string
  exercises: number
  sets: number
  /** e.g. "Chest · Shoulders · Triceps" */
  focus: string
}

export interface TrainModel {
  isMe: boolean
  templates: TrainTemplate[]
  active?: { id: string; name: string; startedAt: string }
  week: { sessions: number; sets: number; volumeKg: number; cardio: number; dayVolumes: number[]; dayLabels: string[] }
  muscles: { label: string; sets: number }[]
  lifts: { id: string; name: string; e1rm: number; sets: number }[]
  items: TrainItem[]
}

export type TrainMode = 'strength' | 'running'

export interface CalendarModel {
  month: string
  selected: string | null
  activities: CalendarActivity[]
}

export interface TrainHandlers {
  onMode: (mode: TrainMode) => void
  onMonth: (delta: number) => void
  onSelectDay: (date: string) => void
  onOpenActivity: (a: CalendarActivity) => void
  onRefresh?: () => void
  refreshing?: boolean
  starting?: boolean
  onStart: () => void
  onOpenSession: (id: string) => void
  onOpenTemplate: (id: string) => void
  onNewTemplate: () => void
  onStartTemplate: (id: string) => void
  onOpenExercise: (id: string) => void
}

function CalendarPanel({ c, h, filter }: { c: CalendarModel; h: TrainHandlers; filter: 'run' | 'gym' }) {
  const day = c.selected ? c.activities.filter(a => a.date === c.selected) : []
  return (
    <>
      <Label>Calendar</Label>
      <Card>
        <MonthCalendar month={c.month} activities={c.activities} selected={c.selected} onSelect={h.onSelectDay} onMonth={h.onMonth} filter={filter} />
        {c.selected ? (
          <Card inset style={{ marginTop: space.l, paddingVertical: day.length ? space.xs : undefined }}>
            {day.length ? day.map((a, i) => (
              <Row key={a.key} label={a.title} sub={a.sub} last={i === day.length - 1}
                icon={a.kind === 'run' ? 'navigate-outline' : a.kind === 'gym' ? 'barbell-outline' : 'fitness-outline'}
                onPress={a.runId || a.sessionId ? () => h.onOpenActivity(a) : undefined} />
            )) : (
              <Text style={[type.sub, { textAlign: 'center' }]}>
                Rest day · {new Date(`${c.selected}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </Text>
            )}
          </Card>
        ) : null}
      </Card>
    </>
  )
}

export function TrainView({ m, h, mode, running, runningHandlers, calendar }: {
  m: TrainModel
  h: TrainHandlers
  mode: TrainMode
  running: RunningModel | null
  runningHandlers: RunningHandlers
  calendar: CalendarModel
}) {
  return (
    <Screen onRefresh={h.onRefresh} refreshing={h.refreshing}>
      <Header eyebrow="Training" title="Train" />
      <View style={{ marginBottom: space.l }}>
        <Segmented options={[{ value: 'strength', label: 'Strength' }, { value: 'running', label: 'Running' }]} value={mode} onChange={h.onMode} />
      </View>

      {mode === 'running' ? (
        running ? <RunningSection m={running} h={runningHandlers} calendar={<CalendarPanel c={calendar} h={h} filter="run" />} /> : null
      ) : (
        <StrengthSection m={m} h={h} calendar={<CalendarPanel c={calendar} h={h} filter="gym" />} />
      )}
    </Screen>
  )
}

function StrengthSection({ m, h, calendar }: { m: TrainModel; h: TrainHandlers; calendar: React.ReactNode }) {
  return (
    <>
      {m.isMe ? (
        m.active ? (
          <Card onPress={() => h.onOpenSession(m.active!.id)}>
            <View style={{ alignItems: 'center', paddingVertical: space.s }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center', marginBottom: space.m }}>
                <Ionicons name="barbell" size={24} color={color.bg} />
              </View>
              <Text style={type.label}>In progress</Text>
              <Text style={[type.display, { fontSize: 22, marginTop: 4 }]}>{m.active.name}</Text>
              <Text style={[type.sub, { marginTop: 2 }]}>
                Started {new Date(m.active.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · tap to resume
              </Text>
            </View>
          </Card>
        ) : (
          <Card>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center', marginBottom: space.m }}>
                <Ionicons name="barbell-outline" size={24} color={color.text} />
              </View>
              <Text style={type.title}>Ready when you are</Text>
              <Text style={[type.sub, { marginTop: 2, marginBottom: space.l }]}>Log sets, reps and weight as you go.</Text>
              <Button label="Start gym session" onPress={h.onStart} loading={h.starting} style={{ alignSelf: 'stretch' }} />
            </View>
          </Card>
        )
      ) : null}

      {m.isMe ? (
        <>
          <Label right={m.templates.length
            ? <Pressable hitSlop={8} onPress={() => { tap(); h.onNewTemplate() }}><Text style={[type.caption, { color: color.text }]}>New</Text></Pressable>
            : undefined}>Workouts</Label>
          {m.templates.length === 0 ? (
            <Empty icon="list-outline" title="Build a workout"
              message="Save the exercises for a push day or an upper day once, then start it in a tap with last time's numbers in front of you."
              action="New workout" onAction={h.onNewTemplate} />
          ) : (
            <Card style={{ paddingVertical: space.xs }}>
              {m.templates.map((t, i) => (
                <Row key={t.id} label={t.name} sub={`${t.exercises} exercises · ${t.sets} sets${t.focus ? ` · ${t.focus}` : ''}`}
                  icon="list-outline" last={i === m.templates.length - 1}
                  onPress={() => h.onOpenTemplate(t.id)}
                  right={
                    <Pressable hitSlop={8} onPress={() => { tap(); h.onStartTemplate(t.id) }}
                      style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: color.text }}>
                      <Ionicons name="play" size={14} color={color.bg} />
                    </Pressable>
                  } />
              ))}
            </Card>
          )}
        </>
      ) : null}

      {calendar}

      <Label>Last 7 days</Label>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: space.xl }}>
          <Stat value={String(m.week.sessions)} label="Sessions" size="s" />
          <Stat value={String(m.week.sets)} label="Sets" size="s" />
          <Stat value={num(m.week.volumeKg / 1000, 1)} unit="t" label="Volume" size="s" />
          <Stat value={String(m.week.cardio)} label="Cardio" size="s" />
        </View>
        <Bars values={m.week.dayVolumes.map(v => v || null)} labels={m.week.dayLabels} height={100} />
      </Card>

      {m.muscles.length ? (
        <>
          <Label>Sets per muscle</Label>
          <Card>
            {m.muscles.map(x => <MetricBar key={x.label} label={x.label} valueText={`${x.sets} / 10–20`} pct={(x.sets / 20) * 100} />)}
            <Text style={[type.caption, { textAlign: 'center' }]}>10–20 hard sets per muscle per week is a common hypertrophy range.</Text>
          </Card>
        </>
      ) : null}

      {m.lifts.length ? (
        <>
          <Label>Lifts · estimated 1RM</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {m.lifts.map(l => (
              <Card key={l.id} onPress={() => h.onOpenExercise(l.id)} style={{ width: '100%' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.bodyStrong} numberOfLines={1}>{l.name}</Text>
                    <Text style={[type.unit, { marginTop: 3 }]}>{l.sets} SETS · 6 WEEKS</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', paddingRight: space.l }}>
                    <Text style={[type.number, { fontSize: 22 }]}>{Math.round(l.e1rm)}<Text style={type.unit}> kg</Text></Text>
                  </View>
                </View>
              </Card>
            )).slice(0, 6)}
          </View>
        </>
      ) : null}

      <Label>Activity</Label>
      {m.items.length === 0 ? (
        <Empty icon="barbell-outline" title="No training yet" message="Gym sessions plus Garmin, Apple Health and Strava workouts appear in one timeline." />
      ) : (
        <Card>
          {m.items.map((it, i) => (
            <Row key={it.key} icon={it.icon} label={it.title} sub={it.sub} last={i === m.items.length - 1}
              onPress={it.sessionId ? () => h.onOpenSession(it.sessionId!) : undefined} />
          ))}
        </Card>
      )}
      <Text style={[type.caption, { textAlign: 'center', marginTop: space.l, color: color.textFaint, borderRadius: radius.s }]}>
        Workouts recorded on both Strava and Apple Health are shown once.
      </Text>
    </>
  )
}

export const formatGymSub = (startedAt: string, sets: number, volume: number, durationS: number | null) =>
  `${shortDate(startedAt)} · ${sets} sets · ${num(volume)} kg${durationS ? ` · ${duration(durationS)}` : ' · in progress'}`

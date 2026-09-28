// Day strain and tonight's sleep need, assembled from stored data. Shared by
// Today and Sleep so both screens show the same numbers.

import { addDays, fromIso, localIso } from './format'
import { ringMinutesForDay } from './metrics'
import { gymLoad } from './run/load'
import { runDate, ZoneSettings } from './run/training'
import { dayStrain, DayStrain, StrainEvent } from './strain'
import { sleepConsistency, sleepNeed, SleepNeed } from './sleep'
import type { GymSession, GymSet, Profile, Run, SleepSession } from './types'
import type { EnergyMinute } from './energy'

type SessionWithSets = GymSession & { sets: GymSet[] }

/** Strength sessions and runs on a date, as strain events. */
export function strainEvents(date: string, sessions: SessionWithSets[], runs: Run[]): StrainEvent[] {
  const events: StrainEvent[] = []
  for (const s of sessions) {
    if (localIso(new Date(s.started_at)) !== date) continue
    const start = new Date(s.started_at).getTime()
    const end = s.ended_at ? new Date(s.ended_at).getTime() : start + 3600_000
    events.push({ start, end, muscular: true, load: gymLoad((end - start) / 1000, s.sets.filter(x => x.completed && !x.is_warmup).length) })
  }
  for (const r of runs) {
    if (runDate(r) !== date) continue
    const moving = r.moving_s ?? r.duration_s
    events.push({
      start: new Date(r.start_at).getTime(), end: new Date(r.end_at).getTime(),
      load: r.trimp ?? Math.round((moving / 60) * 1.4),
    })
  }
  return events
}

export function strainFor(o: {
  date: string
  minutes: EnergyMinute[]
  sessions: SessionWithSets[]
  runs: Run[]
  zs: ZoneSettings
  sex: Profile['sex']
}): DayStrain {
  return dayStrain({
    minutes: o.minutes,
    events: strainEvents(o.date, o.sessions, o.runs),
    restingHr: o.zs.restingHr,
    maxHr: o.zs.maxHr,
    sex: o.sex,
    dayStart: fromIso(o.date),
  })
}

/** Need and consistency for the night ending on `night`, using the previous day's strain. */
export async function sleepContext(o: {
  userId: string
  night: string
  nights: SleepSession[]
  baselineMin: number
  sessions: SessionWithSets[]
  runs: Run[]
  zs: ZoneSettings
  sex: Profile['sex']
}): Promise<{ need: SleepNeed; consistency: number | null; strainBefore: DayStrain }> {
  const dayBefore = localIso(addDays(fromIso(o.night), -1))
  const minutes = await ringMinutesForDay(o.userId, dayBefore)
  const strainBefore = strainFor({ date: dayBefore, minutes, sessions: o.sessions, runs: o.runs, zs: o.zs, sex: o.sex })
  return {
    need: sleepNeed({ baselineMin: o.baselineMin, night: o.night, previous: o.nights, strain: strainBefore.strain }),
    consistency: sleepConsistency(o.nights, o.night),
    strainBefore,
  }
}

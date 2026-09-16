// Gym logging: sessions, sets, exercise history and progression math.

import { supabase } from './supabase'
import { addDays } from './format'
import type { Exercise, GymSession, GymSet, MuscleGroup } from './types'

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', core: 'Core',
  full_body: 'Full body', cardio: 'Cardio',
}

/** Epley estimated one-rep max. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0
  if (reps === 1) return weight
  return weight * (1 + reps / 30)
}

export const setVolume = (s: Pick<GymSet, 'weight_kg' | 'reps' | 'is_warmup'>) =>
  s.is_warmup ? 0 : s.weight_kg * s.reps

export async function listExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase.from('exercises').select('*').order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as Exercise[]
}

export async function createExercise(userId: string, name: string, muscle: MuscleGroup, equipment: string) {
  const { data, error } = await supabase.from('exercises')
    .insert({ user_id: userId, name: name.trim(), muscle_group: muscle, equipment })
    .select('*').single()
  if (error) throw new Error(error.message)
  return data as Exercise
}

export async function startSession(userId: string, name: string): Promise<GymSession> {
  const { data, error } = await supabase.from('gym_sessions')
    .insert({ user_id: userId, name }).select('*').single()
  if (error) throw new Error(error.message)
  return data as GymSession
}

export async function activeSession(userId: string): Promise<GymSession | null> {
  const { data } = await supabase.from('gym_sessions').select('*')
    .eq('user_id', userId).is('ended_at', null)
    .gte('started_at', addDays(new Date(), -1).toISOString())
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  return (data as GymSession | null) ?? null
}

export async function getSession(id: string): Promise<{ session: GymSession; sets: GymSet[] } | null> {
  const [{ data: session }, { data: sets }] = await Promise.all([
    supabase.from('gym_sessions').select('*').eq('id', id).maybeSingle(),
    supabase.from('gym_sets').select('*').eq('session_id', id)
      .order('exercise_order').order('set_index'),
  ])
  if (!session) return null
  return { session: session as GymSession, sets: (sets ?? []) as GymSet[] }
}

export async function updateSession(id: string, patch: Partial<Pick<GymSession, 'name' | 'ended_at' | 'notes'>>) {
  const { error } = await supabase.from('gym_sessions').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteSession(id: string) {
  const { error } = await supabase.from('gym_sessions').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function addSet(set: Omit<GymSet, 'id' | 'created_at'>): Promise<GymSet> {
  const { data, error } = await supabase.from('gym_sets').insert(set).select('*').single()
  if (error) throw new Error(error.message)
  return data as GymSet
}

export async function updateSet(id: string, patch: Partial<GymSet>) {
  const { error } = await supabase.from('gym_sets').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteSet(id: string) {
  const { error } = await supabase.from('gym_sets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function sessionsRange(userId: string, days: number): Promise<(GymSession & { sets: GymSet[] })[]> {
  const from = addDays(new Date(), -days).toISOString()
  const { data, error } = await supabase.from('gym_sessions')
    .select('*, sets:gym_sets(*)')
    .eq('user_id', userId).gte('started_at', from)
    .order('started_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as (GymSession & { sets: GymSet[] })[]
}

/** Sets from the most recent previous session that included this exercise. */
export async function lastPerformance(userId: string, exerciseId: string, beforeSessionId: string): Promise<GymSet[]> {
  const { data } = await supabase.from('gym_sets').select('*')
    .eq('user_id', userId).eq('exercise_id', exerciseId).neq('session_id', beforeSessionId)
    .eq('completed', true)
    .order('created_at', { ascending: false }).limit(20)
  const rows = (data ?? []) as GymSet[]
  if (!rows.length) return []
  const sid = rows[0].session_id
  return rows.filter(r => r.session_id === sid).sort((a, b) => a.set_index - b.set_index)
}

export interface ExercisePoint { date: string; bestE1rm: number; topWeight: number; volume: number }

export async function exerciseHistory(userId: string, exerciseId: string): Promise<ExercisePoint[]> {
  const { data, error } = await supabase.from('gym_sets')
    .select('weight_kg, reps, is_warmup, completed, created_at, session:gym_sessions(started_at)')
    .eq('user_id', userId).eq('exercise_id', exerciseId).eq('completed', true)
    .order('created_at', { ascending: true }).limit(1000)
  if (error) throw new Error(error.message)
  const byDay = new Map<string, ExercisePoint>()
  for (const r of (data ?? []) as any[]) {
    if (r.is_warmup) continue
    const date = String(r.session?.started_at ?? r.created_at).slice(0, 10)
    const p = byDay.get(date) ?? { date, bestE1rm: 0, topWeight: 0, volume: 0 }
    p.bestE1rm = Math.max(p.bestE1rm, e1rm(Number(r.weight_kg), r.reps))
    p.topWeight = Math.max(p.topWeight, Number(r.weight_kg))
    p.volume += Number(r.weight_kg) * r.reps
    byDay.set(date, p)
  }
  return [...byDay.values()]
}

// Supabase IO for naps and the behaviour journal.

import { supabase } from './supabase'
import { addDays, localIso } from './format'
import type { Answers, DayRecord } from './journal'
import type { Nap } from './naps'

// ─── Naps ───

export interface NapRow {
  id: string
  user_id: string
  start_at: string
  end_at: string
  source: 'manual' | 'ring'
  dismissed: boolean
}

export const napOf = (r: Pick<NapRow, 'start_at' | 'end_at'>): Nap =>
  ({ start: new Date(r.start_at).getTime(), end: new Date(r.end_at).getTime() })

/** Naps that count (not dismissed), newest first. */
export async function napsRange(userId: string, days: number): Promise<NapRow[]> {
  const { data, error } = await supabase.from('naps').select('*')
    .eq('user_id', userId).eq('dismissed', false)
    .gte('start_at', addDays(new Date(), -days).toISOString())
    .order('start_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as NapRow[]
}

export async function addNap(userId: string, start: Date, end: Date): Promise<void> {
  const { error } = await supabase.from('naps').insert({
    user_id: userId, start_at: start.toISOString(), end_at: end.toISOString(), source: 'manual',
  })
  if (error) throw new Error(error.message)
}

/** Manual naps are deleted; detected ones are dismissed so detection won't re-add them. */
export async function removeNap(nap: NapRow): Promise<void> {
  const q = nap.source === 'manual'
    ? supabase.from('naps').delete().eq('id', nap.id)
    : supabase.from('naps').update({ dismissed: true }).eq('id', nap.id)
  const { error } = await q
  if (error) throw new Error(error.message)
}

/** Store naps detected by the ring, skipping any that overlap a nap already known (including dismissed ones). */
export async function saveDetectedNaps(userId: string, naps: Nap[], dayStart: Date): Promise<number> {
  if (!naps.length) return 0
  const { data } = await supabase.from('naps').select('start_at, end_at')
    .eq('user_id', userId)
    .gte('start_at', dayStart.toISOString())
    .lt('start_at', addDays(dayStart, 1).toISOString())
  const known = ((data ?? []) as Pick<NapRow, 'start_at' | 'end_at'>[]).map(napOf)
  const fresh = naps.filter(n => !known.some(k => n.start < k.end && n.end > k.start))
  if (!fresh.length) return 0
  const { error } = await supabase.from('naps').insert(fresh.map(n => ({
    user_id: userId, start_at: new Date(n.start).toISOString(), end_at: new Date(n.end).toISOString(), source: 'ring',
  })))
  if (error) throw new Error(error.message)
  return fresh.length
}

// ─── Journal ───

export async function getEntry(userId: string, date: string): Promise<{ answers: Answers; note: string | null } | null> {
  const { data } = await supabase.from('journal_entries').select('behaviors, note')
    .eq('user_id', userId).eq('date', date).maybeSingle()
  return data ? { answers: (data.behaviors ?? {}) as Answers, note: data.note as string | null } : null
}

export async function saveEntry(userId: string, date: string, answers: Answers, note: string | null): Promise<void> {
  const { error } = await supabase.from('journal_entries').upsert(
    { user_id: userId, date, behaviors: answers, note: note?.trim() || null, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,date' },
  )
  if (error) throw new Error(error.message)
}

export async function entriesRange(userId: string, days: number): Promise<DayRecord[]> {
  const { data, error } = await supabase.from('journal_entries').select('date, behaviors')
    .eq('user_id', userId).gte('date', localIso(addDays(new Date(), -days)))
    .order('date')
  if (error) throw new Error(error.message)
  return ((data ?? []) as { date: string; behaviors: Answers }[]).map(r => ({ date: r.date, answers: r.behaviors ?? {} }))
}

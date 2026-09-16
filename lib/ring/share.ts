// Live vitals between partners over a private Supabase Realtime broadcast
// channel ("circle:<id>"). Nothing is stored; RLS on realtime.messages
// restricts the topic to members of that circle.

import { useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import type { RingLiveState } from './live'

export interface PartnerVitals { userId: string; hr: number | null; hrv: number | null; skinTemp: number | null; at: number }

let channel: RealtimeChannel | null = null
let channelTopic: string | null = null
let me: string | null = null
let lastSent = 0
const listeners = new Set<(v: PartnerVitals) => void>()

async function ensureChannel(circleId: string): Promise<RealtimeChannel> {
  const topic = `circle:${circleId}`
  if (channel && channelTopic === topic) return channel
  if (channel) await supabase.removeChannel(channel)
  const { data } = await supabase.auth.getSession()
  if (data.session) await supabase.realtime.setAuth(data.session.access_token)
  channelTopic = topic
  // Handlers must be bound before subscribe(); dispatch to hook listeners.
  channel = supabase
    .channel(topic, { config: { private: true, broadcast: { self: false } } })
    .on('broadcast', { event: 'vitals' }, ({ payload }) => listeners.forEach(l => l(payload as PartnerVitals)))
  channel.subscribe()
  return channel
}

/** Called once the session knows the circle, so the ring service can broadcast. */
export function configureSharing(circleId: string | null, userId: string | null) {
  me = userId
  if (circleId) ensureChannel(circleId).catch(() => {})
}

/** Throttled to one message per 5 s. */
export function broadcastVitals(s: RingLiveState) {
  if (!channel || !me || Date.now() - lastSent < 5_000) return
  lastSent = Date.now()
  const payload: PartnerVitals = {
    userId: me,
    hr: s.hr?.value ?? null,
    hrv: s.hrv?.value ?? null,
    skinTemp: s.skinTemp?.value ?? null,
    at: Date.now(),
  }
  channel.send({ type: 'broadcast', event: 'vitals', payload }).catch(() => {})
}

/** Latest live vitals from other circle members (dropped after 30 s of silence). */
export function usePartnerVitals(circleId: string | null | undefined): Record<string, PartnerVitals> {
  const [vitals, setVitals] = useState<Record<string, PartnerVitals>>({})
  useEffect(() => {
    if (!circleId) return
    ensureChannel(circleId).catch(() => {})
    const onVitals = (v: PartnerVitals) => setVitals(prev => ({ ...prev, [v.userId]: v }))
    listeners.add(onVitals)
    const t = setInterval(() => {
      setVitals(prev => Object.fromEntries(Object.entries(prev).filter(([, v]) => Date.now() - v.at < 30_000)))
    }, 5_000)
    return () => { listeners.delete(onVitals); clearInterval(t) }
  }, [circleId])
  return vitals
}

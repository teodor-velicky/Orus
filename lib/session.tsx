// Session context: auth, own profile, circle members and "whose data am I
// looking at". Screens read `viewing` and pass `viewing.id` to queries; RLS
// guarantees only self + circle members are readable.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Circle, Profile } from './types'

interface SessionState {
  loading: boolean
  session: Session | null
  me: Profile | null
  circle: Circle | null
  /** Everyone in the circle including me, me first. */
  people: Profile[]
  partner: Profile | null
  /** Whose data the dashboards show — always you; the Us tab does the comparing. */
  viewing: Profile | null
  isMe: boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Profile | null>(null)
  const [circle, setCircle] = useState<Circle | null>(null)
  const [people, setPeople] = useState<Profile[]>([])

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setMe(null); setCircle(null); setPeople([])
      return
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setMe(profile as Profile | null)
    if (profile?.circle_id) {
      const [{ data: c }, { data: members }] = await Promise.all([
        supabase.from('circles').select('*').eq('id', profile.circle_id).maybeSingle(),
        supabase.from('profiles').select('*').eq('circle_id', profile.circle_id),
      ])
      setCircle(c as Circle | null)
      const others = ((members ?? []) as Profile[]).filter(m => m.id !== s.user.id)
      setPeople([profile as Profile, ...others])
    } else {
      setCircle(null)
      setPeople(profile ? [profile as Profile] : [])
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await load(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: supabase calls inside this callback can deadlock the auth lock.
        setTimeout(() => { load(s) }, 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const refresh = useCallback(() => load(session), [load, session])

  const value = useMemo<SessionState>(() => {
    return {
      loading, session, me, circle, people,
      partner: people.find(p => p.id !== me?.id) ?? null,
      viewing: me,
      isMe: !!me,
      refresh,
    }
  }, [loading, session, me, circle, people, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}

export function firstName(p: Profile | null | undefined): string {
  return p?.name?.trim().split(/\s+/)[0] || 'You'
}

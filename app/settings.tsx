import { useCallback, useEffect, useState } from 'react'
import { Alert, Share } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { firstName, useSession } from '../lib/session'
import { isHealthAvailable, lastHealthSync, requestHealthAccess, syncHealth } from '../lib/health'
import {
  canConnectStrava, connectStrava, disconnectStrava, isStravaConfigured, StravaStatus, stravaStatus, syncStrava,
} from '../lib/strava'
import { isExpoGo } from '../lib/env'
import { kcalTarget, proteinTarget } from '../lib/targets'
import { useRing } from '../lib/ring/live'
import { timeAgo } from '../lib/format'
import { metricsRange } from '../lib/metrics'
import { recomputeZones } from '../lib/run/data'
import { zoneSettings } from '../lib/run/training'
import type { DailyMetrics, Profile } from '../lib/types'
import { SettingsView } from '../components/views/SettingsView'

export default function Settings() {
  const router = useRouter()
  const { me, session, circle, partner, refresh } = useSession()
  const ring = useRing()
  const [form, setForm] = useState({
    goal: (me?.goal ?? 'maintain') as Profile['goal'],
    kcal: me?.kcal_target ? String(me.kcal_target) : '',
    protein: me?.protein_target_g ? String(me.protein_target_g) : '',
    sleepH: String((me?.sleep_target_min ?? 480) / 60),
    weight: me?.weight_kg ? String(me.weight_kg) : '',
    maxHr: me?.max_hr ? String(me.max_hr) : '',
    restingHr: me?.resting_hr ? String(me.resting_hr) : '',
  })
  const [metrics, setMetrics] = useState<DailyMetrics[]>([])
  useEffect(() => { if (me) metricsRange(me.id, 14).then(setMetrics).catch(() => {}) }, [me])
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [strava, setStrava] = useState<StravaStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const loadStatus = useCallback(() => {
    lastHealthSync().then(setLastSync)
    if (isStravaConfigured()) stravaStatus().then(setStrava).catch(() => setStrava(null))
  }, [])
  useEffect(loadStatus, [loadStatus])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try { await fn() } catch (e) { Alert.alert('Something went wrong', (e as Error).message) }
    setBusy(null)
    loadStatus()
  }

  const n = (s: string) => { const v = parseFloat(s.replace(',', '.')); return isFinite(v) && v > 0 ? v : null }
  const auto = zoneSettings(me ? { ...me, max_hr: null, resting_hr: null } : null, metrics)
  const hrIn = (s: string, lo: number, hi: number) => { const v = n(s); return v && v >= lo && v <= hi ? Math.round(v) : null }
  const zones = zoneSettings(me ? { ...me, max_hr: hrIn(form.maxHr, 120, 230), resting_hr: hrIn(form.restingHr, 30, 100) } : null, metrics).zones

  return (
    <SettingsView
      m={{
        name: me?.name ?? firstName(me),
        email: session?.user.email,
        age: me?.birth_year ? new Date().getFullYear() - me.birth_year : undefined,
        heightCm: me?.height_cm ?? undefined,
        sex: me?.sex,
        ...form,
        kcalAuto: kcalTarget(me ? { ...me, kcal_target: null } : null),
        proteinAuto: proteinTarget(me ? { ...me, protein_target_g: null } : null),
        maxHrAuto: auto.maxHr,
        restingHrAuto: auto.restingHr,
        zones,
        health: {
          available: isHealthAvailable(),
          lastSync: timeAgo(lastSync),
          note: isExpoGo ? 'NEEDS THE INSTALLED APP' : 'UNAVAILABLE ON THIS DEVICE',
        },
        strava: {
          state: !isStravaConfigured() ? 'unconfigured'
            : strava?.connected ? 'connected'
              : !canConnectStrava() ? 'unavailable' : 'disconnected',
          athlete: strava?.athleteName,
          lastSync: strava?.lastSyncAt ? timeAgo(strava.lastSyncAt) : undefined,
        },
        ring: {
          name: ring.device?.name,
          status: ring.device
            ? `${ring.status}${ring.battery ? ` · ${ring.battery.pct}%` : ''}`
            : isExpoGo ? 'Needs the installed app' : 'Optional · tap to pair',
        },
        circle: circle ? { code: circle.invite_code, partner: partner ? firstName(partner) : null } : undefined,
        busy,
      }}
      h={{
        onBack: () => router.back(),
        onChange: patch => setForm(f => ({ ...f, ...patch })),
        onSave: () => run('save', async () => {
          if (!me) return
          const { error } = await supabase.from('profiles').update({
            kcal_target: n(form.kcal) ? Math.round(n(form.kcal)!) : null,
            protein_target_g: n(form.protein) ? Math.round(n(form.protein)!) : null,
            sleep_target_min: Math.round((n(form.sleepH) ?? 8) * 60),
            weight_kg: n(form.weight) ?? me.weight_kg,
            goal: form.goal,
            max_hr: hrIn(form.maxHr, 120, 230),
            resting_hr: hrIn(form.restingHr, 30, 100),
            updated_at: new Date().toISOString(),
          }).eq('id', me.id)
          if (error) throw error
          // New HR settings → re-bucket stored runs into the new zones.
          if (hrIn(form.maxHr, 120, 230) !== (me.max_hr ?? null) || hrIn(form.restingHr, 30, 100) !== (me.resting_hr ?? null)) {
            await recomputeZones(me.id)
          }
          await refresh()
          Alert.alert('Saved')
        }),
        onHealthSync: () => run('health', async () => {
          if (!me) return
          await requestHealthAccess()
          const r = await syncHealth(me.id, 60)
          Alert.alert('Apple Health synced', `${r.days} days · ${r.nights} nights · ${r.workouts} workouts`)
        }),
        onStravaConnect: () => run('strava', async () => {
          const r = await connectStrava()
          if (r) Alert.alert('Strava connected', `${r.imported} activities imported`)
        }),
        onStravaSync: () => run('strava-sync', async () => {
          const r = await syncStrava(60)
          if (me) await recomputeZones(me.id, true)
          Alert.alert('Strava', `${r.imported} activities synced`)
        }),
        onStravaDisconnect: () => run('strava-off', disconnectStrava),
        onOpenRing: () => router.push('/ring'),
        onShareCode: () => { if (circle) Share.share({ message: `Join me on Orus with code ${circle.invite_code}` }) },
        onLeave: () => Alert.alert('Leave shared space?', 'You will stop seeing each other’s data.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => run('leave', async () => { await supabase.rpc('leave_circle'); await refresh() }) },
        ]),
        onSignOut: () => supabase.auth.signOut(),
      }}
    />
  )
}

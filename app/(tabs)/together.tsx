import { useCallback, useState } from 'react'
import { Alert, Share, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { firstName, useSession } from '../../lib/session'
import { metricsRange, pickNights, readiness, sleepRange } from '../../lib/metrics'
import { mealsForDay, plantsThisWeek, summarize } from '../../lib/meals'
import { sessionsRange, setVolume } from '../../lib/gym'
import { addDays, avg, lastNDates, localIso, weekdayShort } from '../../lib/format'
import { trainingSnapshot } from '../../lib/run/data'
import { runDate } from '../../lib/run/training'
import { color, font, space, type } from '../../lib/theme'
import { Button, Card, Field, Header, Screen } from '../../components/ui'
import { usePartnerVitals } from '../../lib/ring/share'
import { PersonStats, TogetherView } from '../../components/views/TogetherView'
import type { Profile } from '../../lib/types'

async function statsFor(p: Profile): Promise<PersonStats> {
  const today = localIso()
  const [metrics, sleep, meals, sessions, plants] = await Promise.all([
    metricsRange(p.id, 29), sleepRange(p.id, 8), mealsForDay(p.id, today), sessionsRange(p.id, 7), plantsThisWeek(p.id),
  ])
  const training = await trainingSnapshot(p, metrics)
  const from7 = localIso(addDays(new Date(), -6))
  const weekRuns = training.runs.filter(r => runDate(r) >= from7)
  const nights = pickNights(sleep, p.preferred_sleep_source)
  const lastNight = nights.find(n => n.night === today)
  const t = metrics.find(m => m.date === today)
  const n = summarize(meals)
  return {
    readiness: readiness(lastNight, metrics, p.sleep_target_min, today, training.loads[training.loads.length - 1]).score,
    lastSleep: lastNight?.asleep_min ?? null,
    sleep7: avg(nights.slice(-7).map(x => x.asleep_min)),
    sleepNights: lastNDates(7).map(d => nights.find(x => x.night === d)?.asleep_min ?? null),
    rhr: t?.resting_hr ?? null,
    hrv: t?.hrv_ms ?? null,
    steps: t?.steps ?? null,
    kcal: n.kcal,
    protein: n.protein,
    quality: n.quality,
    plants: plants.length,
    sessions: sessions.length,
    volume: sessions.reduce((a, s) => a + s.sets.filter(x => x.completed).reduce((b, x) => b + setVolume(x), 0), 0),
    runKm: weekRuns.reduce((a, r) => a + r.distance_m, 0) / 1000,
    runs: weekRuns.length,
    fitness: training.loads[training.loads.length - 1]?.ctl ?? null,
  }
}

export default function Together() {
  const { me, partner, circle, refresh } = useSession()
  const [stats, setStats] = useState<{ me: PersonStats; partner: PersonStats } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const live = usePartnerVitals(circle?.id)
  const partnerLive = partner ? live[partner.id] : undefined

  const load = useCallback(async () => {
    if (!me || !partner) return
    const [a, b] = await Promise.all([statsFor(me), statsFor(partner)])
    setStats({ me: a, partner: b })
  }, [me, partner])

  useFocusEffect(useCallback(() => { load().catch(console.warn) }, [load]))

  const rpc = async (fn: 'create_circle' | 'join_circle', args: Record<string, string>) => {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return Alert.alert('Something went wrong', error.message)
    refresh()
  }

  if (!partner) {
    return (
      <Screen>
        <Header eyebrow="Together" title="Us" />
        <Card>
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center', marginBottom: space.l }}>
              <Ionicons name="people-outline" size={26} color={color.text} />
            </View>
            {circle ? (
              <>
                <Text style={type.title}>Invite your person</Text>
                <Text style={[type.sub, { textAlign: 'center', marginTop: space.xs }]}>
                  Once they join, you'll see each other's dashboards side by side.
                </Text>
                <Text style={{ fontFamily: font.semibold, fontSize: 40, letterSpacing: 10, color: color.text, marginVertical: space.xl }}>
                  {circle.invite_code}
                </Text>
                <Button label="Share code" icon="share-outline" style={{ alignSelf: 'stretch' }}
                  onPress={() => Share.share({ message: `Join me on Orus with code ${circle.invite_code}` })} />
                <Button label="Refresh" variant="ghost" onPress={refresh} style={{ marginTop: space.s }} />
              </>
            ) : (
              <>
                <Text style={type.title}>Better together</Text>
                <Text style={[type.sub, { textAlign: 'center', marginTop: space.xs, marginBottom: space.xl }]}>
                  Create a shared space and send the code, or join your partner's.
                </Text>
                <Button label="Create a shared space" onPress={() => rpc('create_circle', { circle_name: 'Us' })} loading={busy} style={{ alignSelf: 'stretch' }} />
                <View style={{ height: space.xl }} />
                <View style={{ alignSelf: 'stretch' }}>
                  <Field value={code} onChangeText={t => setCode(t.toUpperCase())} placeholder="Invite code"
                    autoCapitalize="characters" maxLength={6} style={{ textAlign: 'center', letterSpacing: 4 }} />
                  <Button label="Join" variant="secondary" onPress={() => rpc('join_circle', { code: code.trim() })}
                    loading={busy} disabled={code.trim().length < 6} />
                </View>
              </>
            )}
          </View>
        </Card>
      </Screen>
    )
  }

  return (
    <TogetherView
      m={{
        meName: firstName(me),
        partnerName: firstName(partner),
        me: stats?.me,
        partner: stats?.partner,
        weekLabels: lastNDates(7).map(weekdayShort),
        sleepTargets: [me?.sleep_target_min ?? 480, partner.sleep_target_min],
        live: partnerLive ? { hr: partnerLive.hr, hrv: partnerLive.hrv, skinTemp: partnerLive.skinTemp } : undefined,
      }}
      refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load().catch(console.warn); setRefreshing(false) }}
    />
  )
}

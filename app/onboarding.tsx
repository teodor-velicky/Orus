import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { isHealthAvailable, requestHealthAccess, syncHealth } from '../lib/health'
import { color, space, type } from '../lib/theme'
import { Button, Field, Header, Screen, Segmented } from '../components/ui'
import type { Profile } from '../lib/types'

type Step = 'profile' | 'circle' | 'health'

export default function Onboarding() {
  const { session, me, refresh } = useSession()
  const [step, setStep] = useState<Step>('profile')
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState(me?.name ?? '')
  const [sex, setSex] = useState<'male' | 'female'>(me?.sex ?? 'male')
  const [birthYear, setBirthYear] = useState(me?.birth_year ? String(me.birth_year) : '')
  const [height, setHeight] = useState(me?.height_cm ? String(me.height_cm) : '')
  const [weight, setWeight] = useState(me?.weight_kg ? String(me.weight_kg) : '')
  const [activity, setActivity] = useState<Profile['activity_level']>(me?.activity_level ?? 'moderate')
  const [code, setCode] = useState('')

  const userId = session?.user.id

  const saveProfile = async () => {
    if (!userId) return
    const by = parseInt(birthYear, 10)
    const h = parseFloat(height.replace(',', '.'))
    const w = parseFloat(weight.replace(',', '.'))
    if (!name.trim() || !(by > 1920 && by < 2015) || !(h > 120 && h < 230) || !(w > 35 && w < 250)) {
      Alert.alert('Almost', 'Fill in name, birth year, height (cm) and weight (kg).')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('profiles').update({
      name: name.trim(), sex, birth_year: by, height_cm: h, weight_kg: w, activity_level: activity,
      updated_at: new Date().toISOString(),
    }).eq('id', userId)
    setBusy(false)
    if (error) return Alert.alert('Could not save', error.message)
    setStep('circle')
  }

  const createCircle = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('create_circle', { circle_name: 'Us' })
    setBusy(false)
    if (error) return Alert.alert('Could not create', error.message)
    setStep('health')
  }

  const joinCircle = async () => {
    if (code.trim().length < 6) return Alert.alert('Invite code', 'Enter the 6-character code from your partner.')
    setBusy(true)
    const { error } = await supabase.rpc('join_circle', { code: code.trim() })
    setBusy(false)
    if (error) return Alert.alert('Could not join', error.message)
    setStep('health')
  }

  const connectHealth = async () => {
    if (!userId) return
    setBusy(true)
    try {
      if (await requestHealthAccess()) await syncHealth(userId, 60)
    } catch (e) {
      Alert.alert('Apple Health', (e as Error).message)
    }
    setBusy(false)
    finish()
  }

  const finish = async () => {
    if (!userId) return
    await supabase.from('profiles').update({ onboarded: true }).eq('id', userId)
    await refresh()
  }

  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xl}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.xl, marginBottom: space.s }}>
        {(['profile', 'circle', 'health'] as Step[]).map(s => (
          <View key={s} style={{ width: s === step ? 22 : 6, height: 6, borderRadius: 3, backgroundColor: s === step ? color.text : color.textFaint }} />
        ))}
      </View>

      {step === 'profile' && (
        <View>
          <Header title="About you" />
          <Text style={[type.sub, { marginTop: -space.m, marginBottom: space.xl }]}>
            Used for energy targets and sex-specific nutrient needs (iron, zinc, magnesium).
          </Text>
          <Field label="Name" value={name} onChangeText={setName} placeholder="First name" />
          <Text style={[type.label, { marginBottom: space.s }]}>Sex</Text>
          <Segmented
            options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]}
            value={sex} onChange={setSex}
          />
          <View style={{ height: space.l }} />
          <Field label="Birth year" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="1999" />
          <View style={{ flexDirection: 'row', gap: space.m }}>
            <View style={{ flex: 1 }}>
              <Field label="Height" value={height} onChangeText={setHeight} keyboardType="decimal-pad" suffix="cm" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" suffix="kg" />
            </View>
          </View>
          <Text style={[type.label, { marginBottom: space.s }]}>Activity</Text>
          <Segmented
            options={[
              { value: 'low', label: 'Low' }, { value: 'moderate', label: 'Moderate' },
              { value: 'high', label: 'High' }, { value: 'athlete', label: 'Athlete' },
            ]}
            value={activity} onChange={setActivity}
          />
          <Button label="Continue" onPress={saveProfile} loading={busy} style={{ marginTop: space.xxl }} />
        </View>
      )}

      {step === 'circle' && (
        <View>
          <Header title="Invite your person" />
          <Text style={[type.sub, { marginTop: -space.m, marginBottom: space.xxl }]}>
            One of you creates a shared space and sends the code; the other joins with it.
            You'll both see each other's dashboard.
          </Text>
          <Button label="Create a shared space" onPress={createCircle} loading={busy} />
          <Text style={[type.label, { textAlign: 'center', marginVertical: space.xl }]}>or</Text>
          <Field
            label="Join with a code" value={code} onChangeText={t => setCode(t.toUpperCase())}
            placeholder="A1B2C3" autoCapitalize="characters" maxLength={6}
          />
          <Button label="Join" variant="secondary" onPress={joinCircle} loading={busy} />
          <Button label="Skip for now" variant="ghost" onPress={() => setStep('health')} style={{ marginTop: space.l }} />
        </View>
      )}

      {step === 'health' && (
        <View>
          <Header title="Apple Health" />
          <Text style={[type.sub, { marginTop: -space.m, marginBottom: space.xxl }]}>
            Orus reads sleep, heart rate, HRV, steps and workouts from Apple Health. Anything that
            writes there — iPhone steps, Garmin Connect, Apple Watch, a scale — shows up automatically.
            A smart ring is optional and can be paired later from Settings.
          </Text>
          {isHealthAvailable() ? (
            <Button label="Connect Apple Health" onPress={connectHealth} loading={busy} />
          ) : (
            <Text style={[type.sub, { marginBottom: space.xl }]}>
              Apple Health needs the installed (sideloaded) Orus build — it isn't available in Expo Go.
              Food logging, training and sharing all work now; connect Health later in Settings.
            </Text>
          )}
          <Button label={isHealthAvailable() ? 'Not now' : 'Finish'} variant="ghost" onPress={finish} style={{ marginTop: space.l }} />
        </View>
      )}
    </Screen>
  )
}

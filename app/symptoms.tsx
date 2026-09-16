import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSession } from '../lib/session'
import { logSymptoms, SymptomType } from '../lib/meals'
import { space, type } from '../lib/theme'
import { Button, Card, Header, Screen, Segmented } from '../components/ui'

const SYMPTOMS: { id: SymptomType; label: string }[] = [
  { id: 'bloating', label: 'Bloating' },
  { id: 'stomach_discomfort', label: 'Stomach discomfort' },
  { id: 'low_energy', label: 'Low energy' },
  { id: 'low_mood', label: 'Low mood' },
]

type Level = '0' | '1' | '2' | '3'

export default function Symptoms() {
  const router = useRouter()
  const { me } = useSession()
  const [levels, setLevels] = useState<Record<SymptomType, Level>>({
    bloating: '0', stomach_discomfort: '0', low_energy: '0', low_mood: '0',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!me) return
    const entries = SYMPTOMS
      .filter(s => levels[s.id] !== '0')
      .map(s => ({ type: s.id, severity: Number(levels[s.id]) }))
    setBusy(true)
    try {
      await logSymptoms(me.id, entries)
      router.back()
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow="Check-in" title="How do you feel?" onBack={() => router.back()} />
      <Text style={[type.sub, { marginTop: -space.m, marginBottom: space.xl }]}>
        Logging how you feel a few hours after meals lets Orus spot food patterns (e.g. bloating after lactose).
      </Text>
      {SYMPTOMS.map(s => (
        <Card key={s.id} style={{ marginBottom: space.s }}>
          <Text style={[type.bodyStrong, { marginBottom: space.m }]}>{s.label}</Text>
          <Segmented
            options={[{ value: '0', label: 'None' }, { value: '1', label: 'Mild' }, { value: '2', label: 'Moderate' }, { value: '3', label: 'Strong' }]}
            value={levels[s.id]}
            onChange={v => setLevels(l => ({ ...l, [s.id]: v }))}
          />
        </Card>
      ))}
      <View style={{ height: space.l }} />
      <Button label="Save" onPress={save} loading={busy} />
    </Screen>
  )
}

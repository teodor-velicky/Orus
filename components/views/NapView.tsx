// Log a nap, and see recent ones — presentational.
import { Text, View } from 'react-native'
import { color, space, type } from '../../lib/theme'
import { Button, Card, Chip, Header, IconButton, Label, Row, Screen } from '../ui'

export interface NapModel {
  durations: number[]
  duration: number
  endedOptions: { label: string; minutesAgo: number }[]
  endedMinutesAgo: number
  /** e.g. "13:40 – 14:10" for the choice above. */
  preview: string
  recent: { id: string; title: string; sub: string; source: 'manual' | 'ring' }[]
  saving: boolean
}

export interface NapHandlers {
  onClose: () => void
  onDuration: (min: number) => void
  onEnded: (minutesAgo: number) => void
  onSave: () => void
  onRemove: (id: string) => void
}

export function NapView({ m, h }: { m: NapModel; h: NapHandlers }) {
  return (
    <Screen edges={['top', 'bottom']} bottomInset={space.xxxl}>
      <Header eyebrow="Sleep" title="Log a nap" right={<IconButton name="close" onPress={h.onClose} />} />

      <Card>
        <Text style={[type.label, { textAlign: 'center', marginBottom: space.m }]}>How long</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
          {m.durations.map(d => <Chip key={d} label={d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60}m` : ''}` : `${d} min`} active={m.duration === d} onPress={() => h.onDuration(d)} />)}
        </View>
        <Text style={[type.label, { textAlign: 'center', marginTop: space.xl, marginBottom: space.m }]}>Woke up</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
          {m.endedOptions.map(o => <Chip key={o.minutesAgo} label={o.label} active={m.endedMinutesAgo === o.minutesAgo} onPress={() => h.onEnded(o.minutesAgo)} />)}
        </View>
        <Text style={[type.title, { textAlign: 'center', marginTop: space.xl }]}>{m.preview}</Text>
        <Button label="Save nap" icon="moon" onPress={h.onSave} loading={m.saving} style={{ marginTop: space.l }} />
      </Card>

      <Text style={[type.caption, { textAlign: 'center', marginTop: space.m }]}>
        A nap lowers tonight's sleep need by the time napped, up to 90 minutes. The ring also spots naps on its own:
        a daytime stretch at sleeping heart rate with no steps.
      </Text>

      <Label>Recent naps</Label>
      {m.recent.length ? (
        <Card style={{ paddingVertical: space.xs }}>
          {m.recent.map((n, i) => (
            <Row key={n.id} icon={n.source === 'ring' ? 'radio-outline' : 'moon-outline'} label={n.title} sub={n.sub}
              last={i === m.recent.length - 1}
              right={<IconButton name={n.source === 'ring' ? 'close' : 'trash-outline'} onPress={() => h.onRemove(n.id)} />} />
          ))}
        </Card>
      ) : (
        <Card><Text style={[type.sub, { textAlign: 'center', color: color.textSecondary }]}>No naps in the last three days.</Text></Card>
      )}
    </Screen>
  )
}

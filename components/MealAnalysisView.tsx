// Full breakdown of one meal analysis. Used on review and meal detail.
import { useState } from 'react'
import { LayoutAnimation, Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { NUTRIENTS, formatAmount, pctOfRdi, Sex } from '../lib/nutrients'
import { color, font, space, type } from '../lib/theme'
import { Bullet, Card, Chip, Label, Stat, tap } from './ui'
import { Donut, Gauge, Legend, MetricBar } from './charts'
import type { MealAnalysis } from '../lib/types'

const NOVA = ['', 'Unprocessed', 'Culinary', 'Processed', 'Ultra-processed']
const CONTEXT: Record<string, string> = { home_cooked: 'Home cooked', restaurant: 'Restaurant', packaged: 'Packaged' }
const IRRITANT: Record<string, string> = {
  lactose: 'Lactose', gluten: 'Gluten', capsaicin: 'Spicy', caffeine: 'Caffeine', alcohol: 'Alcohol',
  carbonation: 'Carbonation', artificial_sweeteners: 'Sweeteners', high_fat_fried: 'Fried / high fat',
}

function Collapsible({ title, icon, children, initiallyOpen = false }: {
  title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode; initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <Card padded={false} style={{ marginTop: space.s }}>
      <Pressable
        onPress={() => {
          tap()
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
          setOpen(o => !o)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l + 2 }}
      >
        <Ionicons name={icon} size={16} color={color.textSecondary} />
        <Text style={[type.title, { fontSize: 15, flex: 1 }]}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={color.textTertiary} />
      </Pressable>
      {open ? <View style={{ paddingHorizontal: space.l + 2, paddingBottom: space.l + 2 }}>{children}</View> : null}
    </Card>
  )
}

function Well({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <Card inset style={{ flex: 1 }}>
      <Text style={[type.label, { fontSize: 9, textAlign: 'center' }]} numberOfLines={1}>{label}</Text>
      <Text style={[type.number, { fontSize: 18, textAlign: 'center', marginTop: 4 }]}>
        {value}{unit ? <Text style={type.unit}> {unit}</Text> : null}
      </Text>
    </Card>
  )
}

export function MealAnalysisView({ analysis, sex }: { analysis: MealAnalysis; sex?: Sex | null }) {
  const v2 = analysis.v2
  const m = v2.macros
  const ratio = v2.metabolic.omega3Mg > 0 ? v2.metabolic.omega6Mg / v2.metabolic.omega3Mg : null

  return (
    <View>
      {/* HERO */}
      <Card>
        <View style={{ alignItems: 'center' }}>
          <Gauge value={analysis.overallScore} size={164} stroke={10} label="Meal quality" sub={CONTEXT[v2.mealContext]} />
          <Text style={[type.unit, { marginTop: space.s }]}>{Math.round(v2.confidence.overall * 100)}% CONFIDENCE</Text>
        </View>
        <Text style={[type.sub, { color: color.text, textAlign: 'center', marginTop: space.l }]}>{analysis.summary}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.xl }}>
          <Donut size={112} stroke={10} parts={[
            { label: 'Protein', value: m.protein * 4 }, { label: 'Carbs', value: m.carbs * 4 }, { label: 'Fat', value: m.fat * 9 },
          ]}>
            <Text style={[type.number, { fontSize: 22 }]}>{Math.round(m.calories)}</Text>
            <Text style={type.unit}>kcal</Text>
          </Donut>
          <View style={{ flex: 1, gap: space.m }}>
            {[
              { l: 'Protein', v: m.protein }, { l: 'Carbs', v: m.carbs }, { l: 'Fat', v: m.fat }, { l: 'Fiber', v: m.fiberTotal },
            ].map(x => (
              <View key={x.l} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={[type.sub, { color: color.text }]}>{x.l}</Text>
                <Text style={{ fontFamily: font.semibold, fontSize: 15, color: color.text }}>{Math.round(x.v)}<Text style={type.unit}> g</Text></Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ marginTop: space.m }}>
          <Legend items={[{ label: 'Protein' }, { label: 'Carbs' }, { label: 'Fat' }]} />
        </View>
      </Card>

      {/* COMPONENTS */}
      <Label>On the plate</Label>
      <Card>
        {v2.items.map((it, i) => (
          <View key={`${it.name}-${i}`} style={{
            flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.s + 2,
            borderTopWidth: i ? 1 : 0, borderTopColor: color.hairline,
          }}>
            <Text style={type.body}>{it.name}</Text>
            <Text style={[type.unit, { color: color.textSecondary, fontSize: 12 }]}>{Math.round(it.estGrams)} g</Text>
          </View>
        ))}
      </Card>

      {/* QUALITY */}
      <Label>Quality</Label>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          <Stat value={`NOVA ${v2.quality.novaClass}`} label={NOVA[v2.quality.novaClass]} size="s" />
          <Stat value={String(v2.quality.plantSpecies.length)} label="Plants" size="s" />
          <Stat value={v2.quality.proteinQuality ?? '—'} label="Protein" size="s" />
        </View>

        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xl }}>
          <Well label="Gly. load" value={String(Math.round(v2.metabolic.glycemicLoad))} />
          <Well label="Sugar" value={String(Math.round(m.addedSugar))} unit="g" />
          <Well label="Sat fat" value={m.saturatedFat != null ? String(Math.round(m.saturatedFat)) : '—'} unit="g" />
          <Well label="Ω 6:3" value={ratio ? ratio.toFixed(1) : '—'} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.s }}>
          <Well label="Sodium" value={`${Math.round(v2.minerals.sodiumMg.low)}–${Math.round(v2.minerals.sodiumMg.high)}`} unit="mg" />
          <Well label="Potassium" value={`${Math.round(v2.minerals.potassiumMg.low)}–${Math.round(v2.minerals.potassiumMg.high)}`} unit="mg" />
        </View>

        {m.fiberSoluble != null && m.fiberInsoluble != null ? (
          <Text style={[type.caption, { textAlign: 'center', marginTop: space.l }]}>
            Fiber {Math.round(m.fiberSoluble * 10) / 10} g soluble · {Math.round(m.fiberInsoluble * 10) / 10} g insoluble
          </Text>
        ) : null}

        {v2.quality.plantSpecies.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, marginTop: space.l }}>
            {v2.quality.plantSpecies.map(p => <Chip key={p} label={p} icon="leaf-outline" />)}
            {v2.quality.fermented ? <Chip label="Fermented" active /> : null}
          </View>
        ) : null}

        <Text style={[type.label, { textAlign: 'center', marginTop: space.xl, marginBottom: space.s }]}>
          Gut · FODMAP {v2.gut.fodmapLoad}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
          {v2.gut.irritants.length ? v2.gut.irritants.map(i => <Chip key={i} label={IRRITANT[i] ?? i} icon="alert-circle-outline" />) : <Chip label="No common irritants" />}
          {(v2.quality.additives ?? []).map(a => <Chip key={a} label={a} />)}
        </View>
      </Card>

      <Collapsible title="What's good" icon="checkmark-circle-outline" initiallyOpen>
        {analysis.positives.map((p, i) => <Bullet key={i} glyph="+">{p}</Bullet>)}
      </Collapsible>
      <Collapsible title="What to improve" icon="trending-up-outline">
        {analysis.improvements.map((p, i) => <Bullet key={i} glyph="→">{p}</Bullet>)}
      </Collapsible>
      <Collapsible title="Micronutrients" icon="flask-outline">
        {NUTRIENTS.map(n => {
          const amount = analysis.micronutrients[n.id] ?? 0
          const pct = pctOfRdi(n.id, amount, sex)
          return <MetricBar key={n.id} label={n.label} pct={pct} valueText={`${formatAmount(n.id, amount)} · ${pct}%`} />
        })}
        <Text style={[type.caption, { textAlign: 'center' }]}>Micronutrient confidence {Math.round(v2.confidence.micros * 100)}%</Text>
      </Collapsible>
      {analysis.thinkingProcess?.length ? (
        <Collapsible title="How it was analyzed" icon="sparkles-outline">
          {analysis.thinkingProcess.map((t, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: space.m, marginBottom: space.m }}>
              <Text style={[type.unit, { width: 18 }]}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={[type.sub, { flex: 1 }]}>{t}</Text>
            </View>
          ))}
        </Collapsible>
      ) : null}

      <Card style={{ marginTop: space.s }}>
        <View style={{ alignItems: 'center' }}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={color.textSecondary} />
          <Text style={[type.title, { fontFamily: font.medium, textAlign: 'center', marginTop: space.s, lineHeight: 24 }]}>
            {analysis.coachMessage}
          </Text>
        </View>
      </Card>
    </View>
  )
}

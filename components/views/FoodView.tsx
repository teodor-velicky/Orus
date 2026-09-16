// Food — presentational (live data: app/(tabs)/food.tsx, sample data: app/preview.tsx).
import { useMemo, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { alpha, color, font, radius, space, type } from '../../lib/theme'
import { clock, num } from '../../lib/format'
import { FOOD_SOURCES, NUTRIENTS, NutrientCategory, Sex, formatAmount, pctOfRdi } from '../../lib/nutrients'
import { SYSTEM_ORDER } from '../../lib/systems'
import { BodySystemsPanel } from '../BodySystemsPanel'
import type { NutritionSummary } from '../../lib/meals'
import type { MealLog, Pattern, SystemScore } from '../../lib/types'
import { Button, Card, Chip, Header, IconButton, Label, Screen, Segmented, tap } from '../ui'
import { Gauge, MetricBar, MiniRing, StackBar, WeekStrip } from '../charts'

export interface FoodModel {
  date: string
  eyebrow: string
  isMe: boolean
  sex?: Sex | null
  week: { date: string; score: number | null }[]
  summary: NutritionSummary
  targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number }
  /** Calories added to the target for today's running. */
  runBonus?: number
  meals: MealLog[]
  thumbs: Record<string, string>
  weekPlants: string[]
  systems: { scores: SystemScore[]; patterns: Pattern[] } | null
}

export interface FoodHandlers {
  onSelectDate: (d: string) => void
  onRefresh?: () => void
  refreshing?: boolean
  onLogMeal: () => void
  onOpenMeal: (id: string) => void
  onOpenSystem: (id: string) => void
}

const IRRITANT_LABELS: Record<string, string> = {
  lactose: 'Lactose', gluten: 'Gluten', capsaicin: 'Spicy', caffeine: 'Caffeine', alcohol: 'Alcohol',
  carbonation: 'Carbonation', artificial_sweeteners: 'Sweeteners', high_fat_fried: 'Fried',
}

function MacroRing({ label, value, target }: { label: string; value: number; target: number }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <MiniRing value={(value / Math.max(1, target)) * 100} size={58} stroke={4}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.text, letterSpacing: -0.3 }}>{Math.round(value)}</Text>
      </MiniRing>
      <Text style={[type.label, { marginTop: 7, fontSize: 9 }]}>{label}</Text>
      <Text style={[type.unit, { fontSize: 9.5, marginTop: 1 }]}>/{target}g</Text>
    </View>
  )
}

function Well({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <Card inset style={{ flex: 1 }}>
      <Text style={[type.label, { fontSize: 9 }]} numberOfLines={1}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2, marginTop: 6 }}>
        <Text style={[type.number, { fontSize: 20 }]}>{value}</Text>
        {unit ? <Text style={type.unit}>{unit}</Text> : null}
      </View>
      {sub ? <Text style={[type.caption, { fontSize: 10.5, marginTop: 2 }]} numberOfLines={1}>{sub}</Text> : null}
    </Card>
  )
}

export function FoodView({ m, h }: { m: FoodModel; h: FoodHandlers }) {
  const [microTab, setMicroTab] = useState<NutrientCategory>('vitamin')
  const s = m.summary
  const t = m.targets
  const omegaRatio = s.omega3 > 0 ? s.omega6 / s.omega3 : null

  const gaps = useMemo(() => NUTRIENTS
    .map(n => ({ n, pct: pctOfRdi(n.id, s.micros[n.id] ?? 0, m.sex) }))
    .filter(x => x.pct < 50)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3), [s, m.sex])

  return (
    <Screen onRefresh={h.onRefresh} refreshing={h.refreshing}>
      <Header
        eyebrow={m.eyebrow}
        title="Food"
        right={m.isMe ? <IconButton name="add" onPress={h.onLogMeal} /> : undefined}
      />
      <WeekStrip days={m.week} selected={m.date} onSelect={h.onSelectDate} />

      {/* HERO */}
      <Card>
        <View style={{ alignItems: 'center' }}>
          <Gauge value={s.quality} size={176} stroke={10} label="Food quality"
            sub={`${num(s.kcal)} / ${num(t.kcal)} kcal`} />
          {m.runBonus ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: space.s }}>
              <Ionicons name="navigate-outline" size={11} color={color.textTertiary} />
              <Text style={type.caption}>+{num(m.runBonus)} kcal added for today's running</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', marginTop: space.xl }}>
          <MacroRing label="Protein" value={s.protein} target={t.protein} />
          <MacroRing label="Carbs" value={s.carbs} target={t.carbs} />
          <MacroRing label="Fat" value={s.fat} target={t.fat} />
          <MacroRing label="Fiber" value={s.fiber} target={t.fiber} />
        </View>
      </Card>

      {/* MEALS */}
      <Label>Meals</Label>
      {m.meals.length === 0 ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: space.m }}>
            <Ionicons name="camera-outline" size={24} color={color.textSecondary} />
            <Text style={[type.sub, { textAlign: 'center', marginTop: space.m, maxWidth: 260 }]}>
              {m.isMe ? 'Nothing logged yet. Snap your plate — Orus does the rest.' : 'No meals logged this day.'}
            </Text>
            {m.isMe ? <Button label="Log a meal" icon="camera-outline" onPress={h.onLogMeal} style={{ marginTop: space.l, alignSelf: 'stretch' }} /> : null}
          </View>
        </Card>
      ) : (
        <Card padded={false}>
          {m.meals.map((meal, i) => (
            <Pressable key={meal.id} onPress={() => { tap(); h.onOpenMeal(meal.id) }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m + 2,
                borderTopWidth: i ? 1 : 0, borderTopColor: color.hairline, backgroundColor: pressed ? alpha(0.03) : 'transparent',
              })}>
              {m.thumbs[meal.id] ? (
                <Image source={{ uri: m.thumbs[meal.id] }} style={{ width: 52, height: 52, borderRadius: radius.s }} />
              ) : (
                <View style={{ width: 52, height: 52, borderRadius: radius.s, backgroundColor: color.inset, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="restaurant-outline" size={18} color={color.textTertiary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={type.bodyStrong} numberOfLines={1}>{meal.title}</Text>
                <Text style={[type.unit, { marginTop: 3 }]}>
                  {meal.meal_type.toUpperCase()} · {clock(meal.logged_at)} · {num(meal.calories)} KCAL · P{Math.round(meal.protein_g ?? 0)}
                </Text>
              </View>
              <MiniRing value={meal.score} size={40} stroke={3}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.text }}>{meal.score}</Text>
              </MiniRing>
            </Pressable>
          ))}
        </Card>
      )}

      {s.mealCount > 0 && (
        <>
          {/* QUALITY */}
          <Label>Quality</Label>
          <Card>
            <Text style={[type.label, { textAlign: 'center', marginBottom: space.m }]}>Processing · share of calories</Text>
            <StackBar parts={[
              { label: 'Whole', value: s.novaShare[0] },
              { label: 'Culinary', value: s.novaShare[1] },
              { label: 'Processed', value: s.novaShare[2] },
              { label: 'Ultra', value: s.novaShare[3] },
            ]} />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l, marginTop: space.xl }}>
              <Gauge value={(m.weekPlants.length / 30) * 100} size={104} stroke={6} ticks={false}
                display={String(m.weekPlants.length)} sub="of 30" />
              <View style={{ flex: 1 }}>
                <Text style={type.title}>Plant diversity</Text>
                <Text style={[type.sub, { marginTop: 4 }]}>
                  Distinct plants this week — the strongest dietary predictor of a diverse gut microbiome.
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xl }}>
              <Well label="Sugar" value={String(Math.round(s.addedSugar))} unit="g" sub="added · max 25" />
              <Well label="Gly. load" value={String(Math.round(s.glycemicLoad))} sub="aim < 100" />
              <Well label="Sat fat"value={String(Math.round(s.saturatedFat))} unit="g" sub={`limit ${Math.round((t.kcal * 0.1) / 9)} g`} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.s }}>
              <Well label="Omega 6:3" value={omegaRatio ? omegaRatio.toFixed(1) : '—'} unit=":1" sub="aim < 4" />
              <Well label="Sodium" value={`${(s.sodium.low / 1000).toFixed(1)}–${(s.sodium.high / 1000).toFixed(1)}`} unit="g" sub="estimate" />
              <Well label="Fermented" value={String(s.fermentedMeals)} sub="meals" />
            </View>

            {s.irritants.length || s.highFodmapMeals ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, marginTop: space.l }}>
                {s.highFodmapMeals ? <Chip label={`High FODMAP ×${s.highFodmapMeals}`} icon="alert-circle-outline" /> : null}
                {s.irritants.map(i => <Chip key={i} label={IRRITANT_LABELS[i] ?? i} />)}
              </View>
            ) : null}
          </Card>

          {/* MICRONUTRIENTS */}
          <Label>Micronutrients</Label>
          <Card>
            <Segmented
              options={[{ value: 'vitamin', label: 'Vitamins' }, { value: 'mineral', label: 'Minerals' }, { value: 'other', label: 'Other' }]}
              value={microTab} onChange={setMicroTab}
            />
            <View style={{ height: space.xl }} />
            {NUTRIENTS.filter(n => n.category === microTab).map(n => {
              const amount = s.micros[n.id] ?? 0
              const pct = pctOfRdi(n.id, amount, m.sex)
              return <MetricBar key={n.id} label={n.label} pct={pct} valueText={`${formatAmount(n.id, amount)} · ${pct}%`} />
            })}
            <Text style={[type.caption, { textAlign: 'center' }]}>
              % of daily reference intake · {m.sex === 'female' ? 'female' : 'male'} adult
            </Text>
          </Card>

          {gaps.length > 0 && (
            <>
              <Label>Fill the gaps</Label>
              <View style={{ gap: space.s }}>
                {gaps.map(g => (
                  <Card key={g.n.id}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                      <MiniRing value={g.pct} size={44} stroke={3}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.text }}>{g.pct}%</Text>
                      </MiniRing>
                      <View style={{ flex: 1 }}>
                        <Text style={type.bodyStrong}>{g.n.label}</Text>
                        <Text style={[type.caption, { marginTop: 2 }]}>{FOOD_SOURCES[g.n.id]?.join(' · ')}</Text>
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            </>
          )}
        </>
      )}

      {/* BODY SYSTEMS */}
      <Label>Body systems</Label>
      <BodySystemsPanel systems={m.systems} onOpenSystem={h.onOpenSystem} />
      <Text style={[type.caption, { textAlign: 'center', marginTop: space.s }]}>
        {SYSTEM_ORDER.some(id => (m.systems?.scores.find(x => x.system === id)?.meta.mealCount ?? 0) > 0)
          ? 'Tap an organ or score to see what your diet is doing there'
          : 'Log a few meals to light up the map'}
      </Text>

      {m.systems?.patterns.length ? (
        <>
          <Label>Patterns noticed</Label>
          <Card>
            {m.systems.patterns.slice(0, 3).map(p => (
              <Text key={`${p.symptom}-${p.flag}`} style={[type.sub, { color: color.text, marginBottom: space.s }]}>{p.note}</Text>
            ))}
            <Text style={type.caption}>Correlation, not causation — test by removing the trigger for a week.</Text>
          </Card>
        </>
      ) : null}
    </Screen>
  )
}

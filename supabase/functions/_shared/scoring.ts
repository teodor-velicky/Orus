// Orus body-system scoring engine (ported from Somata).
//
// Pure TypeScript — no Deno APIs — so it can be unit-tested with plain node.
// Every score is a confidence-weighted rubric over a rolling window of
// analyzed meals. The LLM never invents these numbers; they are computed
// deterministically here from extracted meal data.

import { rdiFor, type Sex } from './nutrients.ts'

// ─── Types ───

export interface RangeEstimate {
  low: number
  high: number
  confidence: number
}

export interface MealSignal {
  loggedAt: string // ISO datetime
  macros: { calories: number; fiberTotal: number; addedSugar: number }
  micros: Record<string, number>
  quality: { novaClass: number; plantSpecies: string[]; fermented: boolean }
  gut: { fodmapLoad: 'low' | 'medium' | 'high'; irritants: string[] }
  metabolic: { glycemicLoad: number; omega3Mg: number; omega6Mg: number }
  minerals: { sodiumMg: RangeEstimate; potassiumMg: RangeEstimate }
  confidence: { overall: number; micros: number }
}

export interface Driver {
  factor: string
  score: number
  weight: number
  confidence: number
  note: string
  /** Human-readable name for UI ("Plant diversity"). */
  label?: string
  /** Measured value for the window (per the unit). */
  value?: number
  /** Target/guideline value the bar is drawn against. */
  target?: number
  unit?: string
  /** True when lower values are better (sodium, sugar, GL, ...). */
  lowerIsBetter?: boolean
  /** Optional per-nutrient breakdown (endocrine cofactors). */
  breakdown?: { id: string; label: string; pct: number }[]
}

export interface SystemScore {
  system: BodySystem
  score: number
  confidence: number
  drivers: Driver[]
  meta: { mealCount: number; dayCount: number; windowDays: number }
}

export type BodySystem =
  | 'gut_microbiome'
  | 'digestion'
  | 'metabolic'
  | 'hormonal'
  | 'cardiovascular'

export const SYSTEM_WINDOWS: Record<BodySystem, number> = {
  gut_microbiome: 14,
  digestion: 7,
  metabolic: 28,
  hormonal: 28,
  cardiovascular: 28,
}

/** Fewer meals than this in a window ⇒ confidence is scaled down. */
export const MIN_MEALS_FOR_FULL_CONFIDENCE = 8

// ─── Helpers ───

/** Linear ramp: returns 100 at/above `full`, 0 at/below `zero`. Works inverted. */
export function ramp(value: number, zero: number, full: number): number {
  if (zero === full) return value >= full ? 100 : 0
  const t = (value - zero) / (full - zero)
  return Math.round(Math.max(0, Math.min(1, t)) * 100)
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function dateOf(iso: string): string {
  return iso.slice(0, 10)
}

interface DayTotals {
  calories: number
  fiber: number
  addedSugar: number
  glycemicLoad: number
  omega3: number
  omega6: number
  sodiumMid: number
  sodiumConf: number[]
  potassiumMid: number
  potassiumConf: number[]
  micros: Record<string, number>
}

function groupByDay(meals: MealSignal[]): DayTotals[] {
  const byDay = new Map<string, DayTotals>()
  for (const m of meals) {
    const d = dateOf(m.loggedAt)
    let t = byDay.get(d)
    if (!t) {
      t = {
        calories: 0, fiber: 0, addedSugar: 0, glycemicLoad: 0,
        omega3: 0, omega6: 0,
        sodiumMid: 0, sodiumConf: [], potassiumMid: 0, potassiumConf: [],
        micros: {},
      }
      byDay.set(d, t)
    }
    t.calories += m.macros.calories
    t.fiber += m.macros.fiberTotal
    t.addedSugar += m.macros.addedSugar
    t.glycemicLoad += m.metabolic.glycemicLoad
    t.omega3 += m.metabolic.omega3Mg
    t.omega6 += m.metabolic.omega6Mg
    t.sodiumMid += (m.minerals.sodiumMg.low + m.minerals.sodiumMg.high) / 2
    t.sodiumConf.push(m.minerals.sodiumMg.confidence)
    t.potassiumMid += (m.minerals.potassiumMg.low + m.minerals.potassiumMg.high) / 2
    t.potassiumConf.push(m.minerals.potassiumMg.confidence)
    for (const [k, v] of Object.entries(m.micros)) {
      t.micros[k] = (t.micros[k] || 0) + v
    }
  }
  return [...byDay.values()]
}

/** Average daily %RDI (capped at 100) for a nutrient id across days. */
function avgDailyPctRDI(days: DayTotals[], id: string, sex?: Sex): number {
  const rdi = rdiFor(id, sex)
  if (!rdi || days.length === 0) return 0
  return avg(days.map(d => Math.min(100, ((d.micros[id] || 0) / rdi) * 100)))
}

/** Confidence-weighted rubric: Σ(score·w·c) / Σ(w·c); confidence = Σ(w·c)/Σ(w). */
export function weightedScore(drivers: Driver[]): { score: number; confidence: number } {
  let num = 0
  let den = 0
  let wSum = 0
  for (const d of drivers) {
    num += d.score * d.weight * d.confidence
    den += d.weight * d.confidence
    wSum += d.weight
  }
  if (den === 0 || wSum === 0) return { score: 0, confidence: 0 }
  return { score: Math.round(num / den), confidence: den / wSum }
}

function filterWindow(meals: MealSignal[], now: Date, windowDays: number): MealSignal[] {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - windowDays)
  return meals.filter(m => new Date(m.loggedAt) >= cutoff && new Date(m.loggedAt) <= now)
}

function finalize(
  system: BodySystem,
  drivers: Driver[],
  meals: MealSignal[],
  days: DayTotals[],
  windowDays: number,
): SystemScore {
  const { score, confidence } = weightedScore(drivers)
  // Sparse data ⇒ scale confidence down, never the score
  const dataFactor = Math.min(1, meals.length / MIN_MEALS_FOR_FULL_CONFIDENCE)
  return {
    system,
    score,
    confidence: Math.round(confidence * dataFactor * 100) / 100,
    drivers,
    meta: { mealCount: meals.length, dayCount: days.length, windowDays },
  }
}

// ─── System rubrics ───

export function scoreGutMicrobiome(all: MealSignal[], now = new Date()): SystemScore {
  const windowDays = SYSTEM_WINDOWS.gut_microbiome
  const meals = filterWindow(all, now, windowDays)
  const days = groupByDay(meals)
  const weeks = Math.max(1, windowDays / 7)
  const conf = avg(meals.map(m => m.confidence.overall)) || 0

  const species = new Set<string>()
  for (const m of meals) for (const s of m.quality.plantSpecies) species.add(s.toLowerCase().trim())
  const speciesPerWeek = species.size / weeks

  const fermentedPerWeek = meals.filter(m => m.quality.fermented).length / weeks
  const nova4Share = meals.length ? meals.filter(m => m.quality.novaClass === 4).length / meals.length : 0
  const fiberPerDay = avg(days.map(d => d.fiber))
  const sugarPerDay = avg(days.map(d => d.addedSugar))

  const drivers: Driver[] = [
    { factor: 'plant_diversity', label: 'Plant diversity',
      score: ramp(speciesPerWeek, 5, 30), weight: 0.35, confidence: conf,
      value: Math.round(speciesPerWeek * 10) / 10, target: 30, unit: 'species/wk',
      note: 'Species variety is the strongest dietary predictor of microbiome richness — each plant feeds different bacteria.' },
    { factor: 'fiber', label: 'Fermentable fiber',
      score: ramp(fiberPerDay, 8, 25), weight: 0.25, confidence: conf,
      value: Math.round(fiberPerDay * 10) / 10, target: 25, unit: 'g/day',
      note: 'Fiber is the primary fuel for gut bacteria; fermentation produces protective short-chain fatty acids.' },
    { factor: 'fermented_foods', label: 'Fermented foods',
      score: ramp(fermentedPerWeek, 0, 4), weight: 0.15, confidence: conf,
      value: Math.round(fermentedPerWeek * 10) / 10, target: 4, unit: '/week',
      note: 'Live-culture foods (yogurt, kefir, sauerkraut, kimchi) deliver beneficial bacteria directly.' },
    { factor: 'ultra_processed', label: 'Ultra-processed share',
      score: ramp(nova4Share, 0.6, 0.1), weight: 0.15, confidence: conf,
      value: Math.round(nova4Share * 100), target: 10, unit: '% of meals', lowerIsBetter: true,
      note: 'Emulsifiers and additives in NOVA-4 foods are associated with reduced microbial diversity.' },
    { factor: 'added_sugar', label: 'Added sugar',
      score: ramp(sugarPerDay, 75, 25), weight: 0.10, confidence: conf,
      value: Math.round(sugarPerDay), target: 25, unit: 'g/day', lowerIsBetter: true,
      note: 'Excess sugar feeds less-beneficial species and crowds out fiber-rich foods.' },
  ]
  return finalize('gut_microbiome', drivers, meals, days, windowDays)
}

export function scoreDigestion(all: MealSignal[], now = new Date()): SystemScore {
  const windowDays = SYSTEM_WINDOWS.digestion
  const meals = filterWindow(all, now, windowDays)
  const days = groupByDay(meals)
  const conf = avg(meals.map(m => m.confidence.overall)) || 0

  const fodmapScore = meals.length
    ? avg(meals.map(m => m.gut.fodmapLoad === 'high' ? 0 : m.gut.fodmapLoad === 'medium' ? 55 : 100))
    : 0
  const highFodmapPct = meals.length
    ? Math.round((meals.filter(m => m.gut.fodmapLoad === 'high').length / meals.length) * 100)
    : 0
  const irritantsPerMeal = meals.length ? avg(meals.map(m => m.gut.irritants.length)) : 0
  const fiberPerDay = avg(days.map(d => d.fiber))

  const drivers: Driver[] = [
    { factor: 'fodmap_load', label: 'High-FODMAP meals',
      score: Math.round(fodmapScore), weight: 0.35, confidence: conf,
      value: highFodmapPct, target: 15, unit: '% of meals', lowerIsBetter: true,
      note: 'FODMAPs are fermentable carbs (onion, garlic, legumes, wheat) that commonly drive bloating in sensitive guts.' },
    { factor: 'irritants', label: 'Common irritants',
      score: ramp(irritantsPerMeal, 2, 0.2), weight: 0.35, confidence: conf,
      value: Math.round(irritantsPerMeal * 10) / 10, target: 0.2, unit: '/meal', lowerIsBetter: true,
      note: 'Alcohol, caffeine, capsaicin, carbonation and fried fat each irritate the gut lining or slow emptying.' },
    { factor: 'fiber_balance', label: 'Fiber intake',
      score: ramp(fiberPerDay, 6, 22), weight: 0.30, confidence: conf,
      value: Math.round(fiberPerDay * 10) / 10, target: 22, unit: 'g/day',
      note: 'Adequate, steady fiber keeps transit regular — sudden spikes or chronic lows both cause discomfort.' },
  ]
  return finalize('digestion', drivers, meals, days, windowDays)
}

export function scoreMetabolic(all: MealSignal[], now = new Date()): SystemScore {
  const windowDays = SYSTEM_WINDOWS.metabolic
  const meals = filterWindow(all, now, windowDays)
  const days = groupByDay(meals)
  const conf = avg(meals.map(m => m.confidence.overall)) || 0

  const glPerDay = avg(days.map(d => d.glycemicLoad))
  const sugarPerDay = avg(days.map(d => d.addedSugar))
  const fiberPerDay = avg(days.map(d => d.fiber))
  const nova4Share = meals.length ? meals.filter(m => m.quality.novaClass === 4).length / meals.length : 0

  const drivers: Driver[] = [
    { factor: 'glycemic_load', label: 'Glycemic load',
      score: ramp(glPerDay, 180, 80), weight: 0.35, confidence: conf,
      value: Math.round(glPerDay), target: 100, unit: '/day', lowerIsBetter: true,
      note: 'Total blood-sugar demand of your day — sustained high loads drive insulin resistance over time.' },
    { factor: 'added_sugar', label: 'Added sugar',
      score: ramp(sugarPerDay, 75, 25), weight: 0.25, confidence: conf,
      value: Math.round(sugarPerDay), target: 25, unit: 'g/day', lowerIsBetter: true,
      note: 'WHO guidance is under 25 g/day; liquid sugar hits fastest.' },
    { factor: 'fiber', label: 'Fiber',
      score: ramp(fiberPerDay, 8, 25), weight: 0.20, confidence: conf,
      value: Math.round(fiberPerDay * 10) / 10, target: 25, unit: 'g/day',
      note: 'Fiber slows carbohydrate absorption and blunts glucose spikes.' },
    { factor: 'ultra_processed', label: 'Ultra-processed share',
      score: ramp(nova4Share, 0.6, 0.1), weight: 0.20, confidence: conf,
      value: Math.round(nova4Share * 100), target: 10, unit: '% of meals', lowerIsBetter: true,
      note: 'Ultra-processed meals correlate with higher energy intake and faster eating.' },
  ]
  return finalize('metabolic', drivers, meals, days, windowDays)
}

export function scoreHormonal(all: MealSignal[], now = new Date(), sex?: Sex): SystemScore {
  const windowDays = SYSTEM_WINDOWS.hormonal
  const meals = filterWindow(all, now, windowDays)
  const days = groupByDay(meals)
  const weeks = Math.max(1, windowDays / 7)
  const conf = avg(meals.map(m => m.confidence.overall)) || 0
  const microConf = avg(meals.map(m => m.confidence.micros)) || 0

  // Nutrients the endocrine system depends on — sufficiency framing only.
  const cofactorIds = ['zinc', 'magnesium', 'vitamin_d', 'selenium', 'iodine']
  const COFACTOR_LABELS: Record<string, string> = {
    zinc: 'Zinc', magnesium: 'Magnesium', vitamin_d: 'Vitamin D',
    selenium: 'Selenium', iodine: 'Iodine',
  }
  const cofactorBreakdown = cofactorIds.map(id => ({
    id,
    label: COFACTOR_LABELS[id],
    pct: Math.round(avgDailyPctRDI(days, id, sex)),
  }))
  const cofactorPct = avg(cofactorIds.map(id => avgDailyPctRDI(days, id, sex)))

  const omega3PerDay = avg(days.map(d => d.omega3))
  const omega6PerDay = avg(days.map(d => d.omega6))
  const ratio = omega3PerDay > 0 ? omega6PerDay / omega3PerDay : 20
  const alcoholPerWeek = meals.filter(m => m.gut.irritants.includes('alcohol')).length / weeks
  const kcalPerDay = avg(days.map(d => d.calories))

  const drivers: Driver[] = [
    { factor: 'endocrine_cofactors', label: 'Endocrine cofactors',
      score: Math.round(cofactorPct), weight: 0.50, confidence: microConf,
      value: Math.round(cofactorPct), target: 100, unit: '% of RDI',
      breakdown: cofactorBreakdown,
      note: 'Thyroid hormone needs iodine and selenium; testosterone synthesis needs zinc; vitamin D acts as a hormone itself.' },
    { factor: 'omega_ratio', label: 'Omega-6 : omega-3',
      score: ramp(ratio, 15, 4), weight: 0.20, confidence: conf,
      value: Math.round(ratio * 10) / 10, target: 4, unit: ':1', lowerIsBetter: true,
      note: 'A lower ratio supports the anti-inflammatory signaling hormones depend on. Oily fish, flax and walnuts shift it down.' },
    { factor: 'alcohol', label: 'Alcohol',
      score: ramp(alcoholPerWeek, 7, 0), weight: 0.15, confidence: conf,
      value: Math.round(alcoholPerWeek * 10) / 10, target: 0, unit: 'meals/wk', lowerIsBetter: true,
      note: 'Alcohol disrupts sleep architecture and cortisol rhythm, and impairs testosterone and estrogen metabolism.' },
    { factor: 'energy_adequacy', label: 'Energy adequacy',
      score: ramp(kcalPerDay, 800, 1500), weight: 0.15, confidence: conf,
      value: Math.round(kcalPerDay), target: 1500, unit: 'kcal/day',
      note: 'Chronic severe restriction downregulates thyroid output and reproductive hormones.' },
  ]
  return finalize('hormonal', drivers, meals, days, windowDays)
}

export function scoreCardiovascular(all: MealSignal[], now = new Date()): SystemScore {
  const windowDays = SYSTEM_WINDOWS.cardiovascular
  const meals = filterWindow(all, now, windowDays)
  const days = groupByDay(meals)
  const conf = avg(meals.map(m => m.confidence.overall)) || 0

  const fiberPerDay = avg(days.map(d => d.fiber))
  const omega3PerDay = avg(days.map(d => d.omega3))
  const sodiumPerDay = avg(days.map(d => d.sodiumMid))
  const sodiumConf = avg(days.flatMap(d => d.sodiumConf)) || 0
  const potassiumPerDay = avg(days.map(d => d.potassiumMid))
  const potassiumConf = avg(days.flatMap(d => d.potassiumConf)) || 0
  const nova4Share = meals.length ? meals.filter(m => m.quality.novaClass === 4).length / meals.length : 0

  const drivers: Driver[] = [
    { factor: 'fiber', label: 'Fiber',
      score: ramp(fiberPerDay, 8, 25), weight: 0.25, confidence: conf,
      value: Math.round(fiberPerDay * 10) / 10, target: 25, unit: 'g/day',
      note: 'Soluble fiber binds cholesterol in the gut and measurably lowers LDL.' },
    { factor: 'omega_3', label: 'Omega-3',
      score: ramp(omega3PerDay, 200, 1600), weight: 0.20, confidence: conf,
      value: Math.round(omega3PerDay), target: 1600, unit: 'mg/day',
      note: 'EPA/DHA lower triglycerides and support heart-rhythm stability.' },
    { factor: 'potassium', label: 'Potassium',
      score: ramp(potassiumPerDay, 1200, 3500), weight: 0.20, confidence: potassiumConf,
      value: Math.round(potassiumPerDay), target: 3500, unit: 'mg/day',
      note: 'Potassium counterbalances sodium and relaxes blood-vessel walls.' },
    // Sodium is confidence-weighted: photo-only weeks barely move this factor.
    { factor: 'sodium', label: 'Sodium',
      score: ramp(sodiumPerDay, 4600, 2300), weight: 0.20, confidence: sodiumConf,
      value: Math.round(sodiumPerDay), target: 2300, unit: 'mg/day', lowerIsBetter: true,
      note: 'Estimate — cooking salt is invisible in photos. Scan packaged foods to sharpen this number.' },
    { factor: 'ultra_processed', label: 'Ultra-processed share',
      score: ramp(nova4Share, 0.6, 0.1), weight: 0.15, confidence: conf,
      value: Math.round(nova4Share * 100), target: 10, unit: '% of meals', lowerIsBetter: true,
      note: 'NOVA-4 foods carry most dietary sodium and trans-fat exposure.' },
  ]
  return finalize('cardiovascular', drivers, meals, days, windowDays)
}

export function scoreAllSystems(all: MealSignal[], now = new Date(), sex?: Sex): SystemScore[] {
  return [
    scoreGutMicrobiome(all, now),
    scoreDigestion(all, now),
    scoreMetabolic(all, now),
    scoreHormonal(all, now, sex),
    scoreCardiovascular(all, now),
  ]
}

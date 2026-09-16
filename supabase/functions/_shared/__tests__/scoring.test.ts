// Scoring engine unit tests. Run: bash supabase/functions/_shared/__tests__/run.sh
import * as assert from 'assert'
import {
  ramp, weightedScore, scoreAllSystems, scoreCardiovascular,
  scoreGutMicrobiome, MealSignal, Driver,
} from '../scoring'

// ─── Helpers ───

function daysAgo(n: number, hour = 12): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function meal(overrides: Partial<MealSignal> & { loggedAt: string }): MealSignal {
  return {
    macros: { calories: 600, fiberTotal: 8, addedSugar: 5 },
    micros: {},
    quality: { novaClass: 1, plantSpecies: [], fermented: false },
    gut: { fodmapLoad: 'low', irritants: [] },
    metabolic: { glycemicLoad: 30, omega3Mg: 300, omega6Mg: 2000 },
    minerals: {
      sodiumMg: { low: 400, high: 800, confidence: 0.5 },
      potassiumMg: { low: 600, high: 900, confidence: 0.7 },
    },
    confidence: { overall: 0.8, micros: 0.7 },
    ...overrides,
  }
}

const PLANTS = [
  'oat', 'blueberry', 'walnut', 'spinach', 'tomato', 'lentil', 'quinoa',
  'broccoli', 'garlic', 'onion', 'apple', 'banana', 'chickpea', 'kale',
  'pepper', 'carrot', 'almond', 'flax', 'rye', 'barley', 'beet', 'cabbage',
  'mushroom', 'olive', 'avocado', 'basil', 'parsley', 'lemon', 'orange', 'pea',
]

// 3 healthy meals/day for 14 days
function healthyMeals(): MealSignal[] {
  const meals: MealSignal[] = []
  for (let d = 0; d < 14; d++) {
    for (let i = 0; i < 3; i++) {
      meals.push(meal({
        loggedAt: daysAgo(d, 8 + i * 5),
        macros: { calories: 650, fiberTotal: 11, addedSugar: 4 },
        micros: { zinc: 4, magnesium: 140, vitamin_d: 8, selenium: 28, iodine: 55, fiber: 11 },
        quality: {
          novaClass: 1,
          plantSpecies: PLANTS.slice((d * 3 + i) % 22, ((d * 3 + i) % 22) + 8),
          fermented: i === 0 && d % 2 === 0,
        },
        metabolic: { glycemicLoad: 28, omega3Mg: 700, omega6Mg: 2400 },
      }))
    }
  }
  return meals
}

// 3 junk meals/day for 14 days
function junkMeals(): MealSignal[] {
  const meals: MealSignal[] = []
  for (let d = 0; d < 14; d++) {
    for (let i = 0; i < 3; i++) {
      meals.push(meal({
        loggedAt: daysAgo(d, 8 + i * 5),
        macros: { calories: 850, fiberTotal: 2, addedSugar: 35 },
        micros: { zinc: 0.8, magnesium: 25, vitamin_d: 0.4, selenium: 5, iodine: 8 },
        quality: { novaClass: 4, plantSpecies: d === 0 ? ['potato'] : [], fermented: false },
        gut: { fodmapLoad: 'high', irritants: ['alcohol', 'high_fat_fried'] },
        metabolic: { glycemicLoad: 95, omega3Mg: 40, omega6Mg: 6000 },
        minerals: {
          sodiumMg: { low: 1400, high: 2400, confidence: 0.8 },
          potassiumMg: { low: 250, high: 420, confidence: 0.6 },
        },
      }))
    }
  }
  return meals
}

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ok - ${name}`)
  } catch (e) {
    console.error(`  FAIL - ${name}`)
    throw e
  }
}

// ─── ramp ───

test('ramp: ascending', () => {
  assert.strictEqual(ramp(25, 8, 25), 100)
  assert.strictEqual(ramp(8, 8, 25), 0)
  assert.strictEqual(ramp(40, 8, 25), 100)
  assert.strictEqual(ramp(0, 8, 25), 0)
  const mid = ramp(16.5, 8, 25)
  assert.ok(mid === 50, `expected 50, got ${mid}`)
})

test('ramp: inverted (lower is better)', () => {
  assert.strictEqual(ramp(2300, 4600, 2300), 100)
  assert.strictEqual(ramp(4600, 4600, 2300), 0)
  assert.strictEqual(ramp(1000, 4600, 2300), 100)
  assert.strictEqual(ramp(9000, 4600, 2300), 0)
})

// ─── weightedScore ───

test('weightedScore: zero-confidence factors are excluded', () => {
  const drivers: Driver[] = [
    { factor: 'a', score: 100, weight: 0.5, confidence: 1, note: '' },
    { factor: 'b', score: 0, weight: 0.5, confidence: 0, note: '' },
  ]
  const { score, confidence } = weightedScore(drivers)
  assert.strictEqual(score, 100) // factor b contributes nothing
  assert.strictEqual(confidence, 0.5) // but overall confidence reflects the gap
})

test('weightedScore: empty → zero', () => {
  assert.deepStrictEqual(weightedScore([]), { score: 0, confidence: 0 })
})

// ─── System scores: healthy > junk across the board ───

test('all systems separate healthy from junk diets', () => {
  const healthy = scoreAllSystems(healthyMeals())
  const junk = scoreAllSystems(junkMeals())
  for (let i = 0; i < healthy.length; i++) {
    const h = healthy[i]
    const j = junk[i]
    assert.ok(
      h.score >= j.score + 25,
      `${h.system}: healthy=${h.score} should beat junk=${j.score} by ≥25`,
    )
  }
})

test('healthy diet scores are high, junk low', () => {
  for (const s of scoreAllSystems(healthyMeals())) {
    assert.ok(s.score >= 65, `${s.system} healthy score ${s.score} should be ≥65`)
  }
  for (const s of scoreAllSystems(junkMeals())) {
    assert.ok(s.score <= 45, `${s.system} junk score ${s.score} should be ≤45`)
  }
})

// ─── Confidence behavior ───

test('sparse data lowers confidence, not score', () => {
  const many = healthyMeals()
  const few = many.slice(0, 3)
  const manyGut = scoreGutMicrobiome(many)
  const fewGut = scoreGutMicrobiome(few)
  assert.ok(fewGut.confidence < manyGut.confidence,
    `few-meal confidence ${fewGut.confidence} should be < ${manyGut.confidence}`)
})

test('low-confidence sodium barely moves the CV score', () => {
  const base = healthyMeals()
  // Same meals, but sodium estimates are terrible AND low-confidence
  const noisySodium = base.map(m => ({
    ...m,
    minerals: {
      ...m.minerals,
      sodiumMg: { low: 4000, high: 8000, confidence: 0.05 },
    },
  }))
  const clean = scoreCardiovascular(base)
  const noisy = scoreCardiovascular(noisySodium)
  assert.ok(
    Math.abs(clean.score - noisy.score) <= 8,
    `low-confidence sodium moved CV score too much: ${clean.score} → ${noisy.score}`,
  )
})

test('high-confidence high sodium DOES lower the CV score', () => {
  const base = healthyMeals()
  const saltySodium = base.map(m => ({
    ...m,
    minerals: {
      ...m.minerals,
      sodiumMg: { low: 4000, high: 8000, confidence: 0.95 },
    },
  }))
  const clean = scoreCardiovascular(base)
  const salty = scoreCardiovascular(saltySodium)
  assert.ok(
    clean.score - salty.score >= 10,
    `confident high sodium should cost ≥10 points: ${clean.score} → ${salty.score}`,
  )
})

// ─── Windows ───

test('old meals outside the window are ignored', () => {
  const oldJunk = junkMeals().map(m => {
    const d = new Date(m.loggedAt)
    d.setDate(d.getDate() - 60)
    return { ...m, loggedAt: d.toISOString() }
  })
  const gut = scoreGutMicrobiome([...healthyMeals(), ...oldJunk])
  const gutClean = scoreGutMicrobiome(healthyMeals())
  assert.strictEqual(gut.score, gutClean.score)
})

test('empty input → zero score, zero confidence', () => {
  for (const s of scoreAllSystems([])) {
    assert.strictEqual(s.confidence, 0)
    assert.strictEqual(s.meta.mealCount, 0)
  }
})

console.log(`\n${passed} tests passed`)

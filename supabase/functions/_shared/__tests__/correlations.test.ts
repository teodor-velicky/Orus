// Correlation engine unit tests.
import * as assert from 'assert'
import {
  computePatterns, FlaggedMeal, SymptomEvent,
  MIN_EXPOSED_MEALS, MIN_SYMPTOM_EVENTS,
} from '../correlations'

function iso(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
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

test('detects a strong high-FODMAP → bloating pattern', () => {
  const meals: FlaggedMeal[] = []
  const symptoms: SymptomEvent[] = []
  // 7 high-fodmap lunches, bloating 3h later after 6 of them
  for (let d = 0; d < 7; d++) {
    meals.push({ loggedAt: iso(d, 12), flags: ['high_fodmap'] })
    if (d < 6) symptoms.push({ type: 'bloating', severity: 2, loggedAt: iso(d, 15) })
  }
  // 10 clean dinners, no symptoms after
  for (let d = 0; d < 10; d++) {
    meals.push({ loggedAt: iso(d, 19), flags: [] })
  }
  const patterns = computePatterns(meals, symptoms)
  assert.ok(patterns.length >= 1, 'expected at least one pattern')
  const p = patterns[0]
  assert.strictEqual(p.flag, 'high_fodmap')
  assert.strictEqual(p.symptom, 'bloating')
  assert.ok(p.exposedRate > 0.7)
  assert.ok(p.note.includes('Bloating'))
})

test('no pattern below the exposure threshold', () => {
  const meals: FlaggedMeal[] = []
  const symptoms: SymptomEvent[] = []
  // Only 4 exposed meals (< MIN_EXPOSED_MEALS) with perfect correlation
  for (let d = 0; d < MIN_EXPOSED_MEALS - 1; d++) {
    meals.push({ loggedAt: iso(d, 12), flags: ['lactose'] })
    symptoms.push({ type: 'bloating', severity: 2, loggedAt: iso(d, 14) })
  }
  for (let d = 0; d < 10; d++) meals.push({ loggedAt: iso(d, 19), flags: [] })
  // Pad symptom count so the symptom gate passes but exposure gate fails
  for (let d = 10; d < 10 + MIN_SYMPTOM_EVENTS; d++) {
    symptoms.push({ type: 'bloating', severity: 1, loggedAt: iso(d, 3) })
  }
  assert.strictEqual(computePatterns(meals, symptoms).length, 0)
})

test('no pattern when symptom follows everything equally (no signal)', () => {
  const meals: FlaggedMeal[] = []
  const symptoms: SymptomEvent[] = []
  // Bloating after EVERY meal, flagged or not → ratio gate blocks it
  for (let d = 0; d < 8; d++) {
    meals.push({ loggedAt: iso(d, 12), flags: ['gluten'] })
    meals.push({ loggedAt: iso(d, 19), flags: [] })
    symptoms.push({ type: 'bloating', severity: 1, loggedAt: iso(d, 14) })
    symptoms.push({ type: 'bloating', severity: 1, loggedAt: iso(d, 21) })
  }
  assert.strictEqual(computePatterns(meals, symptoms).length, 0)
})

test('symptom outside the 6h window does not count', () => {
  const meals: FlaggedMeal[] = []
  const symptoms: SymptomEvent[] = []
  for (let d = 0; d < 7; d++) {
    meals.push({ loggedAt: iso(d, 8), flags: ['alcohol'] })
    // 10 hours later — outside window
    symptoms.push({ type: 'low_energy', severity: 2, loggedAt: iso(d, 18) })
  }
  for (let d = 0; d < 8; d++) meals.push({ loggedAt: iso(d, 20), flags: [] })
  const patterns = computePatterns(meals, symptoms)
  assert.strictEqual(patterns.filter(p => p.flag === 'alcohol').length, 0)
})

test('multiple patterns sort by effect size', () => {
  const meals: FlaggedMeal[] = []
  const symptoms: SymptomEvent[] = []
  for (let d = 0; d < 6; d++) {
    meals.push({ loggedAt: iso(d, 12), flags: ['high_fodmap'] })
    symptoms.push({ type: 'bloating', severity: 2, loggedAt: iso(d, 14) })
  }
  for (let d = 0; d < 6; d++) {
    meals.push({ loggedAt: iso(d, 8), flags: ['caffeine'] })
    if (d < 3) symptoms.push({ type: 'stomach_discomfort', severity: 1, loggedAt: iso(d, 10) })
  }
  for (let d = 6; d < 12; d++) {
    symptoms.push({ type: 'stomach_discomfort', severity: 1, loggedAt: iso(d, 2) })
  }
  for (let d = 0; d < 12; d++) meals.push({ loggedAt: iso(d, 19), flags: [] })
  const patterns = computePatterns(meals, symptoms)
  assert.ok(patterns.length >= 2, `expected ≥2 patterns, got ${patterns.length}`)
  assert.strictEqual(patterns[0].flag, 'high_fodmap') // stronger effect first
})

console.log(`\n${passed} tests passed`)

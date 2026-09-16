// Orus symptom↔food correlation engine (ported from Somata).
//
// Pure TypeScript — unit-testable with node. Compares how often a symptom
// follows meals WITH a given gut flag vs meals WITHOUT it. Output is always
// framed as "pattern noticed", never causation. Gating rules keep noise out:
// minimum exposures, minimum symptom events, and a meaningful rate ratio.

export interface SymptomEvent {
  type: string // 'bloating' | 'low_energy' | 'stomach_discomfort' | 'low_mood'
  severity: number // 1-3
  loggedAt: string // ISO
}

export interface FlaggedMeal {
  loggedAt: string // ISO
  /** e.g. 'high_fodmap', 'lactose', 'gluten', 'alcohol', ... */
  flags: string[]
}

export interface Pattern {
  symptom: string
  flag: string
  exposedMeals: number
  exposedFollowed: number
  exposedRate: number // 0-1
  baselineMeals: number
  baselineRate: number // 0-1
  note: string
}

/** Symptom counts as "after the meal" if within this window. */
export const FOLLOW_WINDOW_HOURS = 6

/** Gates. */
export const MIN_EXPOSED_MEALS = 5
export const MIN_SYMPTOM_EVENTS = 5
export const MIN_EXPOSED_RATE = 0.3
export const MIN_RATE_RATIO = 2
/** Baseline floor so ratio isn't infinite on zero baselines. */
const BASELINE_FLOOR = 0.05

const SYMPTOM_LABELS: Record<string, string> = {
  bloating: 'Bloating',
  low_energy: 'Low energy',
  stomach_discomfort: 'Stomach discomfort',
  low_mood: 'Low mood',
}

const FLAG_LABELS: Record<string, string> = {
  high_fodmap: 'high-FODMAP meals',
  lactose: 'meals with lactose',
  gluten: 'meals with gluten',
  capsaicin: 'spicy meals',
  caffeine: 'meals with caffeine',
  alcohol: 'meals with alcohol',
  carbonation: 'carbonated drinks',
  artificial_sweeteners: 'meals with artificial sweeteners',
  high_fat_fried: 'fried / high-fat meals',
}

function followedBy(
  mealAt: string,
  events: SymptomEvent[],
  windowHours: number,
): boolean {
  const t0 = new Date(mealAt).getTime()
  const t1 = t0 + windowHours * 3600_000
  return events.some(e => {
    const t = new Date(e.loggedAt).getTime()
    return t > t0 && t <= t1
  })
}

export function computePatterns(
  meals: FlaggedMeal[],
  symptoms: SymptomEvent[],
  windowHours = FOLLOW_WINDOW_HOURS,
): Pattern[] {
  const patterns: Pattern[] = []

  // All flags that appear in the meal set
  const allFlags = new Set<string>()
  for (const m of meals) for (const f of m.flags) allFlags.add(f)

  // Symptom events grouped by type
  const byType = new Map<string, SymptomEvent[]>()
  for (const s of symptoms) {
    const arr = byType.get(s.type) ?? []
    arr.push(s)
    byType.set(s.type, arr)
  }

  for (const flag of allFlags) {
    const exposed = meals.filter(m => m.flags.includes(flag))
    const baseline = meals.filter(m => !m.flags.includes(flag))
    if (exposed.length < MIN_EXPOSED_MEALS || baseline.length === 0) continue

    for (const [symptom, events] of byType.entries()) {
      if (events.length < MIN_SYMPTOM_EVENTS) continue

      const exposedFollowed = exposed.filter(m => followedBy(m.loggedAt, events, windowHours)).length
      const baselineFollowed = baseline.filter(m => followedBy(m.loggedAt, events, windowHours)).length

      const exposedRate = exposedFollowed / exposed.length
      const baselineRate = baselineFollowed / baseline.length

      if (exposedRate < MIN_EXPOSED_RATE) continue
      if (exposedRate < MIN_RATE_RATIO * Math.max(baselineRate, BASELINE_FLOOR)) continue

      const sLabel = SYMPTOM_LABELS[symptom] ?? symptom
      const fLabel = FLAG_LABELS[flag] ?? `meals with ${flag}`
      patterns.push({
        symptom,
        flag,
        exposedMeals: exposed.length,
        exposedFollowed,
        exposedRate: Math.round(exposedRate * 100) / 100,
        baselineMeals: baseline.length,
        baselineRate: Math.round(baselineRate * 100) / 100,
        note:
          `${sLabel} followed ${exposedFollowed} of ${exposed.length} ${fLabel} ` +
          `(${Math.round(exposedRate * 100)}%), vs ${Math.round(baselineRate * 100)}% after other meals. `,
      })
    }
  }

  // Strongest patterns first
  return patterns.sort((a, b) =>
    (b.exposedRate - b.baselineRate) - (a.exposedRate - a.baselineRate),
  )
}

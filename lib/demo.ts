// Sample data for the dev-only design preview (app/preview.tsx).
import { summarize } from './meals'
import { readiness } from './metrics'
import { addDays, lastNDates, localIso } from './format'
import type { DailyMetrics, Exercise, GymSession, GymSet, MealLog, Profile, Run, RunAnalysis, SleepSession, Workout } from './types'
import { buildRun, zoneSettings } from './run/training'
import type { GeoPoint, HrSample } from './run/geo'
import type { TodayModel } from '../components/views/TodayView'
import type { FoodModel } from '../components/views/FoodView'

const today = localIso()

function wave(i: number, base: number, amp: number, seed = 1) {
  return Math.round((base + amp * Math.sin(i * 0.9 + seed) + amp * 0.4 * Math.cos(i * 2.1 + seed)) * 10) / 10
}

export const demoMetrics: DailyMetrics[] = lastNDates(30).map((date, i) => ({
  user_id: 'demo', date,
  steps: Math.round(wave(i, 8200, 2600, 2)), active_kcal: Math.round(wave(i, 520, 160, 3)), basal_kcal: 1720,
  exercise_min: Math.round(wave(i, 38, 20)), distance_m: Math.round(wave(i, 6100, 1800)),
  resting_hr: wave(i, 54, 2.5, 4), hr_avg: wave(i, 68, 4), hr_min: 47, hr_max: 162,
  hrv_ms: wave(i, 58, 9, 5), hrv_kind: 'rmssd', respiratory_rate: 14.2, spo2_pct: 97, vo2max: 49.5,
  weight_kg: wave(i, 78.4, 0.4), body_fat_pct: 14,
  skin_temp_c: wave(i, 34.2, 0.2, 6), skin_temp_delta_c: wave(i, 0.05, 0.22, 6),
  sources: ['R09_1A2B', 'iPhone', 'Connect'],
}))

function night(date: string, asleep: number): SleepSession {
  const end = new Date(`${date}T07:12:00`)
  const start = new Date(end.getTime() - (asleep + 38) * 60_000)
  const pattern: [SleepSession['stages'][number]['v'], number][] = [
    ['core', 22], ['deep', 48], ['core', 30], ['rem', 18], ['awake', 4], ['core', 42], ['deep', 30],
    ['rem', 28], ['core', 50], ['awake', 6], ['rem', 34], ['core', 40], ['deep', 12], ['rem', 36], ['awake', 8], ['core', 24],
  ]
  let s = 0
  const stages = pattern.map(([v, d]) => { const o = { v, s, d }; s += d; return o })
  return {
    user_id: 'demo', night: date, source: 'R09_1A2B', start_at: start.toISOString(), end_at: end.toISOString(),
    in_bed_min: asleep + 38, asleep_min: asleep, awake_min: 18, core_min: 208, deep_min: 90, rem_min: 116, stages,
  }
}

export const demoNights: SleepSession[] = lastNDates(14).map((d, i) => night(d, Math.round(wave(i, 440, 35, 1))))

const analysis = (name: string, score: number, kcal: number, p: number, c: number, f: number) => ({
  foodName: name, overallScore: score, summary: 'Balanced plate with lean protein, whole grains and a good spread of vegetables.',
  positives: ['High protein', 'Six plant species', 'Low added sugar'], improvements: ['Add a fermented side', 'Swap some rice for legumes'],
  nutrientScore: { vitamins: 7, minerals: 6, fiber: 7, antioxidants: 6 }, coachMessage: 'Great base — a spoon of kimchi would round it out.',
  thinkingProcess: ['What I see: grilled salmon, brown rice, broccoli, edamame.'],
  micronutrients: { vitamin_c: 60, vitamin_d: 12, iron: 4, magnesium: 140, zinc: 4, potassium: 1100, omega_3: 1500, fiber: 9, folate: 160, vitamin_b12: 3 },
  v2: {
    schema_v: 2 as const, items: [{ name: 'Salmon', estGrams: 140 }, { name: 'Brown rice', estGrams: 180 }],
    macros: { calories: kcal, protein: p, carbs: c, fat: f, saturatedFat: 4, fiberTotal: 9, addedSugar: 2 },
    micros: {}, quality: { novaClass: 1 as const, plantSpecies: ['rice', 'broccoli', 'soy', 'sesame', 'scallion', 'ginger'], fermented: false, proteinQuality: 'complete' as const },
    gut: { fodmapLoad: 'low' as const, irritants: [] }, metabolic: { glycemicLoad: 22, omega3Mg: 1500, omega6Mg: 3200 },
    minerals: { sodiumMg: { low: 400, high: 900, confidence: 0.5 }, potassiumMg: { low: 900, high: 1300, confidence: 0.6 } },
    mealContext: 'home_cooked' as const, confidence: { overall: 0.78, micros: 0.62 },
  },
})

export const demoMeals: MealLog[] = [
  ['breakfast', 'Greek yogurt, berries & oats', 84, 480, 32, 58, 12, 8],
  ['lunch', 'Salmon rice bowl', 88, 690, 46, 72, 22, 13],
  ['snack', 'Apple & almonds', 76, 260, 7, 26, 15, 16],
].map(([type, title, score, kcal, p, c, f, h], i) => ({
  id: `m${i}`, user_id: 'demo', meal_type: type as MealLog['meal_type'], title: title as string, score: score as number,
  calories: kcal as number, protein_g: p as number, carbs_g: c as number, fat_g: f as number, fiber_g: 9,
  micronutrients: analysis('', 0, 0, 0, 0, 0).micronutrients, photo_paths: [], note: null,
  analysis: analysis(title as string, score as number, kcal as number, p as number, c as number, f as number),
  logged_at: new Date(`${today}T${String(h).padStart(2, '0')}:30:00`).toISOString(),
}))

export function demoToday(): TodayModel {
  const target = 480
  const nightFor = (d: string) => demoNights.find(n => n.night === d)
  const r = (d: string) => readiness(nightFor(d), demoMetrics.filter(m => m.date <= d), target, d)
  const n = nightFor(today)
  return {
    date: today,
    eyebrow: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    title: 'Good morning, Teo',
    isMe: true,
    week: lastNDates(7).map(d => ({ date: d, score: r(d).score })),
    readiness: r(today),
    sleep: { night: n, score: n ? Math.min(100, Math.round((n.asleep_min / target) * 100)) : null, targetMin: target },
    nutrition: { summary: summarize(demoMeals), targets: { kcal: 3050, protein: 150, carbs: 402, fat: 80, fiber: 30 }, runBonus: 450 },
    metrics: demoMetrics[demoMetrics.length - 1],
    trend: demoMetrics,
    training: {
      dayVolumes: [8200, 0, 11400, 0, 9600, 0, 12800], dayLabels: lastNDates(7).map(d => new Date(`${d}T12:00`).toLocaleDateString('en-US', { weekday: 'narrow' })),
      sessions: 2, volumeKg: 21000, workouts: 1, runs: 4, runKm: 31.6, dayLoads: [62, 118, 0, 71, 154, 0, 96], form: -9,
    },
    sources: ['R09_1A2B', 'iPhone', 'Connect'],
    syncedText: '2m ago',
    ring: { name: 'R09_1A2B', connected: true, battery: 64, liveHr: 58 },
  }
}

export function demoFood(date: string): FoodModel {
  const drivers = (score: number) => [{ factor: 'x', label: 'Plant diversity', score, weight: 0.35, confidence: 0.8, note: 'Species variety feeds different bacteria.', value: 22, target: 30, unit: 'species/wk' }]
  return {
    date,
    eyebrow: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    isMe: true,
    sex: 'male',
    week: lastNDates(7).map((d, i) => ({ date: d, score: [71, 64, 80, 77, 58, 83, 84][i] })),
    summary: summarize(demoMeals),
    targets: { kcal: 2600, protein: 150, carbs: 290, fat: 80, fiber: 30 },
    meals: demoMeals,
    thumbs: {},
    weekPlants: ['oat', 'blueberry', 'rice', 'broccoli', 'soy', 'sesame', 'scallion', 'ginger', 'apple', 'almond', 'spinach', 'tomato', 'lentil', 'garlic', 'onion', 'pepper', 'kale', 'banana', 'walnut', 'carrot', 'basil', 'lemon'],
    systems: {
      scores: (['gut_microbiome', 'digestion', 'metabolic', 'hormonal', 'cardiovascular'] as const).map((system, i) => ({
        system, score: [74, 82, 69, 61, 77][i], confidence: [0.72, 0.8, 0.55, 0.48, 0.6][i],
        drivers: drivers([74, 82, 69, 61, 77][i]), meta: { mealCount: 38, dayCount: 12, windowDays: 28 },
      })),
      patterns: [],
    },
  }
}

export const demoExercises: Exercise[] = ([
  ['Bench Press', 'chest', 'barbell'], ['Incline Dumbbell Press', 'chest', 'dumbbell'], ['Cable Crossover', 'chest', 'cable'],
  ['Deadlift', 'back', 'barbell'], ['Pull-up', 'back', 'bodyweight'], ['Lat Pulldown', 'back', 'cable'],
  ['Overhead Press', 'shoulders', 'barbell'], ['Lateral Raise', 'shoulders', 'dumbbell'],
  ['Back Squat', 'quads', 'barbell'], ['Leg Press', 'quads', 'machine'], ['Romanian Deadlift', 'hamstrings', 'barbell'],
  ['Hip Thrust', 'glutes', 'barbell'], ['Kettlebell Swing', 'full_body', 'kettlebell'],
] as const).map(([name, muscle_group, equipment], i) => ({ id: `e${i}`, user_id: null, name, muscle_group, equipment }))

export const demoDate = (offset: number) => localIso(addDays(new Date(), offset))

// ─── Running (design preview) ───


export const demoProfile: Profile = {
  id: 'demo', name: 'Teo', sex: 'male', birth_year: 1999, height_cm: 182, weight_kg: 78.4, activity_level: 'high',
  goal: 'maintain', kcal_target: null, protein_target_g: 150, sleep_target_min: 480, preferred_sleep_source: null,
  circle_id: null, onboarded: true, max_hr: null, resting_hr: null,
}

/** Deterministic pseudo-random in [0, 1). */
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** A wobbly loop polyline around the Danube (Bratislava), ~`lengthM` long. */
function loop(lengthM: number, seed: number): { lat: number; lng: number; alt: number }[] {
  const n = 800
  const raw = Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    const r = 1 + 0.18 * Math.sin(3 * t + seed) + 0.08 * Math.cos(7 * t + seed * 2)
    return { x: Math.cos(t) * r * 1.4, y: Math.sin(t) * r, alt: 140 + 18 * Math.sin(2 * t + seed) }
  })
  let len = 0
  for (let i = 1; i < raw.length; i++) len += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y)
  const k = lengthM / len
  return raw.map(p => ({ lat: 48.1405 + (p.y * k) / 111_195, lng: 17.1077 + (p.x * k) / (111_195 * Math.cos((48.14 * Math.PI) / 180)), alt: p.alt }))
}

type Segment = { m: number; pace: number; bpm: number }

function synthRun(date: string, hour: number, segments: Segment[], seed: number, name: string): Run {
  const total = segments.reduce((a, s) => a + s.m, 0)
  const path = loop(total, seed)
  const cum: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    cum.push(cum[i - 1] + Math.hypot((b.lat - a.lat) * 111_195, (b.lng - a.lng) * 111_195 * Math.cos((48.14 * Math.PI) / 180)))
  }
  const start = new Date(`${date}T${String(hour).padStart(2, '0')}:05:00`).getTime()
  const points: GeoPoint[] = []
  const hr: HrSample[] = []
  let t = start, d = 0, bpm = 110, j = 0, s = 0, segStart = 0
  while (d < total) {
    while (s < segments.length - 1 && d >= segStart + segments[s].m) { segStart += segments[s].m; s++ }
    const seg = segments[s]
    const pace = seg.pace * (1 + (rand(seed * 1000 + t / 1000) - 0.5) * 0.06)
    d = Math.min(total, d + (3 * 1000) / pace)
    t += 3000
    while (j < cum.length - 2 && cum[j + 1] < d) j++
    const f = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j])
    const a = path[j], b = path[j + 1]
    points.push({ t, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, alt: a.alt + (b.alt - a.alt) * f, acc: 5, seg: 0 })
    // Heart rate lags toward the segment target and drifts up slowly
    bpm += (seg.bpm + ((t - start) / 3_600_000) * 6 - bpm) * 0.06
    hr.push({ t, bpm: Math.round(bpm + (rand(seed + t) - 0.5) * 3) })
  }
  const built = buildRun({
    userId: 'demo', source: seed % 5 === 0 ? 'apple_health' : 'orus', externalId: `demo-${seed}`, name,
    startedAt: start, endedAt: t, points: [{ t: start, lat: path[0].lat, lng: path[0].lng, alt: path[0].alt, acc: 5, seg: 0 }, ...points],
    hr, hrSource: seed % 5 === 0 ? 'watch' : 'ring',
  }, demoProfile, zoneSettings(demoProfile, demoMetrics))
  return { ...built, id: `run-${seed}` }
}

const easy = (km: number, pace = 330): Segment[] => [{ m: km * 1000, pace, bpm: 142 }]
const tempo: Segment[] = [{ m: 2000, pace: 340, bpm: 138 }, { m: 5000, pace: 262, bpm: 168 }, { m: 1500, pace: 345, bpm: 145 }]
const intervals: Segment[] = [
  { m: 2000, pace: 340, bpm: 138 },
  ...Array.from({ length: 5 }, () => [{ m: 1000, pace: 238, bpm: 181 }, { m: 400, pace: 420, bpm: 150 }]).flat(),
  { m: 1500, pace: 345, bpm: 142 },
]

let demoRunCache: Run[] | null = null

/** ~12 weeks of runs: intervals, tempo, easy and long runs. */
export function demoRuns(): Run[] {
  if (demoRunCache) return demoRunCache
  const out: Run[] = []
  for (let back = 84; back >= 0; back--) {
    const date = demoDate(-back)
    const wd = (new Date(`${date}T12:00`).getDay() + 6) % 7
    const build = Math.min(1, (84 - back) / 60) // volume grows over the block
    const seed = 1000 - back
    if (wd === 1) out.push(synthRun(date, 18, back % 14 < 7 ? intervals : tempo, seed, back % 14 < 7 ? 'Track 5 × 1K' : 'Tempo 5K'))
    else if (wd === 3 && back > 0) out.push(synthRun(date, 7, easy(6 + build * 2), seed, 'Morning easy'))
    else if (wd === 4 && back > 0) out.push(synthRun(date, 18, tempo, seed, 'Threshold'))
    else if (wd === 6 && back > 0) out.push(synthRun(date, 9, easy(10 + build * 5, 340), seed, 'Long run'))
  }
  demoRunCache = out.sort((a, b) => b.start_at.localeCompare(a.start_at))
  return demoRunCache
}

export function demoSessions(): (GymSession & { sets: GymSet[] })[] {
  const out: (GymSession & { sets: GymSet[] })[] = []
  for (let back = 84; back >= 0; back--) {
    const date = demoDate(-back)
    const wd = (new Date(`${date}T12:00`).getDay() + 6) % 7
    if (wd !== 0 && wd !== 2) continue
    const started = new Date(`${date}T17:30:00`)
    const id = `gym-${back}`
    out.push({
      id, user_id: 'demo', name: wd === 0 ? 'Push day' : 'Pull + legs', started_at: started.toISOString(),
      ended_at: new Date(started.getTime() + 62 * 60_000).toISOString(), notes: null,
      sets: Array.from({ length: 16 }, (_, i) => ({
        id: `${id}-${i}`, session_id: id, user_id: 'demo', exercise_id: `e${i % 5}`, exercise_order: i % 5, set_index: i,
        weight_kg: 60 + (i % 4) * 10, reps: 8, rpe: null, is_warmup: false, completed: true,
      })),
    })
  }
  return out
}

export const demoWorkouts: Workout[] = [3, 17, 38].map(back => {
  const start = new Date(`${demoDate(-back)}T10:00:00`)
  return {
    user_id: 'demo', source: 'apple_health', external_id: `bike-${back}`, activity: 'Cycling', name: null,
    start_at: start.toISOString(), end_at: new Date(start.getTime() + 75 * 60_000).toISOString(), duration_s: 4500,
    distance_m: 32000, kcal: 640, avg_hr: 128, max_hr: 151, elevation_m: 210, source_name: 'Connect',
  }
})

export const demoRunAnalysis: RunAnalysis = {
  headline: 'Controlled tempo, strong finish',
  summary: 'You held threshold pace for the full 5 km with heart rate settling in zone 4, and the cool-down brought it back quickly. Pacing was even — a good sign your threshold is moving toward sub-20 5K territory.',
  highlights: ['Tempo kilometres stayed within 6 s/km of each other.', 'Heart rate drift was small for a hard effort (low decoupling).', '41% of the run was easy — right for a key session day.'],
  suggestions: ['Keep tomorrow fully easy (Z2) to absorb this.', 'Next tempo: extend to 6 km at the same pace before going faster.'],
  generatedAt: new Date().toISOString(),
}

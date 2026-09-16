// Row shapes for the Supabase tables (see supabase/migrations).

import type { Sex } from './nutrients'

export interface Profile {
  id: string
  name: string | null
  sex: Sex | null
  birth_year: number | null
  height_cm: number | null
  weight_kg: number | null
  activity_level: 'low' | 'moderate' | 'high' | 'athlete'
  goal: 'lose' | 'maintain' | 'gain'
  kcal_target: number | null
  protein_target_g: number | null
  sleep_target_min: number
  preferred_sleep_source: string | null
  circle_id: string | null
  onboarded: boolean
  /** HR zone overrides; null = estimated. */
  max_hr?: number | null
  resting_hr?: number | null
}

export interface Circle {
  id: string
  name: string
  invite_code: string
  created_by: string
}

export interface RangeEstimate { low: number; high: number; confidence: number }

export interface AnalysisV2 {
  schema_v: 2
  items: { name: string; estGrams: number }[]
  macros: {
    calories: number; protein: number; carbs: number; fat: number
    saturatedFat?: number; fiberTotal: number; fiberSoluble?: number; fiberInsoluble?: number
    sugarTotal?: number; addedSugar: number
  }
  micros: Record<string, number>
  quality: {
    novaClass: 1 | 2 | 3 | 4
    plantSpecies: string[]
    fermented: boolean
    proteinQuality?: 'complete' | 'incomplete' | 'none'
    additives?: string[]
  }
  gut: { fodmapLoad: 'low' | 'medium' | 'high'; irritants: string[] }
  metabolic: { glycemicLoad: number; omega3Mg: number; omega6Mg: number }
  minerals: { sodiumMg: RangeEstimate; potassiumMg: RangeEstimate }
  mealContext: 'home_cooked' | 'restaurant' | 'packaged'
  confidence: { overall: number; micros: number }
}

export interface MealAnalysis {
  thinkingProcess?: string[]
  foodName: string
  overallScore: number
  summary: string
  positives: string[]
  improvements: string[]
  nutrientScore: { vitamins: number; minerals: number; fiber: number; antioxidants: number }
  micronutrients: Record<string, number>
  coachMessage: string
  v2: AnalysisV2
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface MealLog {
  id: string
  user_id: string
  meal_type: MealType
  title: string
  score: number
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  micronutrients: Record<string, number>
  analysis: MealAnalysis
  photo_paths: string[]
  note: string | null
  logged_at: string
}

export interface Driver {
  factor: string
  label?: string
  score: number
  weight: number
  confidence: number
  note: string
  value?: number
  target?: number
  unit?: string
  lowerIsBetter?: boolean
  breakdown?: { id: string; label: string; pct: number }[]
}

export interface Pattern {
  symptom: string
  flag: string
  exposedMeals: number
  exposedFollowed: number
  exposedRate: number
  baselineRate: number
  note: string
}

export type BodySystem = 'gut_microbiome' | 'digestion' | 'metabolic' | 'hormonal' | 'cardiovascular'

export interface SystemScore {
  system: BodySystem
  score: number
  confidence: number
  drivers: Driver[]
  meta: { mealCount: number; dayCount: number; windowDays: number; patterns?: Pattern[] }
}

export interface DailyMetrics {
  user_id: string
  date: string
  steps: number | null
  active_kcal: number | null
  basal_kcal: number | null
  exercise_min: number | null
  distance_m: number | null
  resting_hr: number | null
  hr_avg: number | null
  hr_min: number | null
  hr_max: number | null
  hrv_ms: number | null
  respiratory_rate: number | null
  spo2_pct: number | null
  vo2max: number | null
  weight_kg: number | null
  body_fat_pct: number | null
  sources: string[]
  updated_at?: string
  /** Set by the client merge: ring HRV is RMSSD, Apple Health HRV is SDNN — never compare across. */
  hrv_kind?: 'sdnn' | 'rmssd'
  skin_temp_c?: number | null
  /** Nightly skin temperature minus the median of the previous 14 nights. */
  skin_temp_delta_c?: number | null
}

export type SleepStage = 'core' | 'deep' | 'rem' | 'awake' | 'asleep' | 'in_bed'

export interface SleepSession {
  id?: string
  user_id: string
  night: string
  source: string
  start_at: string
  end_at: string
  in_bed_min: number
  asleep_min: number
  awake_min: number
  core_min: number
  deep_min: number
  rem_min: number
  stages: { v: SleepStage; s: number; d: number }[]
}

export interface Workout {
  id?: string
  user_id: string
  source: 'apple_health' | 'strava'
  external_id: string
  activity: string
  name: string | null
  start_at: string
  end_at: string
  duration_s: number
  distance_m: number | null
  kcal: number | null
  avg_hr: number | null
  max_hr: number | null
  elevation_m: number | null
  source_name: string | null
}

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings'
  | 'glutes' | 'calves' | 'core' | 'full_body' | 'cardio'

export interface Exercise {
  id: string
  user_id: string | null
  name: string
  muscle_group: MuscleGroup
  equipment: string
}

export interface GymSession {
  id: string
  user_id: string
  name: string
  started_at: string
  ended_at: string | null
  notes: string | null
}

export interface GymSet {
  id: string
  session_id: string
  user_id: string
  exercise_id: string
  exercise_order: number
  set_index: number
  weight_kg: number
  reps: number
  rpe: number | null
  is_warmup: boolean
  completed: boolean
  created_at?: string
}

export type RunSource = 'orus' | 'apple_health' | 'strava'
export type RunKind = 'recovery' | 'easy' | 'long' | 'tempo' | 'intervals' | 'race'

export interface RunAnalysis {
  headline: string
  summary: string
  highlights: string[]
  suggestions: string[]
  generatedAt: string
}

export interface RunSplit { km: number; distanceM: number; durationS: number; paceS: number; avgHr: number | null; elevDeltaM: number }

export interface Run {
  id: string
  user_id: string
  source: RunSource
  external_id: string
  name: string | null
  start_at: string
  end_at: string
  duration_s: number
  moving_s: number | null
  distance_m: number
  elevation_gain_m: number | null
  avg_hr: number | null
  max_hr: number | null
  kcal: number | null
  hr_source: 'ring' | 'watch' | 'strava' | null
  /** [lat, lng, t_offset_s, alt, seg] — only loaded on the detail screen. */
  route?: [number, number, number, number | null, number][] | null
  /** [t_offset_s, bpm] */
  hr?: [number, number][] | null
  splits: RunSplit[] | null
  best_efforts: Record<string, number> | null
  zones: number[] | null
  trimp: number | null
  kind: RunKind | null
  perceived_effort: number | null
  notes: string | null
  analysis: RunAnalysis | null
  /** Client-only: built from a workouts row (no GPS / HR detail). */
  lite?: boolean
}

export interface RunGoalRow {
  user_id: string
  distance_m: number
  target_s: number
  race_date: string | null
}

// Meal logging: analysis, persistence, photos and daily nutrition summaries.

import * as ImageManipulator from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { supabase, invokeFn } from './supabase'
import { sumMicros } from './nutrients'
import { dayBounds, addDays, fromIso, localIso } from './format'
import type { MealAnalysis, MealLog, MealType, SystemScore, Pattern } from './types'

/**
 * Normalize photos for the vision model: 1280 px wide, JPEG 0.75.
 * Consistent input = consistent recognition, ~10x smaller uploads.
 */
export async function photoToBase64(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1280 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  )
  if (!out.base64) throw new Error('Image processing failed')
  return out.base64
}

export function mealTypeForNow(d = new Date()): MealType {
  const h = d.getHours() + d.getMinutes() / 60
  if (h < 10.5) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 17.5) return 'snack'
  return 'dinner'
}

export async function analyzeMeal(photos: string[], description: string): Promise<MealAnalysis> {
  const data = await invokeFn<{ result: MealAnalysis }>('analyze-meal', {
    photos, description: description.trim() || undefined,
  })
  return data.result
}

export async function saveMeal(args: {
  userId: string
  mealType: MealType
  analysis: MealAnalysis
  photosBase64: string[]
  note: string
  loggedAt: Date
}): Promise<string> {
  const { userId, mealType, analysis, photosBase64, note, loggedAt } = args

  const stamp = Date.now()
  const photo_paths: string[] = []
  for (let i = 0; i < photosBase64.length; i++) {
    const path = `${userId}/${stamp}-${i}.jpg`
    const { error } = await supabase.storage
      .from('meal-photos')
      .upload(path, decode(photosBase64[i]), { contentType: 'image/jpeg' })
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    photo_paths.push(path)
  }

  const m = analysis.v2.macros
  const { data, error } = await supabase.from('meal_logs').insert({
    user_id: userId,
    meal_type: mealType,
    title: analysis.foodName,
    score: Math.round(analysis.overallScore),
    calories: Math.round(m.calories),
    protein_g: m.protein,
    carbs_g: m.carbs,
    fat_g: m.fat,
    fiber_g: m.fiberTotal,
    micronutrients: analysis.micronutrients,
    analysis,
    photo_paths,
    note: note.trim() || null,
    logged_at: loggedAt.toISOString(),
  }).select('id').single()
  if (error) throw new Error(error.message)

  const { error: v2Error } = await supabase.from('meal_analyses').insert({
    user_id: userId,
    meal_log_id: data.id,
    logged_at: loggedAt.toISOString(),
    analysis: analysis.v2,
  })
  if (v2Error) console.warn('meal_analyses insert failed', v2Error.message)

  // Refresh body-system scores in the background.
  computeSystemScores().catch(() => {})
  return data.id
}

export async function deleteMeal(meal: MealLog): Promise<void> {
  if (meal.photo_paths.length) {
    await supabase.storage.from('meal-photos').remove(meal.photo_paths)
  }
  const { error } = await supabase.from('meal_logs').delete().eq('id', meal.id)
  if (error) throw new Error(error.message)
  computeSystemScores().catch(() => {})
}

export async function mealsForDay(userId: string, iso: string): Promise<MealLog[]> {
  const { start, end } = dayBounds(iso)
  const { data, error } = await supabase.from('meal_logs').select('*')
    .eq('user_id', userId).gte('logged_at', start).lt('logged_at', end)
    .order('logged_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as MealLog[]
}

export async function mealsInRange(userId: string, fromIsoDate: string, toIsoDate: string): Promise<MealLog[]> {
  const { data, error } = await supabase.from('meal_logs').select('*')
    .eq('user_id', userId)
    .gte('logged_at', fromIso(fromIsoDate).toISOString())
    .lt('logged_at', addDays(fromIso(toIsoDate), 1).toISOString())
    .order('logged_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as MealLog[]
}

export async function getMeal(id: string): Promise<MealLog | null> {
  const { data } = await supabase.from('meal_logs').select('*').eq('id', id).maybeSingle()
  return (data as MealLog | null) ?? null
}

export async function photoUrls(paths: string[]): Promise<string[]> {
  if (!paths.length) return []
  const { data } = await supabase.storage.from('meal-photos').createSignedUrls(paths, 3600)
  return (data ?? []).map(d => d.signedUrl).filter((u): u is string => !!u)
}

// ─── Daily summary ───

export interface NutritionSummary {
  mealCount: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  saturatedFat: number
  addedSugar: number
  glycemicLoad: number
  omega3: number
  omega6: number
  sodium: { low: number; high: number }
  potassium: { low: number; high: number }
  micros: Record<string, number>
  /** Calorie-weighted mean of meal quality scores. */
  quality: number | null
  /** Share of calories per NOVA class (1-4), 0-1. */
  novaShare: [number, number, number, number]
  plants: string[]
  fermentedMeals: number
  highFodmapMeals: number
  irritants: string[]
}

export function summarize(meals: MealLog[]): NutritionSummary {
  const s: NutritionSummary = {
    mealCount: meals.length, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
    saturatedFat: 0, addedSugar: 0, glycemicLoad: 0, omega3: 0, omega6: 0,
    sodium: { low: 0, high: 0 }, potassium: { low: 0, high: 0 },
    micros: sumMicros(meals.map(m => m.micronutrients)),
    quality: null, novaShare: [0, 0, 0, 0], plants: [], fermentedMeals: 0,
    highFodmapMeals: 0, irritants: [],
  }
  const plants = new Set<string>()
  const irritants = new Set<string>()
  let weighted = 0
  let weight = 0
  for (const meal of meals) {
    const v2 = meal.analysis?.v2
    const kcal = v2?.macros.calories ?? meal.calories ?? 0
    s.kcal += kcal
    s.protein += v2?.macros.protein ?? meal.protein_g ?? 0
    s.carbs += v2?.macros.carbs ?? meal.carbs_g ?? 0
    s.fat += v2?.macros.fat ?? meal.fat_g ?? 0
    s.fiber += v2?.macros.fiberTotal ?? meal.fiber_g ?? 0
    const w = Math.max(kcal, 50)
    weighted += meal.score * w
    weight += w
    if (!v2) continue
    s.saturatedFat += v2.macros.saturatedFat ?? 0
    s.addedSugar += v2.macros.addedSugar ?? 0
    s.glycemicLoad += v2.metabolic.glycemicLoad
    s.omega3 += v2.metabolic.omega3Mg
    s.omega6 += v2.metabolic.omega6Mg
    s.sodium.low += v2.minerals.sodiumMg.low
    s.sodium.high += v2.minerals.sodiumMg.high
    s.potassium.low += v2.minerals.potassiumMg.low
    s.potassium.high += v2.minerals.potassiumMg.high
    const nova = Math.min(4, Math.max(1, v2.quality.novaClass)) - 1
    s.novaShare[nova] += kcal
    v2.quality.plantSpecies.forEach(p => plants.add(p.toLowerCase().trim()))
    if (v2.quality.fermented) s.fermentedMeals++
    if (v2.gut.fodmapLoad === 'high') s.highFodmapMeals++
    v2.gut.irritants.forEach(i => irritants.add(i))
  }
  s.quality = weight > 0 ? Math.round(weighted / weight) : null
  const novaTotal = s.novaShare.reduce((a, b) => a + b, 0)
  if (novaTotal > 0) s.novaShare = s.novaShare.map(v => v / novaTotal) as NutritionSummary['novaShare']
  s.plants = [...plants].sort()
  s.irritants = [...irritants]
  return s
}

/** Distinct plant species over the last 7 days (the "30 plants a week" metric). */
export async function plantsThisWeek(userId: string): Promise<string[]> {
  const today = localIso()
  const meals = await mealsInRange(userId, localIso(addDays(new Date(), -6)), today)
  return summarize(meals).plants
}

// ─── Body systems & symptoms ───

export interface SystemScoresResponse {
  scores: SystemScore[]
  patterns: Pattern[]
  mealCount: number
}

export function computeSystemScores(userId?: string): Promise<SystemScoresResponse> {
  return invokeFn('compute-system-scores', userId ? { userId } : {})
}

export type SymptomType = 'bloating' | 'low_energy' | 'stomach_discomfort' | 'low_mood'

export async function logSymptoms(userId: string, entries: { type: SymptomType; severity: number }[]) {
  if (!entries.length) return
  const { error } = await supabase.from('symptom_logs').insert(
    entries.map(e => ({ user_id: userId, type: e.type, severity: e.severity })),
  )
  if (error) throw new Error(error.message)
}

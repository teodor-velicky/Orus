// Daily targets derived from the profile. Explicit profile values win.

import type { Profile } from './types'

const ACTIVITY_FACTOR: Record<Profile['activity_level'], number> = {
  low: 1.35, moderate: 1.55, high: 1.72, athlete: 1.9,
}

/** Mifflin-St Jeor BMR × activity, adjusted for goal. */
export function kcalTarget(p: Profile | null): number {
  if (p?.kcal_target) return p.kcal_target
  if (!p?.weight_kg || !p.height_cm || !p.birth_year) return p?.sex === 'female' ? 2000 : 2500
  const age = new Date().getFullYear() - p.birth_year
  const bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * age + (p.sex === 'female' ? -161 : 5)
  const tdee = bmr * ACTIVITY_FACTOR[p.activity_level ?? 'moderate']
  const adj = p.goal === 'lose' ? -400 : p.goal === 'gain' ? 300 : 0
  return Math.round((tdee + adj) / 50) * 50
}

/** 1.8 g/kg for people who train; sensible fallback without a weight. */
export function proteinTarget(p: Profile | null): number {
  if (p?.protein_target_g) return p.protein_target_g
  if (p?.weight_kg) return Math.round(p.weight_kg * 1.8)
  return p?.sex === 'female' ? 110 : 140
}

export function macroTargets(p: Profile | null) {
  const kcal = kcalTarget(p)
  const protein = proteinTarget(p)
  const fat = Math.round((kcal * 0.28) / 9)
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  const fiber = p?.sex === 'female' ? 25 : 30
  return { kcal, protein, fat, carbs, fiber }
}

// Energy for runs. Pure.

/**
 * Keytel et al. (2005) HR-based expenditure when average HR, weight and age
 * are known; otherwise the classic ≈ 1 kcal per kg per km of running.
 */
export function runKcal(o: {
  distanceM: number
  durationS: number
  weightKg: number | null | undefined
  avgHr?: number | null
  age?: number | null
  sex?: 'male' | 'female' | null
}): number {
  const w = o.weightKg && o.weightKg > 30 ? o.weightKg : o.sex === 'female' ? 62 : 75
  const byDistance = w * (o.distanceM / 1000) * 1.0
  if (o.avgHr && o.age && o.durationS > 0) {
    const min = o.durationS / 60
    const perMin = o.sex === 'female'
      ? (-20.4022 + 0.4472 * o.avgHr - 0.1263 * w + 0.074 * o.age) / 4.184
      : (-55.0969 + 0.6309 * o.avgHr + 0.1988 * w + 0.2017 * o.age) / 4.184
    const byHr = perMin * min
    // Keytel drifts at low HR; stay within ±35 % of the distance estimate.
    if (byDistance > 0) return Math.round(Math.max(byDistance * 0.65, Math.min(byDistance * 1.35, byHr)))
    return Math.round(Math.max(0, byHr))
  }
  return Math.round(byDistance)
}

/**
 * Share of exercise calories added back to the day's food target. The
 * baseline target already assumes some activity, so only part is eaten back.
 */
export const EAT_BACK = 0.75

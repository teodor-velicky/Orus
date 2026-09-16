import { supabase } from './supabase'
import { computeSystemScores } from './meals'
import { localIso } from './format'
import type { BodySystem, Pattern, SystemScore } from './types'

export const SYSTEM_INFO: Record<BodySystem, { name: string; blurb: string }> = {
  gut_microbiome: {
    name: 'Gut microbiome',
    blurb: 'Plant diversity, fermentable fiber and fermented foods feed a richer microbial ecosystem. 14-day window.',
  },
  digestion: {
    name: 'Digestion',
    blurb: 'FODMAP load, common irritants and steady fiber — what drives day-to-day comfort. 7-day window.',
  },
  metabolic: {
    name: 'Metabolic',
    blurb: 'Glycemic load, added sugar, fiber and processing — the long arc of insulin sensitivity. 28-day window.',
  },
  hormonal: {
    name: 'Hormonal',
    blurb: 'Endocrine cofactors, omega balance, alcohol and energy adequacy. 28-day window.',
  },
  cardiovascular: {
    name: 'Cardiovascular',
    blurb: 'Fiber, omega-3, potassium versus sodium, and processing. 28-day window.',
  },
}

export const SYSTEM_ORDER: BodySystem[] = ['gut_microbiome', 'digestion', 'metabolic', 'hormonal', 'cardiovascular']

/** In-memory hand-off so detail screens don't refetch. */
export const systemCache = new Map<string, { scores: SystemScore[]; patterns: Pattern[] }>()

/**
 * Today's stored scores if fresh, otherwise recompute via the edge function
 * (which also persists them when scoring yourself).
 */
export async function loadSystemScores(userId: string, force = false): Promise<{ scores: SystemScore[]; patterns: Pattern[] }> {
  if (!force) {
    const { data } = await supabase.from('system_scores').select('*')
      .eq('user_id', userId).eq('date', new Date().toISOString().slice(0, 10))
    if (data && data.length === SYSTEM_ORDER.length) {
      const scores = data as unknown as SystemScore[]
      const patterns = scores.find(s => s.system === 'digestion')?.meta.patterns ?? []
      const result = { scores, patterns }
      systemCache.set(userId, result)
      return result
    }
  }
  const res = await computeSystemScores(userId)
  const result = { scores: res.scores, patterns: res.patterns }
  systemCache.set(userId, result)
  return result
}

export const todayKey = () => localIso()

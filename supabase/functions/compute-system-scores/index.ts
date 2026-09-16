// Orus — compute-system-scores edge function (ported from Somata).
//
// Body: { userId?: string }  — defaults to the caller. Scoring a partner is
// allowed because RLS (can_view) already lets circle members read each
// other's meal_analyses; the upsert only happens for the caller's own rows.
//
// Deploy: supabase functions deploy compute-system-scores

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, checkRateLimit } from '../_shared/auth.ts'
import { scoreAllSystems, MealSignal } from '../_shared/scoring.ts'
import { computePatterns, FlaggedMeal, SymptomEvent } from '../_shared/correlations.ts'

const DAILY_CAP = 80

function toSignal(row: Record<string, any>): MealSignal | null {
  const a = row.analysis
  if (!a || a.schema_v !== 2) return null
  return {
    loggedAt: row.logged_at,
    macros: {
      calories: a.macros?.calories ?? 0,
      fiberTotal: a.macros?.fiberTotal ?? 0,
      addedSugar: a.macros?.addedSugar ?? 0,
    },
    micros: a.micros ?? {},
    quality: {
      novaClass: a.quality?.novaClass ?? 3,
      plantSpecies: a.quality?.plantSpecies ?? [],
      fermented: !!a.quality?.fermented,
    },
    gut: {
      fodmapLoad: a.gut?.fodmapLoad ?? 'low',
      irritants: a.gut?.irritants ?? [],
    },
    metabolic: {
      glycemicLoad: a.metabolic?.glycemicLoad ?? 0,
      omega3Mg: a.metabolic?.omega3Mg ?? 0,
      omega6Mg: a.metabolic?.omega6Mg ?? 0,
    },
    minerals: {
      sodiumMg: a.minerals?.sodiumMg ?? { low: 0, high: 0, confidence: 0 },
      potassiumMg: a.minerals?.potassiumMg ?? { low: 0, high: 0, confidence: 0 },
    },
    confidence: {
      overall: a.confidence?.overall ?? 0.5,
      micros: a.confidence?.micros ?? 0.5,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { user, supabase } = await requireUser(req)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

  if (!(await checkRateLimit(user.id, 'compute-system-scores', DAILY_CAP))) {
    return jsonResponse({ error: 'Daily limit reached' }, 429)
  }

  let body: { userId?: string } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const targetId = body.userId ?? user.id

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 28)

  const [{ data: rows, error }, { data: symptomRows }, { data: profile }] = await Promise.all([
    supabase.from('meal_analyses').select('logged_at, analysis')
      .eq('user_id', targetId).gte('logged_at', cutoff.toISOString()),
    supabase.from('symptom_logs').select('type, severity, logged_at')
      .eq('user_id', targetId).gte('logged_at', cutoff.toISOString()),
    supabase.from('profiles').select('sex').eq('id', targetId).maybeSingle(),
  ])

  if (error) {
    console.error('meal_analyses read failed:', error)
    return jsonResponse({ error: 'Could not read meal data' }, 500)
  }

  const signals = (rows ?? []).map(toSignal).filter((s): s is MealSignal => s !== null)
  const sex = profile?.sex === 'female' || profile?.sex === 'male' ? profile.sex : undefined
  const scores = scoreAllSystems(signals, new Date(), sex)

  // Symptom ↔ food-flag correlation (pattern noticed, not causation)
  const flaggedMeals: FlaggedMeal[] = (rows ?? [])
    .filter((r: any) => r.analysis?.schema_v === 2)
    .map((r: any) => ({
      loggedAt: r.logged_at,
      flags: [
        ...(r.analysis.gut?.fodmapLoad === 'high' ? ['high_fodmap'] : []),
        ...(r.analysis.gut?.irritants ?? []),
      ],
    }))
  const symptomEvents: SymptomEvent[] = (symptomRows ?? []).map((s: any) => ({
    type: s.type, severity: s.severity, loggedAt: s.logged_at,
  }))
  const patterns = computePatterns(flaggedMeals, symptomEvents)
  for (const s of scores) {
    if (s.system === 'digestion') (s.meta as any).patterns = patterns
  }

  if (targetId === user.id) {
    const today = new Date().toISOString().slice(0, 10)
    const { error: upsertError } = await supabase.from('system_scores').upsert(
      scores.map((s) => ({
        user_id: user.id, date: today, system: s.system,
        score: s.score, confidence: s.confidence, drivers: s.drivers, meta: s.meta,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,date,system' },
    )
    // Display beats persistence — still return the computed scores
    if (upsertError) console.error('system_scores upsert failed:', upsertError)
  }

  return jsonResponse({ scores, patterns, mealCount: signals.length, symptomCount: symptomEvents.length })
})

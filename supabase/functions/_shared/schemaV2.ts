// Orus analysis schema v2 (ported from Somata).
import { z } from 'npm:zod@3'
import { NUTRIENTS } from './nutrients.ts'

export const CANONICAL_IDS = NUTRIENTS.map((n) => n.id)

const RangeEstimate = z.object({
  low: z.number().min(0),
  high: z.number().min(0),
  confidence: z.number().min(0).max(1),
})

export const V2Schema = z.object({
  items: z.array(z.object({
    name: z.string().min(1),
    estGrams: z.number().min(0),
  })).min(1),
  macros: z.object({
    calories: z.number().min(0),
    protein: z.number().min(0),
    carbs: z.number().min(0),
    fat: z.number().min(0),
    saturatedFat: z.number().min(0).optional(),
    fiberTotal: z.number().min(0),
    fiberSoluble: z.number().min(0).optional(),
    fiberInsoluble: z.number().min(0).optional(),
    sugarTotal: z.number().min(0).optional(),
    addedSugar: z.number().min(0),
  }),
  micros: z.record(z.string(), z.number().min(0)),
  quality: z.object({
    novaClass: z.number().int().min(1).max(4),
    plantSpecies: z.array(z.string()),
    fermented: z.boolean(),
    proteinQuality: z.enum(['complete', 'incomplete', 'none']).optional(),
    additives: z.array(z.string()).optional(),
  }),
  gut: z.object({
    fodmapLoad: z.enum(['low', 'medium', 'high']),
    irritants: z.array(z.enum([
      'lactose', 'gluten', 'capsaicin', 'caffeine', 'alcohol',
      'carbonation', 'artificial_sweeteners', 'high_fat_fried',
    ])),
  }),
  metabolic: z.object({
    glycemicLoad: z.number().min(0),
    omega3Mg: z.number().min(0),
    omega6Mg: z.number().min(0),
  }),
  minerals: z.object({
    sodiumMg: RangeEstimate,
    potassiumMg: RangeEstimate,
  }),
  mealContext: z.enum(['home_cooked', 'restaurant', 'packaged']),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    micros: z.number().min(0).max(1),
  }),
})

export const DisplaySchema = z.object({
  thinkingProcess: z.array(z.string()).optional(),
  foodName: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  summary: z.string(),
  positives: z.array(z.string()),
  improvements: z.array(z.string()),
  nutrientScore: z.object({
    vitamins: z.number().min(0).max(10),
    minerals: z.number().min(0).max(10),
    fiber: z.number().min(0).max(10),
    antioxidants: z.number().min(0).max(10),
  }),
  micronutrients: z.record(z.string(), z.number().min(0)),
  coachMessage: z.string(),
})

export const FullResponseSchema = DisplaySchema.extend({
  v2: V2Schema,
})

export type V2Analysis = z.infer<typeof V2Schema>
export type FullResponse = z.infer<typeof FullResponseSchema>

/** Keep only canonical micro keys; drop model hallucinations. */
export function filterCanonicalMicros(rec: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of CANONICAL_IDS) {
    if (typeof rec[id] === 'number' && isFinite(rec[id])) out[id] = rec[id]
  }
  return out
}

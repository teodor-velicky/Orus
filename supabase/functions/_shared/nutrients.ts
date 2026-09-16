// Orus canonical nutrient registry (ported from Somata, extended).
//
// Canonical IDs are snake_case English and are THE storage keys for
// analyses, meal_logs.micronutrients and all RDI math.
// RDIs are adult (19-50) NIH values; `rdiFemale` overrides where they differ.
//
// Deno copy — KEEP IN SYNC with lib/nutrients.ts (client copy).

export type NutrientCategory = 'vitamin' | 'mineral' | 'other'
export type Sex = 'male' | 'female'

export interface NutrientDef {
  id: string
  label: string
  unit: 'mg' | 'mcg' | 'g'
  rdi: number
  rdiFemale?: number
  category: NutrientCategory
}

export const NUTRIENTS: NutrientDef[] = [
  { id: 'vitamin_a',    label: 'Vitamin A',    unit: 'mcg', rdi: 900,  rdiFemale: 700,  category: 'vitamin' },
  { id: 'vitamin_b1',   label: 'Thiamin (B1)', unit: 'mg',  rdi: 1.2,  rdiFemale: 1.1,  category: 'vitamin' },
  { id: 'vitamin_b2',   label: 'Riboflavin (B2)', unit: 'mg', rdi: 1.3, rdiFemale: 1.1, category: 'vitamin' },
  { id: 'vitamin_b3',   label: 'Niacin (B3)',  unit: 'mg',  rdi: 16,   rdiFemale: 14,   category: 'vitamin' },
  { id: 'vitamin_b6',   label: 'Vitamin B6',   unit: 'mg',  rdi: 1.3,                   category: 'vitamin' },
  { id: 'vitamin_b12',  label: 'Vitamin B12',  unit: 'mcg', rdi: 2.4,                   category: 'vitamin' },
  { id: 'folate',       label: 'Folate',       unit: 'mcg', rdi: 400,                   category: 'vitamin' },
  { id: 'choline',      label: 'Choline',      unit: 'mg',  rdi: 550,  rdiFemale: 425,  category: 'vitamin' },
  { id: 'vitamin_c',    label: 'Vitamin C',    unit: 'mg',  rdi: 90,   rdiFemale: 75,   category: 'vitamin' },
  { id: 'vitamin_d',    label: 'Vitamin D',    unit: 'mcg', rdi: 20,                    category: 'vitamin' },
  { id: 'vitamin_e',    label: 'Vitamin E',    unit: 'mg',  rdi: 15,                    category: 'vitamin' },
  { id: 'vitamin_k',    label: 'Vitamin K',    unit: 'mcg', rdi: 120,  rdiFemale: 90,   category: 'vitamin' },
  { id: 'iron',         label: 'Iron',         unit: 'mg',  rdi: 8,    rdiFemale: 18,   category: 'mineral' },
  { id: 'calcium',      label: 'Calcium',      unit: 'mg',  rdi: 1000,                  category: 'mineral' },
  { id: 'magnesium',    label: 'Magnesium',    unit: 'mg',  rdi: 420,  rdiFemale: 320,  category: 'mineral' },
  { id: 'zinc',         label: 'Zinc',         unit: 'mg',  rdi: 11,   rdiFemale: 8,    category: 'mineral' },
  { id: 'copper',       label: 'Copper',       unit: 'mg',  rdi: 0.9,                   category: 'mineral' },
  { id: 'manganese',    label: 'Manganese',    unit: 'mg',  rdi: 2.3,  rdiFemale: 1.8,  category: 'mineral' },
  { id: 'selenium',     label: 'Selenium',     unit: 'mcg', rdi: 55,                    category: 'mineral' },
  { id: 'iodine',       label: 'Iodine',       unit: 'mcg', rdi: 150,                   category: 'mineral' },
  { id: 'phosphorus',   label: 'Phosphorus',   unit: 'mg',  rdi: 700,                   category: 'mineral' },
  { id: 'potassium',    label: 'Potassium',    unit: 'mg',  rdi: 3400, rdiFemale: 2600, category: 'mineral' },
  { id: 'omega_3',      label: 'Omega-3',      unit: 'mg',  rdi: 1600, rdiFemale: 1100, category: 'other' },
  { id: 'fiber',        label: 'Fiber',        unit: 'g',   rdi: 30,   rdiFemale: 25,   category: 'other' },
  { id: 'antioxidants', label: 'Polyphenols',  unit: 'mg',  rdi: 500,                   category: 'other' },
]

export const NUTRIENT_BY_ID: Record<string, NutrientDef> = Object.fromEntries(
  NUTRIENTS.map(n => [n.id, n]),
)

/** Sex-aware RDI; falls back to the general value. */
export function rdiFor(id: string, sex?: Sex | null): number {
  const def = NUTRIENT_BY_ID[id]
  if (!def) return 0
  return sex === 'female' && def.rdiFemale ? def.rdiFemale : def.rdi
}

// Orus canonical nutrient registry — client copy.
// KEEP IN SYNC with supabase/functions/_shared/nutrients.ts (Deno copy).

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

export function rdiFor(id: string, sex?: Sex | null): number {
  const def = NUTRIENT_BY_ID[id]
  if (!def) return 0
  return sex === 'female' && def.rdiFemale ? def.rdiFemale : def.rdi
}

export function pctOfRdi(id: string, amount: number, sex?: Sex | null): number {
  const rdi = rdiFor(id, sex)
  return rdi ? Math.round((amount / rdi) * 100) : 0
}

export function formatAmount(id: string, amount: number): string {
  const def = NUTRIENT_BY_ID[id]
  const v = amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10
  return def ? `${v} ${def.unit}` : `${v}`
}

/** Sum amount records (e.g. every meal of a day). */
export function sumMicros(records: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of records) {
    for (const [k, v] of Object.entries(r ?? {})) {
      if (typeof v === 'number' && isFinite(v)) out[k] = (out[k] || 0) + v
    }
  }
  return out
}

/**
 * Whole foods that are dense sources of each nutrient — used to turn a gap
 * into something to actually eat. Deliberately short and unglamorous.
 */
export const FOOD_SOURCES: Record<string, string[]> = {
  vitamin_a: ['sweet potato', 'carrots', 'spinach', 'liver'],
  vitamin_b1: ['pork', 'oats', 'sunflower seeds', 'black beans'],
  vitamin_b2: ['eggs', 'Greek yogurt', 'almonds', 'mushrooms'],
  vitamin_b3: ['chicken breast', 'tuna', 'peanuts', 'brown rice'],
  vitamin_b6: ['chickpeas', 'salmon', 'potatoes', 'bananas'],
  vitamin_b12: ['sardines', 'beef', 'eggs', 'skyr'],
  folate: ['lentils', 'asparagus', 'spinach', 'avocado'],
  choline: ['eggs', 'beef liver', 'soybeans', 'cod'],
  vitamin_c: ['bell pepper', 'kiwi', 'broccoli', 'strawberries'],
  vitamin_d: ['salmon', 'sardines', 'egg yolks', 'UV mushrooms'],
  vitamin_e: ['almonds', 'sunflower seeds', 'avocado', 'olive oil'],
  vitamin_k: ['kale', 'spinach', 'broccoli', 'sauerkraut'],
  iron: ['lentils', 'red meat', 'pumpkin seeds', 'tofu'],
  calcium: ['yogurt', 'hard cheese', 'sardines', 'tofu (calcium-set)'],
  magnesium: ['pumpkin seeds', 'dark chocolate', 'almonds', 'black beans'],
  zinc: ['oysters', 'beef', 'pumpkin seeds', 'chickpeas'],
  copper: ['cashews', 'dark chocolate', 'lentils', 'shiitake'],
  manganese: ['oats', 'brown rice', 'hazelnuts', 'pineapple'],
  selenium: ['Brazil nuts', 'tuna', 'eggs', 'sardines'],
  iodine: ['cod', 'seaweed', 'yogurt', 'iodized salt'],
  phosphorus: ['salmon', 'yogurt', 'lentils', 'pumpkin seeds'],
  potassium: ['potatoes', 'white beans', 'bananas', 'spinach'],
  omega_3: ['salmon', 'mackerel', 'sardines', 'walnuts'],
  fiber: ['lentils', 'raspberries', 'oats', 'chia seeds'],
  antioxidants: ['berries', 'dark chocolate', 'green tea', 'red onion'],
}

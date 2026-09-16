// Orus — analyze-meal edge function (ported from Somata, schema v2).
//
// Body:
//   { photos: string[] (base64 JPEG, max 4), description?: string }
//   At least one photo, or a description of >= 3 chars.
//
// Response: { result } — display fields (foodName, overallScore, summary,
// positives, improvements, nutrientScore, micronutrients, coachMessage,
// thinkingProcess) + `v2` structured extraction consumed by the scoring
// engine. Micronutrient keys are canonical ids (see _shared/nutrients.ts).
//
// Deploy:  supabase functions deploy analyze-meal
// Secrets: supabase secrets set OPENAI_API_KEY=sk-...
// Optional: supabase secrets set ANALYZE_MODEL=gpt-4.1

import OpenAI from 'npm:openai@4'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, checkRateLimit } from '../_shared/auth.ts'
import { NUTRIENTS } from '../_shared/nutrients.ts'
import { FullResponseSchema, filterCanonicalMicros } from '../_shared/schemaV2.ts'

const DAILY_CAP = 40
const MODEL = Deno.env.get('ANALYZE_MODEL') ?? 'gpt-4.1'
const TEMPERATURE = 0.3

const MICRO_LINES = NUTRIENTS
  .map((n) => `    "${n.id}": amount of ${n.label} in ${n.unit}`)
  .join(',\n')

const RULES = `You are an expert nutrition analyst for a food-quality app.
Return ONLY valid JSON, no markdown. All text in English.
Micronutrient keys must be EXACTLY the snake_case ids given — they are internal identifiers.
Estimate honestly: when unsure, widen ranges and lower confidence rather than guessing precisely.
Sodium rule: cooking salt is invisible in photos. For restaurant meals assume ~2-2.5x the sodium
of an equivalent home-cooked meal. Express sodium and potassium as {low, high, confidence} ranges.
NOVA classification: 1=unprocessed/minimally processed, 2=processed culinary ingredients,
3=processed foods, 4=ultra-processed.
plantSpecies: list each distinct edible plant species visible/known (e.g. "wheat","tomato","basil").
glycemicLoad: estimated glycemic load of the meal (GL = GI x available carbs / 100).
proteinQuality: "complete" if the protein sources provide all essential amino acids in useful amounts.
additives: likely additives/E-numbers for packaged or ultra-processed components (empty if none).
"antioxidants" means total dietary polyphenols in mg.

PORTION ANCHORS — calibrate every gram estimate against these references:
- A standard dinner plate is 26-28 cm; a side plate 19-21 cm.
- One cupped palm of cooked rice/pasta ≈ 150-180 g; a restaurant serving ≈ 250 g.
- A chicken breast ≈ 150-200 g raw (≈ 120-160 g cooked); a fist-sized potato ≈ 170 g.
- A tablespoon of oil ≈ 14 g; a slice of bread ≈ 40-50 g; one egg ≈ 55-60 g.
- Standard cans: drink 330 ml, tuna 80-120 g drained. Yogurt cups: 125-150 g.
Judge plate coverage and food height, not just area. When torn between two
portion sizes, pick the LARGER for restaurant food and the SMALLER for
home plates — matches observed bias in real logs.

JSON structure:
{
  "thinkingProcess": ["What I see: ...", "Estimated ingredients: ...", "Nutritional assessment: ...", "How I computed micronutrients: ..."],
  "foodName": "short natural meal name",
  "overallScore": 0-100 food quality score,
  "summary": "2-3 sentence assessment",
  "positives": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["improvement 1", "improvement 2"],
  "nutrientScore": { "vitamins": 0-10, "minerals": 0-10, "fiber": 0-10, "antioxidants": 0-10 },
  "micronutrients": {
${MICRO_LINES}
  },
  "coachMessage": "short practical message about this meal",
  "v2": {
    "items": [{ "name": "component", "estGrams": number }],
    "macros": { "calories": n, "protein": g, "carbs": g, "fat": g, "saturatedFat": g, "fiberTotal": g, "fiberSoluble": g, "fiberInsoluble": g, "sugarTotal": g, "addedSugar": g },
    "micros": { same keys and values as "micronutrients" above },
    "quality": { "novaClass": 1-4, "plantSpecies": ["..."], "fermented": bool, "proteinQuality": "complete"|"incomplete"|"none", "additives": ["..."] },
    "gut": { "fodmapLoad": "low"|"medium"|"high", "irritants": ["lactose"|"gluten"|"capsaicin"|"caffeine"|"alcohol"|"carbonation"|"artificial_sweeteners"|"high_fat_fried"] },
    "metabolic": { "glycemicLoad": n, "omega3Mg": n, "omega6Mg": n },
    "minerals": { "sodiumMg": {"low": n, "high": n, "confidence": 0-1}, "potassiumMg": {"low": n, "high": n, "confidence": 0-1} },
    "mealContext": "home_cooked"|"restaurant"|"packaged",
    "confidence": { "overall": 0-1, "micros": 0-1 }
  }
}`

const PHOTO_INSTRUCTIONS = `Analyze this ENTIRE MEAL as one. The attached photo(s) may show different
components or angles of the same meal. FIRST think about what you actually see.
- "v2.items" lists every component with estimated grams.
- All macros, micronutrients, glycemic load, sodium/potassium are TOTALS for the whole meal.
- Use the user's description (if any) to resolve ingredients, portions and preparation.`

const DESCRIPTION_INSTRUCTIONS = `Analyze this meal from the user's TEXT DESCRIPTION alone.
Estimate realistic portion sizes from typical servings whenever the user does not specify amounts
(e.g. "a bowl of rice" ≈ 200 g cooked). Produce ONE combined analysis for the whole described meal:
"v2.items" lists each component with your estimated grams; macros and micronutrients are totals.
Set confidence lower than a photo analysis would get — text is the least precise input.`

function parseAndValidate(text: string) {
  const clean = text.replace(/```json|```/g, '').trim()
  const parsed = FullResponseSchema.parse(JSON.parse(clean))
  return {
    ...parsed,
    micronutrients: filterCanonicalMicros(parsed.micronutrients),
    v2: { ...parsed.v2, micros: filterCanonicalMicros(parsed.v2.micros), schema_v: 2 },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { user } = await requireUser(req)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

  if (!(await checkRateLimit(user.id, 'analyze-meal', DAILY_CAP))) {
    return jsonResponse({ error: 'Daily analysis limit reached' }, 429)
  }

  let body: { photos?: string[]; description?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const photos = Array.isArray(body.photos) ? body.photos.filter((p) => typeof p === 'string') : []
  const description = body.description?.trim().slice(0, 1200) ?? ''

  if (photos.length > 4) return jsonResponse({ error: 'Too many photos (max 4 per meal)' }, 400)
  if (photos.some((p) => p.length > 8_000_000)) return jsonResponse({ error: 'Image too large' }, 413)
  if (photos.length === 0 && description.length < 3) {
    return jsonResponse({ error: 'Provide at least one photo or a description' }, 400)
  }

  let messages: OpenAI.ChatCompletionMessageParam[]
  if (photos.length > 0) {
    const detailsText = description ? `\n\nUser description: "${description}"` : ''
    messages = [{
      role: 'user',
      content: [
        ...photos.map((p) => ({
          type: 'image_url' as const,
          image_url: { url: `data:image/jpeg;base64,${p.trim()}`, detail: 'high' as const },
        })),
        { type: 'text' as const, text: `${RULES}\n\n${PHOTO_INSTRUCTIONS}${detailsText}` },
      ],
    }]
  } else {
    messages = [{
      role: 'user',
      content: `${RULES}\n\n${DESCRIPTION_INSTRUCTIONS}\n\nMeal description:\n"${description}"`,
    }]
  }

  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })
  const callModel = async () => {
    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      max_tokens: 3200,
      response_format: { type: 'json_object' },
      messages,
    })
    return response.choices[0]?.message?.content ?? ''
  }

  try {
    try {
      return jsonResponse({ result: parseAndValidate(await callModel()) })
    } catch (_firstError) {
      // One retry on malformed output
      return jsonResponse({ result: parseAndValidate(await callModel()) })
    }
  } catch (e) {
    console.error('analyze-meal failed:', e)
    return jsonResponse({ error: 'Analysis failed, please try again' }, 502)
  }
})

// Orus — analyze-run edge function.
//
// Body: { runId, summary }
//   summary is a compact description of the run built on the device
//   (lib/run/analysis.ts): distance, pace, splits, HR zones, decoupling,
//   training effect, goal and recent training. No raw GPS or HR leaves the app.
//
// Response: { analysis: { headline, summary, highlights[], suggestions[], generatedAt } }
// The analysis is also stored on the run (RLS: owner only).
//
// Deploy:  supabase functions deploy analyze-run
// Secrets: OPENAI_API_KEY (shared with analyze-meal); optional RUN_MODEL

import OpenAI from 'npm:openai@4'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, checkRateLimit } from '../_shared/auth.ts'

const DAILY_CAP = 20
const MODEL = Deno.env.get('RUN_MODEL') ?? Deno.env.get('ANALYZE_MODEL') ?? 'gpt-4.1'

const SYSTEM = `You are a concise, evidence-based running coach inside a health app.
You receive a structured summary of ONE run plus the runner's recent training and goal.
Write a brief analysis. Rules:
- Only use numbers present in the summary. Never invent data (no cadence, no weather unless given).
- Heart-rate zones are personal (Karvonen). Decoupling < 5% = good aerobic durability.
- Judge the run against its apparent intent (easy / tempo / intervals / long) and the goal.
- Easy runs that drifted into zone 3+ are a common mistake — point it out kindly.
- Be specific and practical. No medical advice. No emojis. Plain English.
Return ONLY JSON:
{
  "headline": "max 8 words",
  "summary": "2-3 sentences",
  "highlights": ["1-3 short observations grounded in the data"],
  "suggestions": ["1-3 concrete, actionable next steps"]
}`

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '')
const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => clip(x, 220)).filter(Boolean).slice(0, n) : [])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { user, supabase } = await requireUser(req)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)
  if (!(await checkRateLimit(user.id, 'analyze-run', DAILY_CAP))) {
    return jsonResponse({ error: 'Daily analysis limit reached' }, 429)
  }

  let body: { runId?: string; summary?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }
  const summary = JSON.stringify(body.summary ?? null)
  if (!body.summary || summary.length > 12_000) return jsonResponse({ error: 'Missing or oversized summary' }, 400)

  try {
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })
    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Run summary:\n${summary}` },
      ],
    })
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}')
    const analysis = {
      headline: clip(parsed.headline, 80) || 'Run analysis',
      summary: clip(parsed.summary, 700),
      highlights: list(parsed.highlights, 3),
      suggestions: list(parsed.suggestions, 3),
      generatedAt: new Date().toISOString(),
    }
    if (body.runId) {
      // Scoped to the caller's JWT — RLS only lets owners update their runs.
      await supabase.from('runs').update({ analysis }).eq('id', body.runId).eq('user_id', user.id)
    }
    return jsonResponse({ analysis })
  } catch (e) {
    console.error('analyze-run failed:', e)
    return jsonResponse({ error: 'Analysis failed, please try again' }, 502)
  }
})

import assert from 'node:assert/strict'
import { planWeek, trainingPaces } from '../plan'
import { advance, initialStep, paceCue, paceStatus, progress, stepCue, Workout } from '../workout'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name) }

const intervals: Workout = {
  title: 'VO₂ intervals', kind: 'intervals',
  steps: [
    { kind: 'warmup', label: 'Warm-up', distanceM: 2000, pace: { fast: 320, slow: 380 }, alert: 'fast' },
    { kind: 'work', label: '1 km hard', distanceM: 1000, pace: { fast: 230, slow: 240 }, alert: 'both', rep: { n: 1, of: 2 } },
    { kind: 'recovery', label: 'Jog', durationS: 150, alert: 'none' },
    { kind: 'work', label: '1 km hard', distanceM: 1000, pace: { fast: 230, slow: 240 }, alert: 'both', rep: { n: 2, of: 2 } },
    { kind: 'cooldown', label: 'Cool-down', distanceM: 1500, alert: 'none' },
  ],
}

test('steps advance on distance and on time', () => {
  let st = initialStep()
  st = advance(intervals, st, 1990, 600)
  assert.equal(st.index, 0)
  st = advance(intervals, st, 2003, 610)
  assert.deepEqual(st, { index: 1, startM: 2003, startS: 610, complete: false })
  const p = progress(intervals, st, 2503, 730)
  assert.equal(p.remaining, 500)
  assert.equal(p.unit, 'm')
  assert.equal(p.fraction, 0.5)
  st = advance(intervals, st, 3004, 845)
  assert.equal(st.index, 2)
  // Recovery is timed: standing still still finishes it
  assert.equal(advance(intervals, st, 3004, 990).index, 2)
  st = advance(intervals, st, 3004, 995)
  assert.equal(st.index, 3)
  assert.equal(progress(intervals, st, 3004, 995).next?.kind, 'cooldown')
})

test('skip and completion', () => {
  let st = initialStep()
  for (let i = 0; i < 5; i++) st = advance(intervals, st, 100 * i, 10 * i, true)
  assert.equal(st.complete, true)
  assert.equal(progress(intervals, st, 0, 0).step, null)
  assert.equal(advance(intervals, st, 9999, 9999, true), st)
})

test('pace feedback respects alert mode and settle time', () => {
  const warm = intervals.steps[0], work = intervals.steps[1], jog = intervals.steps[2]
  assert.equal(paceStatus(work, 220, 10), null) // first 20 s ignored
  assert.equal(paceStatus(work, 220, 40), 'fast')
  assert.equal(paceStatus(work, 250, 40), 'slow')
  assert.equal(paceStatus(work, 235, 40), 'on')
  assert.equal(paceStatus(warm, 300, 60), 'fast')
  assert.equal(paceStatus(warm, 420, 60), 'on') // easy running never nags about slow
  assert.equal(paceStatus(jog, 200, 60), null)
  assert.match(paceCue('fast', work)!, /Too fast/)
  assert.match(stepCue(work), /Rep 1 of 2/)
})

test('every recommended session has a guided workout', () => {
  const p = trainingPaces(48)
  const goal = { distanceM: 5000, targetS: 1199 }
  const plan = planWeek({ today: '2026-09-15', goal, vdot: 48, runs: [], readiness: 80, form: 0 })
  for (const d of plan.days) {
    if (d.kind === 'rest') { assert.equal(d.workout, null); continue }
    assert.ok(d.workout && d.workout.steps.length > 0, d.kind)
  }
  const iv = plan.days[0].workout!
  assert.equal(plan.days[0].kind, 'intervals')
  const work = iv.steps.filter(s => s.kind === 'work')
  assert.ok(work.length >= 3)
  assert.equal(iv.steps.filter(s => s.kind === 'recovery').length, work.length - 1)
  assert.ok(work[0].pace && Math.abs((work[0].pace.fast + work[0].pace.slow) / 2 - p.interval) <= 1)
  assert.equal(iv.steps[0].kind, 'warmup')
  assert.equal(iv.steps[iv.steps.length - 1].kind, 'cooldown')
  const tempo = plan.days.find(d => d.kind === 'tempo')!.workout!
  assert.equal(tempo.steps[1].alert, 'both')
})

console.log(`\n${passed} passed`)

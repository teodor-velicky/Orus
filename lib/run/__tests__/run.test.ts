import assert from 'node:assert/strict'
import { bestEfforts, cleanTrack, elevationGain, fastestSegment, GeoPoint, haversine, movingTime, paceText, raceTime, simplify, splits, trackDistance } from '../geo'
import { decoupling, estimateMaxHr, hrZones, timeInZones, trainingEffect, trimp, zoneOf } from '../zones'
import { assessGoal, classifyRun, currentVdot, planWeek, timeForVdot, trainingPaces, vdot } from '../plan'
import { fitnessSeries, formRatio, runLoadNoHr } from '../load'
import { runKcal } from '../kcal'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name) }

/** Straight line north at a constant pace (s/km), one fix per `step` s. */
function line(distanceM: number, paceS: number, step = 2, t0 = 0, seg = 0, lat0 = 48.14): GeoPoint[] {
  const speed = 1000 / paceS
  const n = Math.ceil(distanceM / speed / step)
  return Array.from({ length: n + 1 }, (_, i) => ({ t: t0 + i * step * 1000, lat: lat0 + Math.min(distanceM, i * step * speed) / 111_195, lng: 17.1, alt: 150, seg }))
}

test('haversine ~111 km per degree latitude', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111_195) < 50)
})

test('distance, splits and pace on a 5 km steady run', () => {
  const pts = line(5000, 300)
  assert.ok(Math.abs(trackDistance(pts) - 5000) < 5)
  const s = splits(pts)
  assert.equal(s.length, 5)
  for (const x of s) assert.ok(Math.abs(x.paceS - 300) <= 2, `pace ${x.paceS}`)
  assert.equal(paceText(272), '4:32')
  assert.equal(raceTime(1199), '19:59')
  assert.equal(raceTime(5025), '1:23:45')
})

test('pauses are excluded from distance and split time', () => {
  const a = line(1500, 300)
  const lastA = a[a.length - 1]
  // Resume 10 minutes later, 200 m further on (walked while paused)
  const b = line(1500, 300, 2, lastA.t + 600_000, 1, lastA.lat + 200 / 111_195)
  const pts = [...a, ...b]
  assert.ok(Math.abs(trackDistance(pts) - 3000) < 10)
  const s = splits(pts)
  assert.ok(Math.abs(s[1].paceS - 300) <= 3, `split 2 pace ${s[1].paceS}`)
  assert.ok(Math.abs(movingTime(pts) - 900) < 10)
})

test('GPS jumps and inaccurate fixes are dropped', () => {
  const pts = line(1000, 300)
  pts.splice(50, 0, { t: pts[50].t - 500, lat: 48.2, lng: 17.1, seg: 0 })
  pts.push({ t: pts[pts.length - 1].t + 2000, lat: 48.15, lng: 17.1, acc: 80 })
  assert.ok(Math.abs(trackDistance(cleanTrack(pts)) - 1000) < 10)
})

test('fastest segment finds the hard kilometre', () => {
  const easy = line(2000, 330)
  const last = easy[easy.length - 1]
  const hard = line(1000, 240, 2, last.t, 0, last.lat).slice(1)
  const pts = [...easy, ...hard]
  const best = fastestSegment(pts, 1000)!
  assert.ok(best >= 238 && best <= 250, `best 1k ${best}`)
  assert.equal(bestEfforts(pts)['5000'], undefined)
})

test('elevation gain ignores small noise', () => {
  const pts = line(1000, 300).map((p, i) => ({ ...p, alt: 100 + (i % 2) * 2 + i * 0.1 }))
  const g = elevationGain(pts)
  assert.ok(g >= 8 && g <= 16, `gain ${g}`)
})

test('simplify keeps a straight line to its endpoints', () => {
  assert.equal(simplify(line(3000, 300)).length, 2)
})

test('simplify keeps the shape of a closed loop', () => {
  const loop: GeoPoint[] = Array.from({ length: 361 }, (_, i) => ({
    t: i * 3000, lat: 48.14 + Math.sin((i * Math.PI) / 180) * 0.005, lng: 17.1 + Math.cos((i * Math.PI) / 180) * 0.0075 - 0.0075,
  }))
  const out = simplify(loop, 3)
  assert.ok(out.length > 20, `kept ${out.length}`)
  assert.ok(Math.abs(trackDistance(out) - trackDistance(loop)) / trackDistance(loop) < 0.01)
})

test('karvonen zones and time in zone', () => {
  assert.equal(estimateMaxHr(30), 187)
  const z = hrZones(190, 50)
  assert.deepEqual([z[0].lo, z[1].lo, z[2].lo, z[3].lo, z[4].lo, z[4].hi], [120, 134, 148, 162, 176, 190])
  assert.equal(zoneOf(150, z), 3)
  assert.equal(zoneOf(100, z), 0)
  const hr = Array.from({ length: 121 }, (_, i) => ({ t: i * 5000, bpm: i < 60 ? 140 : 180 }))
  const t = timeInZones(hr, z)
  assert.equal(t[1], 300)
  assert.equal(t[4], 305)
  assert.equal(trainingEffect(t)!.label, 'VO₂ max')
})

test('trimp scale: easy hour ≈ 60–110', () => {
  const hr = Array.from({ length: 721 }, (_, i) => ({ t: i * 5000, bpm: 140 }))
  const v = trimp(hr, 50, 190, 'male')
  assert.ok(v > 60 && v < 110, `trimp ${v}`)
})

test('decoupling detects drift', () => {
  const speed = Array(20).fill(3)
  const hr = [...Array(10).fill(140), ...Array(10).fill(154)]
  assert.equal(decoupling(speed, hr), 9.1)
})

test('VDOT matches Daniels tables', () => {
  assert.ok(Math.abs(vdot(5000, 1200) - 49.8) < 0.2)
  assert.ok(Math.abs(timeForVdot(49.8, 5000) - 1200) < 5)
  // VDOT 50 marathon ≈ 3:10:49
  assert.ok(Math.abs(timeForVdot(50, 42195) - 11449) < 120, `M ${timeForVdot(50, 42195)}`)
  const p = trainingPaces(50)
  assert.ok(Math.abs(p.threshold - 255) <= 4, `T ${p.threshold}`)
  assert.ok(Math.abs(p.interval - 235) <= 4, `I ${p.interval}`)
})

test('goal assessment for a sub-20 5K', () => {
  const today = '2026-09-16'
  const a = assessGoal({ distanceM: 5000, targetS: 1199, raceDate: '2026-12-09' }, 46.5, today)
  assert.equal(a.title, 'Sub 19:59 5K')
  assert.equal(a.weeksLeft, 12)
  assert.equal(a.status, 'on_track')
  assert.ok(a.predictedS! > 1260 && a.predictedS! < 1300, `pred ${a.predictedS}`)
  assert.equal(assessGoal({ distanceM: 5000, targetS: 1199 }, 38, today).status, 'long_term')
  assert.equal(assessGoal({ distanceM: 5000, targetS: 1199 }, 51, today).status, 'achieved')
  assert.equal(assessGoal({ distanceM: 5000, targetS: 1199 }, null, today).status, 'unknown')
})

test('current VDOT uses the best recent effort', () => {
  const runs = [
    { date: '2026-09-10', distanceM: 8000, durationS: 8 * 330, kind: 'easy' as const },
    { date: '2026-09-12', distanceM: 6000, durationS: 6 * 300, kind: 'tempo' as const, bestEfforts: { 5000: 1290 } },
    { date: '2026-06-01', distanceM: 5000, durationS: 1150, kind: 'race' as const },
  ]
  const v = currentVdot(runs, '2026-09-16')!
  assert.ok(Math.abs(v - vdot(5000, 1290)) < 0.1, `vdot ${v}`)
})

test('classification from zones and pace', () => {
  assert.equal(classifyRun(8000, 2800, [300, 2200, 200, 50, 0], null, 7), 'easy')
  assert.equal(classifyRun(16000, 5600, [300, 4800, 400, 100, 0], null, 7), 'long')
  assert.equal(classifyRun(10000, 2700, [200, 400, 300, 1300, 500], null, 7), 'intervals')
  assert.equal(classifyRun(8000, 8 * 250, null, trainingPaces(50), 7), 'tempo')
})

test('plan adapts today for low readiness and a hard yesterday', () => {
  // 2026-09-15 is a Tuesday → key day in the 5K template
  const goal = { distanceM: 5000, targetS: 1199 }
  const runs = [{ date: '2026-09-10', distanceM: 10000, durationS: 3300, kind: 'easy' as const }]
  const base = planWeek({ today: '2026-09-15', goal, vdot: 47, runs, readiness: 80, form: 0 })
  assert.equal(base.days.length, 7)
  assert.equal(base.days[0].kind, 'intervals')
  assert.ok(base.paces)
  const tired = planWeek({ today: '2026-09-15', goal, vdot: 47, runs, readiness: 35, form: 0 })
  assert.equal(tired.days[0].kind, 'rest')
  assert.ok(tired.days[0].reason)
  const afterHard = planWeek({ today: '2026-09-15', goal, vdot: 47, runs: [...runs, { date: '2026-09-14', distanceM: 16000, durationS: 5400, kind: 'long' }], readiness: 80, form: 0 })
  assert.equal(afterHard.days[0].kind, 'easy')
  assert.ok(base.weekKm >= 12)
})

test('fitness, fatigue and form', () => {
  const events = Array.from({ length: 61 }, (_, i) => ({ date: `2026-${i < 31 ? '07' : '08'}-${String(i < 31 ? i + 1 : i - 30).padStart(2, '0')}`, load: 70 }))
  const s = fitnessSeries(events, '2026-07-01', '2026-08-30')
  const last = s[s.length - 1]
  assert.ok(last.ctl > 40 && last.atl > 65, JSON.stringify(last))
  assert.ok(formRatio(last)! < 0)
  assert.equal(formRatio({ date: '', load: 0, atl: 0, ctl: 2, tsb: 0 }), null)
  assert.ok(runLoadNoHr(3600, 330, 255) < runLoadNoHr(3600, 255, 255))
})

test('run calories', () => {
  assert.equal(runKcal({ distanceM: 10000, durationS: 3000, weightKg: 75 }), 750)
  const hr = runKcal({ distanceM: 10000, durationS: 3000, weightKg: 75, avgHr: 150, age: 28, sex: 'male' })
  assert.ok(hr > 600 && hr < 900, `kcal ${hr}`)
})

console.log(`\n${passed} passed`)

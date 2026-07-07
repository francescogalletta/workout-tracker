import { describe, expect, it } from 'vitest'
import {
  detectPlateau,
  lastSessionStats,
  prescribe,
  type WorkingSet,
} from './reco'

const set = (weightKg: number, reps: number, rir: number | null = 2): WorkingSet => ({
  weightKg,
  reps,
  rir,
})

/** A uniform session: n sets of w × reps @ rir. */
const session = (w: number, reps: number, rir: number | null, n = 4): WorkingSet[] =>
  Array.from({ length: n }, () => set(w, reps, rir))

describe('lastSessionStats', () => {
  it('summarizes a session (mode weight, averages, line)', () => {
    const st = lastSessionStats(session(60, 10, 3, 4))!
    expect(st).toMatchObject({ weightKg: 60, sets: 4, avgReps: 10, avgRir: 3 })
    expect(st.line).toBe('4×10 @ RIR 3')
  })

  it('picks the most frequent weight; ties go to the heavier one', () => {
    expect(lastSessionStats([set(60, 8), set(62.5, 8), set(62.5, 8)])!.weightKg).toBe(62.5)
    expect(lastSessionStats([set(60, 8), set(62.5, 8)])!.weightKg).toBe(62.5)
  })

  it('averages RIR over recorded sets only; all-null → null and an em-dash line', () => {
    const st = lastSessionStats([set(60, 8, null), set(60, 8, 2)])!
    expect(st.avgRir).toBe(2)
    const none = lastSessionStats([set(60, 8, null), set(60, 8, null)])!
    expect(none.avgRir).toBeNull()
    expect(none.line).toBe('2×8 @ RIR —')
  })

  it('returns null for an empty session', () => {
    expect(lastSessionStats([])).toBeNull()
  })
})

describe('prescribe', () => {
  it('no history → first time (empty input, no reason)', () => {
    expect(prescribe([], 8, 2, 2.5)).toEqual({
      action: 'first',
      weightKg: null,
      reason: null,
      last: null,
    })
  })

  it('skips empty sessions when finding the last one', () => {
    const p = prescribe([[], session(60, 8, 2)], 8, 2, 2.5)
    expect(p.action).toBe('repeat')
    expect(p.weightKg).toBe(60)
  })

  it('surplus ≥ 3 → +2 increments (the spec example: 4×10 @ RIR 3 vs 8 @ RIR 2)', () => {
    const p = prescribe([session(60, 10, 3)], 8, 2, 2.5)
    expect(p.action).toBe('increase2')
    expect(p.weightKg).toBe(65)
    expect(p.reason).toBe('↑ +5 kg — last time 4×10 @ RIR 3 vs target 8 @ RIR 2')
  })

  it('surplus exactly 1 → +1 increment', () => {
    const p = prescribe([session(60, 9, 2)], 8, 2, 2.5)
    expect(p.action).toBe('increase1')
    expect(p.weightKg).toBe(62.5)
    expect(p.reason).toContain('↑ +2.5 kg')
  })

  it('surplus just under the thresholds falls through (2.9 → +1, 0.5 → repeat)', () => {
    // avg reps 10, avg RIR 2.9 → surplus 2.9 → one increment only
    const almost3 = [set(60, 10, 3), set(60, 10, 3), set(60, 10, 3), set(60, 10, 2.6)]
    expect(prescribe([almost3], 8, 2, 2.5).action).toBe('increase1')
    const under1 = [set(60, 8, 2), set(60, 9, 2), set(60, 8, 2), set(60, 9, 2)] // surplus 0.5
    expect(prescribe([under1], 8, 2, 2.5).action).toBe('repeat')
  })

  it('−1 < surplus < 1 → repeat, with a reason line', () => {
    const p = prescribe([session(62.5, 8, 2)], 8, 2, 2.5)
    expect(p.action).toBe('repeat')
    expect(p.weightKg).toBe(62.5)
    expect(p.reason).toBe('Repeat 62.5 kg — last time 4×8 @ RIR 2 vs target 8 @ RIR 2')
  })

  it('surplus ≤ −1 without repeated big rep misses → still repeat', () => {
    // avg reps 7 (miss by 1), rir 2 → surplus −1, no set missed by ≥2
    const p = prescribe([session(60, 7, 2)], 8, 2, 2.5)
    expect(p.action).toBe('repeat')
    expect(p.weightKg).toBe(60)
  })

  it('missed target reps by ≥2 on multiple sets → decrease one increment', () => {
    const sets = [set(60, 6), set(60, 6), set(60, 8), set(60, 8)] // two sets at −2
    const p = prescribe([sets], 8, 2, 2.5)
    expect(p.action).toBe('decrease')
    expect(p.weightKg).toBe(57.5)
    expect(p.reason).toContain('↓ −2.5 kg')
  })

  it('a single big miss is not enough to decrease', () => {
    const sets = [set(60, 6), set(60, 8), set(60, 8), set(60, 5, null)]
    // avgReps 6.75, avgRir 2 → surplus −1.25; sets ≤6: two? 6 and 5 → decrease
    expect(prescribe([sets], 8, 2, 2.5).action).toBe('decrease')
    const single = [set(60, 6), set(60, 8), set(60, 7), set(60, 7)]
    // surplus −1: reps ≤ 6 only once → repeat
    expect(prescribe([single], 8, 2, 2.5).action).toBe('repeat')
  })

  it('decrease clamps at 0 for weighted loads but not for assisted (negative)', () => {
    expect(prescribe([session(1, 6, 0, 4)], 8, 2, 2.5).weightKg).toBe(0)
    // assisted pull-up at −20: beating targets moves toward zero assistance
    const p = prescribe([session(-20, 10, 3)], 8, 2, 2.5)
    expect(p.action).toBe('increase2')
    expect(p.weightKg).toBe(-15)
    // and a bad day adds assistance
    const bad = prescribe([session(-20, 5, 0)], 8, 2, 2.5)
    expect(bad.action).toBe('decrease')
    expect(bad.weightKg).toBe(-22.5)
  })

  it('sets without RIR contribute no RIR term to the surplus', () => {
    const p = prescribe([session(60, 11, null)], 8, 2, 2.5)
    expect(p.action).toBe('increase2') // reps surplus 3 alone
  })

  it('respects the configured increment (1.25)', () => {
    const p = prescribe([session(30, 9, 2)], 8, 2, 1.25)
    expect(p.weightKg).toBe(31.25)
    expect(p.reason).toContain('↑ +1.25 kg')
  })
})

describe('detectPlateau', () => {
  const target = { reps: 12, rir: 1 }
  const flat = (w: number) => session(w, target.reps, target.rir, 3) // surplus 0

  it('flags 3 consecutive repeat-or-worse sessions at the same weight', () => {
    const text = detectPlateau([flat(25), flat(25), flat(25)], target.reps, target.rir, 2.5)
    expect(text).toBe('Plateau — 3rd session at 25 kg. Consider a deload: ~−10% = 22.5 kg.')
  })

  it('needs at least 3 sessions', () => {
    expect(detectPlateau([flat(25), flat(25)], target.reps, target.rir, 2.5)).toBeNull()
    expect(detectPlateau([], target.reps, target.rir, 2.5)).toBeNull()
  })

  it('a weight change inside the last 3 sessions breaks the streak', () => {
    expect(
      detectPlateau([flat(25), flat(22.5), flat(25)], target.reps, target.rir, 2.5),
    ).toBeNull()
  })

  it('an earned increase (surplus ≥ 1) breaks the streak', () => {
    const good = session(25, target.reps + 1, target.rir, 3) // surplus 1
    expect(detectPlateau([good, flat(25), flat(25)], target.reps, target.rir, 2.5)).toBeNull()
    // ...but older good sessions beyond the streak don't matter
    expect(
      detectPlateau([flat(25), flat(25), flat(25), good], target.reps, target.rir, 2.5),
    ).not.toBeNull()
  })

  it('longer streaks report their ordinal and round the deload to the increment', () => {
    const text = detectPlateau(
      [flat(60), flat(60), flat(60), flat(60)],
      target.reps,
      target.rir,
      2.5,
    )
    expect(text).toContain('4th session at 60 kg')
    expect(text).toContain('= 55 kg') // 54 → half-up grid at 2.5 → 55
  })
})

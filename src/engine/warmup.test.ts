import { describe, expect, it } from 'vitest'
import { roundToIncrement } from './round'
import { warmupSets } from './warmup'

describe('roundToIncrement', () => {
  it('rounds to the nearest multiple of the increment', () => {
    expect(roundToIncrement(27, 2.5)).toBe(27.5)
    expect(roundToIncrement(26, 2.5)).toBe(25)
    expect(roundToIncrement(22.5, 2.5)).toBe(22.5)
    expect(roundToIncrement(61.9, 1.25)).toBe(62.5)
    expect(roundToIncrement(9, 5)).toBe(10)
  })

  it('rounds exact halves down (toward the lighter plate)', () => {
    expect(roundToIncrement(31.25, 2.5)).toBe(30) // 50% of 62.5 → 30, per spec story
    expect(roundToIncrement(43.75, 2.5)).toBe(42.5)
    expect(roundToIncrement(0.625, 1.25)).toBe(0)
  })

  it('is exact on the grid and tolerant of FP noise', () => {
    expect(roundToIncrement(62.5 * 0.5, 1.25)).toBe(31.25)
    expect(roundToIncrement(0.1 + 0.2, 0.5)).toBe(0.5)
  })

  it('returns the input for a non-positive increment', () => {
    expect(roundToIncrement(31.3, 0)).toBe(31.3)
  })
})

describe('warmupSets', () => {
  it('generates 50%×8 + 70%×5 rounded to the increment', () => {
    expect(warmupSets(60, 2.5)).toEqual([
      { weightKg: 30, reps: 8 },
      { weightKg: 42.5, reps: 5 },
    ])
    // the spec's own example: working 62.5 → warm-up 30 kg × 8
    expect(warmupSets(62.5, 2.5)).toEqual([
      { weightKg: 30, reps: 8 },
      { weightKg: 42.5, reps: 5 },
    ])
  })

  it('respects the configured increment', () => {
    expect(warmupSets(62.5, 1.25)).toEqual([
      { weightKg: 31.25, reps: 8 },
      { weightKg: 43.75, reps: 5 },
    ])
    expect(warmupSets(60, 5)).toEqual([
      { weightKg: 30, reps: 8 },
      { weightKg: 40, reps: 5 }, // 42 → half-down grid at 5s → 40
    ])
  })

  it('uses a single 50%×8 below 20 kg', () => {
    expect(warmupSets(17.5, 2.5)).toEqual([{ weightKg: 7.5, reps: 8 }])
    expect(warmupSets(19.9, 2.5)).toEqual([{ weightKg: 10, reps: 8 }])
  })

  it('treats exactly 20 kg as heavy enough for both sets', () => {
    expect(warmupSets(20, 2.5)).toEqual([
      { weightKg: 10, reps: 8 },
      { weightKg: 15, reps: 5 },
    ])
  })

  it('returns nothing for first-time or zero weights', () => {
    expect(warmupSets(null, 2.5)).toEqual([])
    expect(warmupSets(0, 2.5)).toEqual([])
    expect(warmupSets(-20, 2.5)).toEqual([]) // assisted: no meaningful % warm-up
  })
})

import { describe, expect, it } from 'vitest'
import {
  FINE_HOLD_MS,
  FINE_SLOW_SUSTAIN_MS,
  REST_MAX,
  REST_MIN,
  REST_TICKS,
  clampRest,
  isFineDrag,
  posToSec,
  secToFrac,
  slowStreak,
  snapRest,
} from './restSliderMath'

describe('snapRest', () => {
  it('snaps to 30s detents when coarse', () => {
    expect(snapRest(44, false)).toBe(30)
    expect(snapRest(46, false)).toBe(60)
    expect(snapRest(100, false)).toBe(90)
    expect(snapRest(166, false)).toBe(180)
  })

  it('snaps to 5s increments when fine', () => {
    expect(snapRest(44, true)).toBe(45)
    expect(snapRest(97, true)).toBe(95)
    expect(snapRest(98, true)).toBe(100)
  })

  it('clamps to the 30–180 range in both modes', () => {
    expect(snapRest(0, false)).toBe(REST_MIN)
    expect(snapRest(0, true)).toBe(REST_MIN)
    expect(snapRest(999, false)).toBe(REST_MAX)
    expect(snapRest(999, true)).toBe(REST_MAX)
  })
})

describe('clampRest / secToFrac', () => {
  it('clamps legacy out-of-range values for display', () => {
    expect(clampRest(10)).toBe(30)
    expect(clampRest(240)).toBe(180)
    expect(secToFrac(10)).toBe(0)
    expect(secToFrac(240)).toBe(1)
  })

  it('maps the range endpoints and midpoint', () => {
    expect(secToFrac(30)).toBe(0)
    expect(secToFrac(180)).toBe(1)
    expect(secToFrac(105)).toBeCloseTo(0.5)
  })
})

describe('posToSec', () => {
  it('maps track pixels linearly and clamps outside the track', () => {
    expect(posToSec(0, 300)).toBe(30)
    expect(posToSec(300, 300)).toBe(180)
    expect(posToSec(150, 300)).toBe(105)
    expect(posToSec(-50, 300)).toBe(30)
    expect(posToSec(400, 300)).toBe(180)
    expect(posToSec(100, 0)).toBe(30) // degenerate width
  })
})

describe('isFineDrag', () => {
  it('slow drags are fine, fast drags coarse', () => {
    expect(isFineDrag(0.1, 0)).toBe(true)
    expect(isFineDrag(0.8, 0)).toBe(false)
    expect(isFineDrag(-0.1, 0)).toBe(true)
  })

  it('press-holding before moving is fine regardless of velocity', () => {
    expect(isFineDrag(2, FINE_HOLD_MS)).toBe(true)
    expect(isFineDrag(2, FINE_HOLD_MS - 1)).toBe(false)
  })
})

describe('slowStreak', () => {
  it('accumulates dt while movement stays slow', () => {
    let s = 0
    s = slowStreak(s, 60, 0.1)
    s = slowStreak(s, 60, 0.1)
    expect(s).toBe(120)
    expect(s).toBeGreaterThanOrEqual(FINE_SLOW_SUSTAIN_MS - 60)
  })

  it('resets to 0 on any fast sample (no fine mode from a lone decel sample)', () => {
    let s = slowStreak(140, 60, 0.1) // 200, would arm
    expect(s).toBeGreaterThanOrEqual(FINE_SLOW_SUSTAIN_MS)
    s = slowStreak(200, 16, 0.9) // fast flick mid-sweep
    expect(s).toBe(0)
  })
})

describe('REST_TICKS', () => {
  it('covers every coarse detent from 30 to 180', () => {
    expect(REST_TICKS).toEqual([30, 60, 90, 120, 150, 180])
  })
})

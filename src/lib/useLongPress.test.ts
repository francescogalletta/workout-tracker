import { describe, expect, it } from 'vitest'
import { exceedsSlop } from './useLongPress'

describe('exceedsSlop', () => {
  it('stays within slop for small drifts in any direction', () => {
    expect(exceedsSlop(0, 0, 8)).toBe(false)
    expect(exceedsSlop(5, 5, 8)).toBe(false)
    expect(exceedsSlop(-8, 0, 8)).toBe(false)
    expect(exceedsSlop(0, 8, 8)).toBe(false)
  })

  it('exceeds once the radial distance passes the slop', () => {
    expect(exceedsSlop(9, 0, 8)).toBe(true)
    expect(exceedsSlop(0, -9, 8)).toBe(true)
    expect(exceedsSlop(6, 6, 8)).toBe(true) // ~8.49px
  })
})

import { describe, expect, it } from 'vitest'
import { dragTargetIndex } from './useDragReorder'

describe('dragTargetIndex', () => {
  it('stays on the start index for small drags', () => {
    expect(dragTargetIndex(1, 0, 74, 4)).toBe(1)
    expect(dragTargetIndex(1, 30, 74, 4)).toBe(1)
    expect(dragTargetIndex(1, -30, 74, 4)).toBe(1)
  })

  it('shifts one slot per row height, either direction', () => {
    expect(dragTargetIndex(1, 74, 74, 4)).toBe(2)
    expect(dragTargetIndex(1, 160, 74, 4)).toBe(3)
    expect(dragTargetIndex(2, -74, 74, 4)).toBe(1)
  })

  it('clamps to the list bounds', () => {
    expect(dragTargetIndex(0, -500, 74, 4)).toBe(0)
    expect(dragTargetIndex(3, 500, 74, 4)).toBe(3)
  })

  it('degenerate inputs return the start index', () => {
    expect(dragTargetIndex(2, 100, 0, 4)).toBe(2)
    expect(dragTargetIndex(2, 100, 74, 0)).toBe(2)
  })
})

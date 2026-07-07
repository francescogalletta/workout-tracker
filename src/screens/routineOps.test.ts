import { describe, expect, it } from 'vitest'
import type { Routine, Session } from '../data/types'
import {
  addToRotation,
  exerciseCountLabel,
  lastSessionLine,
  previewLines,
  removeFromRotation,
  reorderRotation,
  rotationList,
} from './routineOps'

function rt(id: string, cycleOrder: number | null, archived = false): Routine {
  return { id, name: id.toUpperCase(), defaultRestSec: 90, cycleOrder, warmup: true, archived }
}

/** Ordered rotation ids for readable assertions. */
const orderIds = (rs: Routine[]): string[] => rotationList(rs).map((r) => r.id)
/** cycleOrder by id, for checking normalization. */
const orders = (rs: Routine[]): Record<string, number | null> =>
  Object.fromEntries(rs.map((r) => [r.id, r.cycleOrder]))

describe('rotationList', () => {
  it('orders by cycleOrder and excludes null + archived', () => {
    const rs = [rt('a', 2), rt('b', 0), rt('c', null), rt('d', 1), rt('e', 3, true)]
    expect(orderIds(rs)).toEqual(['b', 'd', 'a'])
  })
})

describe('reorderRotation', () => {
  const rs = [rt('a', 0), rt('b', 1), rt('c', 2), rt('d', 3)]

  it('swaps a routine up and re-numbers 0..n-1', () => {
    const next = reorderRotation(rs, 'c', -1)
    expect(orderIds(next)).toEqual(['a', 'c', 'b', 'd'])
    expect(orders(next)).toEqual({ a: 0, c: 1, b: 2, d: 3 })
  })

  it('swaps a routine down', () => {
    expect(orderIds(reorderRotation(rs, 'b', 1))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('is a no-op at the top edge (returns same reference)', () => {
    expect(reorderRotation(rs, 'a', -1)).toBe(rs)
  })

  it('is a no-op at the bottom edge', () => {
    expect(reorderRotation(rs, 'd', 1)).toBe(rs)
  })

  it('normalizes gappy input while reordering', () => {
    const gappy = [rt('a', 0), rt('b', 5), rt('c', 9)]
    const next = reorderRotation(gappy, 'c', -1)
    expect(orders(next)).toEqual({ a: 0, c: 1, b: 2 })
  })
})

describe('addToRotation / removeFromRotation', () => {
  it('appends to the end of the rotation', () => {
    const rs = [rt('a', 0), rt('b', 1), rt('c', null)]
    const next = addToRotation(rs, 'c')
    expect(orders(next)).toEqual({ a: 0, b: 1, c: 2 })
  })

  it('adding an already-rotation routine is a no-op', () => {
    const rs = [rt('a', 0), rt('b', 1)]
    expect(addToRotation(rs, 'a')).toBe(rs)
  })

  it('removes from the middle and closes the gap', () => {
    const rs = [rt('a', 0), rt('b', 1), rt('c', 2)]
    const next = removeFromRotation(rs, 'b')
    expect(orders(next)).toEqual({ a: 0, b: null, c: 1 })
    expect(orderIds(next)).toEqual(['a', 'c'])
  })

  it('round-trips remove then add to the tail', () => {
    const rs = [rt('a', 0), rt('b', 1), rt('c', 2)]
    const after = addToRotation(removeFromRotation(rs, 'a'), 'a')
    expect(orders(after)).toEqual({ b: 0, c: 1, a: 2 })
  })
})

describe('previewLines', () => {
  it('splits first two onto line 1, third + count onto line 2', () => {
    expect(previewLines(['Bench Press', 'Incline DB Press', 'Cable Fly', 'X', 'Y', 'Z'])).toEqual([
      'Bench Press · Incline DB Press',
      'Cable Fly · 3 more',
    ])
  })

  it('drops the "more" suffix when exactly three', () => {
    expect(previewLines(['A', 'B', 'C'])).toEqual(['A · B', 'C'])
  })

  it('leaves line 2 empty with two or fewer', () => {
    expect(previewLines(['A', 'B'])).toEqual(['A · B', ''])
    expect(previewLines(['A'])).toEqual(['A', ''])
    expect(previewLines([])).toEqual(['', ''])
  })

  it('shows a single count for four exercises', () => {
    expect(previewLines(['A', 'B', 'C', 'D'])).toEqual(['A · B', 'C · 1 more'])
  })
})

describe('lastSessionLine', () => {
  it('is null with no completed session', () => {
    expect(lastSessionLine(null)).toBeNull()
  })

  it('formats weekday short name + duration minutes', () => {
    // 2021-01-07 is a Thursday (UTC); +62 min duration.
    const started = Date.UTC(2021, 0, 7, 12, 0, 0)
    const session: Session = {
      id: 's1',
      routineId: 'r-pull-a',
      routineName: 'Pull A',
      status: 'completed',
      startedAt: started,
      finishedAt: started + 62 * 60000,
    }
    expect(lastSessionLine(session)).toBe('Last · Pull A · Thu, 62 min')
  })
})

describe('exerciseCountLabel', () => {
  it('pluralizes', () => {
    expect(exerciseCountLabel(1)).toBe('1 exercise')
    expect(exerciseCountLabel(6)).toBe('6 exercises')
    expect(exerciseCountLabel(0)).toBe('0 exercises')
  })
})

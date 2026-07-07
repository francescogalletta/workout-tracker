import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { itemsForRoutine, rotationRoutines, routineById } from '../data/queries'
import { ensureCatalog, seedDemoData } from '../data/seed'
import { getDb, resetDb, update } from '../data/store'
import type { Db } from '../data/types'
import {
  addItem,
  deleteRoutine,
  itemSummary,
  moveItem,
  normalizeRotation,
  removeItem,
  RoutineEditor,
  setDefaultRest,
  setItemRest,
  setItemRir,
  setRotation,
  stepReps,
  stepSets,
} from './RoutineEditor'

const T0 = 1_750_000_000_000

beforeEach(() => resetDb())

function db(): Db {
  return getDb()
}

describe('item reorder', () => {
  it('swaps adjacent items and persists dense 0..n-1 order', () => {
    seedDemoData(T0)
    const before = itemsForRoutine(db(), 'r-push-a')
    const first = before[0].id
    const second = before[1].id

    update((d) => moveItem(d, 'r-push-a', first, 1))
    const after = itemsForRoutine(db(), 'r-push-a')

    expect(after[0].id).toBe(second)
    expect(after[1].id).toBe(first)
    expect(after.map((it) => it.order)).toEqual(after.map((_, i) => i))
  })

  it('is a no-op past the edges', () => {
    seedDemoData(T0)
    const items = itemsForRoutine(db(), 'r-push-a')
    const firstBefore = items.map((it) => it.id)
    update((d) => moveItem(d, 'r-push-a', items[0].id, -1))
    expect(itemsForRoutine(db(), 'r-push-a').map((it) => it.id)).toEqual(firstBefore)
    update((d) => moveItem(d, 'r-push-a', items[items.length - 1].id, 1))
    expect(itemsForRoutine(db(), 'r-push-a').map((it) => it.id)).toEqual(firstBefore)
  })
})

describe('remove item', () => {
  it('deletes the item and re-densifies remaining order', () => {
    seedDemoData(T0)
    const items = itemsForRoutine(db(), 'r-push-a')
    const removed = items[1].id
    update((d) => removeItem(d, 'r-push-a', removed))
    const after = itemsForRoutine(db(), 'r-push-a')
    expect(after.find((it) => it.id === removed)).toBeUndefined()
    expect(after.length).toBe(items.length - 1)
    expect(after.map((it) => it.order)).toEqual(after.map((_, i) => i))
  })
})

describe('add item', () => {
  it('appends 3×10 @ RIR 2 with rest null at the end', () => {
    seedDemoData(T0)
    const n = itemsForRoutine(db(), 'r-push-a').length
    update((d) => addItem(d, 'r-push-a', 'pec-deck', 'ri-new'))
    const after = itemsForRoutine(db(), 'r-push-a')
    expect(after.length).toBe(n + 1)
    const added = after[after.length - 1]
    expect(added).toMatchObject({
      id: 'ri-new',
      exerciseId: 'pec-deck',
      order: n,
      sets: 3,
      repsPerSet: 10,
      targetRIR: 2,
      restSec: null,
    })
  })
})

describe('sets/reps clamps', () => {
  it('clamps sets to 1..10', () => {
    seedDemoData(T0)
    const item = itemsForRoutine(db(), 'r-push-a')[0].id
    for (let i = 0; i < 20; i++) update((d) => stepSets(d, item, 1))
    expect(db().routineItems.find((it) => it.id === item)!.sets).toBe(10)
    for (let i = 0; i < 20; i++) update((d) => stepSets(d, item, -1))
    expect(db().routineItems.find((it) => it.id === item)!.sets).toBe(1)
  })

  it('clamps reps to 1..30', () => {
    seedDemoData(T0)
    const item = itemsForRoutine(db(), 'r-push-a')[0].id
    for (let i = 0; i < 40; i++) update((d) => stepReps(d, item, 1))
    expect(db().routineItems.find((it) => it.id === item)!.repsPerSet).toBe(30)
    for (let i = 0; i < 40; i++) update((d) => stepReps(d, item, -1))
    expect(db().routineItems.find((it) => it.id === item)!.repsPerSet).toBe(1)
  })
})

describe('rest override null vs value', () => {
  it('stores an explicit override and reverts to null (default)', () => {
    seedDemoData(T0)
    const item = itemsForRoutine(db(), 'r-push-a')[0].id
    update((d) => setItemRest(d, item, 120))
    expect(db().routineItems.find((it) => it.id === item)!.restSec).toBe(120)
    update((d) => setItemRest(d, item, null))
    expect(db().routineItems.find((it) => it.id === item)!.restSec).toBeNull()
  })

  it('summary uses the routine default only when restSec is null', () => {
    const base = { id: 'x', routineId: 'r', exerciseId: 'e', order: 0, sets: 4, repsPerSet: 8, targetRIR: 2 }
    expect(itemSummary({ ...base, restSec: null }, 90)).toBe('4×8 @ RIR 2 · rest 90s')
    expect(itemSummary({ ...base, restSec: 60 }, 90)).toBe('4×8 @ RIR 2 · rest 60s')
  })
})

describe('RIR + default rest writes', () => {
  it('writes targetRIR and routine defaultRestSec', () => {
    seedDemoData(T0)
    const item = itemsForRoutine(db(), 'r-push-a')[0].id
    update((d) => setItemRir(d, item, 4))
    expect(db().routineItems.find((it) => it.id === item)!.targetRIR).toBe(4)
    update((d) => setDefaultRest(d, 'r-push-a', 120))
    expect(routineById(db(), 'r-push-a')!.defaultRestSec).toBe(120)
  })
})

describe('rotation toggle normalization', () => {
  it('normalizeRotation densifies gappy orders, leaving nulls untouched', () => {
    const out = normalizeRotation([
      { id: 'a', cycleOrder: 5 },
      { id: 'b', cycleOrder: null },
      { id: 'c', cycleOrder: 2 },
      { id: 'd', cycleOrder: 9 },
    ])
    const byId = new Map(out.map((r) => [r.id, r.cycleOrder]))
    expect(byId.get('c')).toBe(0)
    expect(byId.get('a')).toBe(1)
    expect(byId.get('d')).toBe(2)
    expect(byId.get('b')).toBeNull()
  })

  it('disabling a middle routine renormalizes the rest to 0..n-1', () => {
    seedDemoData(T0)
    // Seed rotation: push-a(0) pull-a(1) legs(2) push-b(3)
    update((d) => setRotation(d, 'r-pull-a', false))
    expect(routineById(db(), 'r-pull-a')!.cycleOrder).toBeNull()
    const cycle = rotationRoutines(db())
    expect(cycle.map((r) => r.id)).toEqual(['r-push-a', 'r-legs', 'r-push-b'])
    expect(cycle.map((r) => r.cycleOrder)).toEqual([0, 1, 2])
  })

  it('enabling assigns the end-of-rotation position', () => {
    seedDemoData(T0)
    expect(routineById(db(), 'r-arms')!.cycleOrder).toBeNull()
    update((d) => setRotation(d, 'r-arms', true))
    const cycle = rotationRoutines(db())
    expect(cycle[cycle.length - 1].id).toBe('r-arms')
    expect(cycle.map((r) => r.cycleOrder)).toEqual(cycle.map((_, i) => i))
  })
})

describe('render smoke', () => {
  it('renders a seeded routine with items, summaries and rotation preview', () => {
    seedDemoData(T0)
    const html = renderToString(<RoutineEditor id="r-push-a" />)
    expect(html).toContain('Push A')
    expect(html).toContain('Bench Press')
    expect(html).toContain('‹ Routines')
    expect(html).toContain('Done')
    expect(html).toContain('Warm-up section')
    expect(html).toContain('+ Add exercise')
    expect(html).toContain('In rotation')
    expect(html).toContain('4 exercises · in rotation')
    // rotation preview chips include the other routines
    expect(html).toContain('Legs')
  })

  it('renders a brand-new empty routine (create-first-routine landing)', () => {
    ensureCatalog()
    update((d) => ({
      ...d,
      routines: [
        {
          id: 'r-fresh',
          name: 'New Routine',
          defaultRestSec: 90,
          cycleOrder: null,
          warmup: false,
          archived: false,
        },
      ],
    }))
    const html = renderToString(<RoutineEditor id="r-fresh" />)
    expect(html).toContain('New Routine')
    expect(html).toContain('0 exercises · not in rotation')
    expect(html).toContain('+ Add exercise')
  })

  it('renders nothing for an unknown routine id', () => {
    ensureCatalog()
    const html = renderToString(<RoutineEditor id="nope" />)
    expect(html).toBe('')
  })
})

describe('deleteRoutine', () => {
  it('removes the routine and its items, keeping sessions and setLogs', () => {
    seedDemoData(T0)
    const before = db()
    const sessions = before.sessions.length
    const logs = before.setLogs.length
    expect(routineById(before, 'r-push-a')).not.toBeNull()
    expect(before.routineItems.some((it) => it.routineId === 'r-push-a')).toBe(true)

    update((d) => deleteRoutine(d, 'r-push-a'))

    const after = db()
    expect(routineById(after, 'r-push-a')).toBeNull()
    expect(after.routineItems.some((it) => it.routineId === 'r-push-a')).toBe(false)
    expect(after.sessions.length).toBe(sessions) // history untouched
    expect(after.setLogs.length).toBe(logs)
  })

  it('renumbers the remaining rotation densely', () => {
    seedDemoData(T0)
    const rotBefore = rotationRoutines(db()).map((r) => r.id)
    const victim = rotBefore[1]
    update((d) => deleteRoutine(d, victim))
    const rot = rotationRoutines(db())
    expect(rot.map((r) => r.id)).toEqual(rotBefore.filter((r) => r !== victim))
    expect(rot.map((r) => r.cycleOrder)).toEqual(rot.map((_, i) => i))
  })

  it('leaves other routines and their items untouched', () => {
    seedDemoData(T0)
    const othersItems = db().routineItems.filter((it) => it.routineId !== 'r-push-a')
    update((d) => deleteRoutine(d, 'r-push-a'))
    expect(db().routineItems).toEqual(othersItems)
  })

  it('deleting a non-rotation routine leaves the rotation unchanged', () => {
    seedDemoData(T0)
    const nonRot = db().routines.find((r) => r.cycleOrder === null)!
    const rotBefore = rotationRoutines(db()).map((r) => r.id)
    update((d) => deleteRoutine(d, nonRot.id))
    expect(rotationRoutines(db()).map((r) => r.id)).toEqual(rotBefore)
  })
})

import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { exerciseById, itemsForRoutine, rotationRoutines, routineById } from '../data/queries'
import { ensureCatalog, seedDemoData } from '../data/seed'
import { getDb, resetDb, update } from '../data/store'
import type { Db } from '../data/types'
import { effectiveRIR, exerciseType, MAX_ROUTINE_NAME_LEN, routineDefaultRIR } from '../data/types'
import {
  addItem,
  deleteRoutine,
  itemSummary,
  moveItem,
  removeItem,
  reorderItem,
  RoutineEditor,
  setDefaultRest,
  setDefaultTargetRIR,
  setItemRest,
  setItemRir,
  setRotation,
  setRoutineName,
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
  it('reorderItem drops an item at an arbitrary index and re-densifies', () => {
    seedDemoData(T0)
    const before = itemsForRoutine(db(), 'r-push-a')
    const first = before[0].id
    update((d) => reorderItem(d, 'r-push-a', first, before.length - 1))
    const after = itemsForRoutine(db(), 'r-push-a')
    expect(after[after.length - 1].id).toBe(first)
    expect(after.map((it) => it.order)).toEqual(after.map((_, i) => i))
    // clamped + same-index drops are no-ops
    const snapshot = db()
    update((d) => reorderItem(d, 'r-push-a', first, 99))
    expect(itemsForRoutine(db(), 'r-push-a')[after.length - 1].id).toBe(first)
    update((d) => reorderItem(d, 'r-push-a', 'missing', 0))
    expect(db().routineItems).toEqual(snapshot.routineItems)
  })

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
  it('appends 3×10 with rest + RIR on the routine defaults (weight exercise)', () => {
    seedDemoData(T0)
    const n = itemsForRoutine(db(), 'r-push-a').length
    update((d) => addItem(d, 'r-push-a', 'pec-deck', 'ri-new'))
    const after = itemsForRoutine(db(), 'r-push-a')
    expect(after.length).toBe(n + 1)
    const added = after[after.length - 1]
    expect(exerciseType(exerciseById(db(), 'pec-deck')!)).toBe('weight')
    expect(added).toMatchObject({
      id: 'ri-new',
      exerciseId: 'pec-deck',
      order: n,
      sets: 3,
      repsPerSet: 10,
      targetRIR: null,
      restSec: null,
    })
  })

  it('defaults a `time` exercise (Plank) to 3 sets, 30s hold, no meaningful RIR', () => {
    seedDemoData(T0)
    expect(exerciseType(exerciseById(db(), 'plank')!)).toBe('time')
    update((d) => addItem(d, 'r-push-a', 'plank', 'ri-time'))
    const added = itemsForRoutine(db(), 'r-push-a').find((it) => it.id === 'ri-time')!
    expect(added.sets).toBe(3)
    expect(added.durSec).toBe(30)
    expect(added.restSec).toBeNull()
  })

  it('defaults a `reps` (bodyweight) exercise (Pull-Up) to 3×12 on routine RIR', () => {
    seedDemoData(T0)
    expect(exerciseType(exerciseById(db(), 'pull-up')!)).toBe('reps')
    update((d) => addItem(d, 'r-push-a', 'pull-up', 'ri-reps'))
    const added = itemsForRoutine(db(), 'r-push-a').find((it) => it.id === 'ri-reps')!
    expect(added).toMatchObject({ sets: 3, repsPerSet: 12, targetRIR: null, restSec: null })
  })
})

describe('routine name', () => {
  it('truncates to MAX_ROUTINE_NAME_LEN', () => {
    seedDemoData(T0)
    const long = 'x'.repeat(MAX_ROUTINE_NAME_LEN + 20)
    update((d) => setRoutineName(d, 'r-push-a', long))
    expect(routineById(db(), 'r-push-a')!.name).toBe('x'.repeat(MAX_ROUTINE_NAME_LEN))
    expect(routineById(db(), 'r-push-a')!.name.length).toBe(MAX_ROUTINE_NAME_LEN)
  })

  it('leaves short names untouched', () => {
    seedDemoData(T0)
    update((d) => setRoutineName(d, 'r-push-a', 'Push Day'))
    expect(routineById(db(), 'r-push-a')!.name).toBe('Push Day')
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
    const routine = { defaultRestSec: 90 }
    expect(itemSummary({ ...base, restSec: null }, routine, 'weight')).toBe('4×8 @ RIR 2 · rest 90s')
    expect(itemSummary({ ...base, restSec: 60 }, routine, 'weight')).toBe('4×8 @ RIR 2 · rest 60s')
  })

  it('summary shows the routine default RIR when the item has no override', () => {
    const base = { id: 'x', routineId: 'r', exerciseId: 'e', order: 0, sets: 4, repsPerSet: 8, targetRIR: null, restSec: null }
    expect(itemSummary(base, { defaultRestSec: 90 }, 'weight')).toBe('4×8 @ RIR 2 · rest 90s')
    expect(itemSummary(base, { defaultRestSec: 90, defaultTargetRIR: 3 }, 'weight')).toBe('4×8 @ RIR 3 · rest 90s')
  })

  it('summary for `reps` type reads the same as weight (bodyweight, no kg shown)', () => {
    const base = { id: 'x', routineId: 'r', exerciseId: 'e', order: 0, sets: 3, repsPerSet: 12, targetRIR: 1 }
    expect(itemSummary({ ...base, restSec: null }, { defaultRestSec: 90 }, 'reps')).toBe('3×12 @ RIR 1 · rest 90s')
  })

  it('summary for `time` type shows sets × duration instead of reps/RIR', () => {
    const base = { id: 'x', routineId: 'r', exerciseId: 'e', order: 0, sets: 3, repsPerSet: 0, targetRIR: 0 }
    expect(itemSummary({ ...base, durSec: 45, restSec: 60 }, { defaultRestSec: 90 }, 'time')).toBe('3 × 0:45 · rest 60s')
    // falls back to the type default (30s) when durSec is unset
    expect(itemSummary({ ...base, restSec: null }, { defaultRestSec: 90 }, 'time')).toBe('3 × 0:30 · rest 90s')
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

  it('setDefaultRest resets every item override in that routine only', () => {
    seedDemoData(T0)
    const mine = itemsForRoutine(db(), 'r-push-a')[0].id
    const other = itemsForRoutine(db(), 'r-pull-a')[0].id
    update((d) => setItemRest(d, mine, 120))
    update((d) => setItemRest(d, other, 150))
    // 90 → 100 is a real change, so overrides in this routine wipe.
    update((d) => setDefaultRest(d, 'r-push-a', 100))
    expect(db().routineItems.find((it) => it.id === mine)!.restSec).toBeNull()
    expect(db().routineItems.find((it) => it.id === other)!.restSec).toBe(150)
  })

  it('setDefaultRest is a no-op (keeps overrides) when the value is unchanged', () => {
    seedDemoData(T0)
    const mine = itemsForRoutine(db(), 'r-push-a')[0].id
    update((d) => setItemRest(d, mine, 120))
    // r-push-a already defaults to 90s; re-committing 90 must not wipe.
    update((d) => setDefaultRest(d, 'r-push-a', 90))
    expect(db().routineItems.find((it) => it.id === mine)!.restSec).toBe(120)
  })

  it('setDefaultTargetRIR writes the routine field and resets item overrides', () => {
    seedDemoData(T0)
    const mine = itemsForRoutine(db(), 'r-push-a')[0].id
    const other = itemsForRoutine(db(), 'r-pull-a')[0].id
    update((d) => setItemRir(d, mine, 4))
    update((d) => setItemRir(d, other, 4))
    update((d) => setDefaultTargetRIR(d, 'r-push-a', 1))
    expect(routineById(db(), 'r-push-a')!.defaultTargetRIR).toBe(1)
    expect(db().routineItems.find((it) => it.id === mine)!.targetRIR).toBeNull()
    expect(db().routineItems.find((it) => it.id === other)!.targetRIR).toBe(4)
  })

  it('setDefaultTargetRIR is a no-op (keeps overrides) when the value is unchanged', () => {
    seedDemoData(T0)
    const mine = itemsForRoutine(db(), 'r-push-a')[0].id
    update((d) => setItemRir(d, mine, 4))
    // Legacy routines resolve to RIR 2; re-committing 2 must not wipe.
    update((d) => setDefaultTargetRIR(d, 'r-push-a', 2))
    expect(db().routineItems.find((it) => it.id === mine)!.targetRIR).toBe(4)
  })

  it('setItemRir(null) reverts to the routine default', () => {
    seedDemoData(T0)
    const item = itemsForRoutine(db(), 'r-push-a')[0].id
    update((d) => setItemRir(d, item, 4))
    update((d) => setItemRir(d, item, null))
    expect(db().routineItems.find((it) => it.id === item)!.targetRIR).toBeNull()
  })
})

describe('effectiveRIR / routineDefaultRIR migration accessors', () => {
  it('defaults legacy routines (no field) to 2 and honors overrides', () => {
    expect(routineDefaultRIR({})).toBe(2)
    expect(routineDefaultRIR({ defaultTargetRIR: 3 })).toBe(3)
    expect(effectiveRIR({ targetRIR: null }, {})).toBe(2)
    expect(effectiveRIR({ targetRIR: null }, { defaultTargetRIR: 3 })).toBe(3)
    expect(effectiveRIR({ targetRIR: 0 }, { defaultTargetRIR: 3 })).toBe(0)
  })
})

describe('rotation toggle normalization', () => {
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
    expect(html).toContain('Warm-up')
    expect(html).not.toContain('Warm-up section')
    expect(html).toContain('Default RIR target')
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

  it('shows a Time badge and duration summary for a `time`-type item', () => {
    seedDemoData(T0)
    update((d) => addItem(d, 'r-push-a', 'plank', 'ri-plank'))
    const html = renderToString(<RoutineEditor id="r-push-a" />)
    expect(html).toContain('Plank')
    expect(html).toContain('>Time<')
    expect(html).toContain('3 × 0:30')
  })

  it('shows a Bodyweight badge for a `reps`-type item', () => {
    seedDemoData(T0)
    update((d) => addItem(d, 'r-push-a', 'pull-up', 'ri-pullup'))
    const html = renderToString(<RoutineEditor id="r-push-a" />)
    expect(html).toContain('Pull-Up')
    expect(html).toContain('>Bodyweight<')
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

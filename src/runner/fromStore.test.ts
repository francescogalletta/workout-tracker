import { beforeEach, describe, expect, it } from 'vitest'
import { addSetLog, startSession } from '../data/mutations'
import { routineById } from '../data/queries'
import { seedDemoData } from '../data/seed'
import { getDb, resetDb } from '../data/store'
import type { SetLog } from '../data/types'
import { restoreState, seedsForRoutine, syncLoggedEdits, toPickerItem } from './fromStore'

const T0 = 1_750_000_000_000

beforeEach(() => {
  resetDb()
  seedDemoData(T0)
})

describe('seedsForRoutine', () => {
  it('builds Push A from items + engine: prescriptions, warm-ups, reco, target, plateau', () => {
    const seeds = seedsForRoutine(getDb(), 'r-push-a', T0)
    expect(seeds).toHaveLength(4)

    const bench = seeds[0]
    expect(bench.exercise).toMatchObject({
      exerciseId: 'bench-press',
      routineItemId: 'r-push-a-i1',
      name: 'Bench Press',
      kind: 'strength',
      scheme: '4×8 @ RIR 2',
      targetReps: 8,
      targetRir: 2,
      restSec: 90, // routine default (item has no override)
    })
    // last session: 62.5 kg, reps 9/8/8/8, RIR 2/2/2/3 → surplus 0.5 → repeat
    expect(bench.exercise.reco).toMatchObject({ lastW: 62.5, lastMain: '62.5 kg' })
    expect(bench.exercise.reco!.reason).toContain('Repeat 62.5 kg')
    // active Insights target from the store
    expect(bench.exercise.target).toEqual({ w: 65, sub: '8 reps @ RIR 2', weeksLeft: 3 })
    expect(bench.exercise.plateauText).toBeNull()
    // warm-ups prepended for the routine's first exercise only (warmup flag)
    expect(bench.sets.slice(0, 2)).toEqual([
      { isWarmup: true, weight: 30, reps: 8, rir: null },
      { isWarmup: true, weight: 42.5, reps: 5, rir: null },
    ])
    expect(bench.sets.slice(2)).toHaveLength(4)
    expect(bench.sets[2]).toMatchObject({ weight: 62.5, reps: 8, rir: 2 })

    // cable fly is stuck at 25 kg for 3 sessions → plateau banner with deload
    const fly = seeds[2]
    expect(fly.exercise.plateauText).toContain('25 kg')
    expect(fly.exercise.plateauText).toContain('22.5 kg')
    expect(fly.sets.every((s) => !s.isWarmup)).toBe(true)

    // item-level rest override wins
    expect(fly.exercise.restSec).toBe(60)
  })

  it('generates no warm-ups when the routine flag is off', () => {
    const seeds = seedsForRoutine(getDb(), 'r-pull-a', T0)
    expect(seeds[0].sets.every((s) => !s.isWarmup)).toBe(true)
  })

  it('first-time exercises get a null weight and no warm-ups', () => {
    const db = getDb()
    const custom = {
      ...db,
      routines: [
        ...db.routines,
        { id: 'r-new', name: 'New', defaultRestSec: 90, cycleOrder: null, warmup: true, archived: false },
      ],
      routineItems: [
        ...db.routineItems,
        { id: 'r-new-i1', routineId: 'r-new', exerciseId: 'front-squat', order: 0, sets: 3, repsPerSet: 8, targetRIR: 2, restSec: null },
      ],
    }
    const seeds = seedsForRoutine(custom, 'r-new', T0)
    expect(seeds[0].exercise.reco).toBeNull()
    expect(seeds[0].sets).toHaveLength(3) // no warm-ups without a working weight
    expect(seeds[0].sets[0].weight).toBeNull()
  })

  it('builds cardio items with metric defaults and no reco', () => {
    const seeds = seedsForRoutine(getDb(), 'r-cardio-core', T0)
    const erg = seeds[0]
    expect(erg.exercise.kind).toBe('cardio')
    expect(erg.sets).toHaveLength(1)
    expect(erg.sets[0].values).toEqual({ time: 600, res: 5, pace: 125 })
  })

  it('returns [] for an unknown routine', () => {
    expect(seedsForRoutine(getDb(), 'nope', T0)).toEqual([])
  })
})

describe('restoreState', () => {
  function logRow(patch: Partial<SetLog> & Pick<SetLog, 'id' | 'sessionId'>): SetLog {
    return {
      exerciseId: 'bench-press',
      exerciseName: 'Bench Press',
      setNumber: 1,
      isWarmup: false,
      weightKg: 62.5,
      reps: 8,
      rir: 2,
      values: null,
      completedAt: T0,
      ...patch,
    }
  }

  it('replays the session logs onto the rebuilt state and repoints the cursor', () => {
    const session = startSession(routineById(getDb(), 'r-push-a')!, T0)
    addSetLog(logRow({ id: 'wu1', sessionId: session.id, isWarmup: true, weightKg: 30, reps: 8, rir: null, completedAt: T0 + 1 }))
    addSetLog(logRow({ id: 'wu2', sessionId: session.id, isWarmup: true, setNumber: 2, weightKg: 42.5, reps: 5, rir: null, completedAt: T0 + 2 }))
    addSetLog(logRow({ id: 'w1', sessionId: session.id, weightKg: 100, completedAt: T0 + 3 }))

    const state = restoreState(getDb(), session, T0 + 5)
    expect(state.startedAt).toBe(T0)
    expect(state.sets[0][0]).toMatchObject({ logged: true, isWarmup: true, weight: 30, logId: 'wu1' })
    expect(state.sets[0][1]).toMatchObject({ logged: true, weight: 42.5, logId: 'wu2' })
    expect(state.sets[0][2]).toMatchObject({ logged: true, weight: 100, logId: 'w1' })
    expect(state.sets[0][3]).toMatchObject({ logged: false, weight: 62.5 }) // prescription intact
    expect(state.ptr).toEqual({ e: 0, s: 3 })
    // the active session's own logs never feed the recommendation
    expect(state.exercises[0].reco!.lastW).toBe(62.5)
  })

  it('appends exercises that were added mid-session (logs without a routine item)', () => {
    const session = startSession(routineById(getDb(), 'r-push-a')!, T0)
    addSetLog(
      logRow({
        id: 'x1',
        sessionId: session.id,
        exerciseId: 'triceps-pushdown',
        exerciseName: 'Triceps Pushdown',
        weightKg: 25,
        reps: 12,
        rir: 1,
      }),
    )
    const state = restoreState(getDb(), session, T0 + 5)
    expect(state.exercises).toHaveLength(5)
    const added = state.exercises[4]
    expect(added).toMatchObject({ exerciseId: 'triceps-pushdown', kind: 'strength' })
    expect(state.sets[4][0]).toMatchObject({ logged: true, weight: 25, reps: 12, logId: 'x1' })
  })
})

describe('syncLoggedEdits', () => {
  it('writes edited logged sets back to their SetLog rows', () => {
    const session = startSession(routineById(getDb(), 'r-push-a')!, T0)
    addSetLog({
      id: 'w1',
      sessionId: session.id,
      exerciseId: 'bench-press',
      exerciseName: 'Bench Press',
      setNumber: 1,
      isWarmup: false,
      weightKg: 62.5,
      reps: 8,
      rir: 2,
      values: null,
      completedAt: T0 + 1,
    })
    const state = restoreState(getDb(), session, T0 + 2)
    const edited = {
      ...state,
      sets: state.sets.map((arr, e) =>
        arr.map((x, s) => (e === 0 && s === 2 ? { ...x, weight: 65, rir: 1 } : x)),
      ),
    }
    syncLoggedEdits(getDb(), edited)
    const row = getDb().setLogs.find((l) => l.id === 'w1')!
    expect(row.weightKg).toBe(65)
    expect(row.rir).toBe(1)
    expect(row.reps).toBe(8) // untouched fields stay

    // no-op when nothing differs
    const before = getDb()
    syncLoggedEdits(before, edited)
    expect(getDb()).toBe(before)
  })
})

describe('toPickerItem', () => {
  it('maps store exercises to picker items, carrying cardio metrics', () => {
    const db = getDb()
    const bench = toPickerItem(db.exercises.find((e) => e.id === 'bench-press')!)
    expect(bench).toEqual({
      id: 'bench-press',
      name: 'Bench Press',
      muscle: 'chest',
      group: 'chest',
      equipment: 'barbell',
    })
    const erg = toPickerItem(db.exercises.find((e) => e.id === 'row-erg')!)
    expect(erg.kind).toBe('cardio')
    expect(erg.metrics!.length).toBe(3)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { startSession } from './mutations'
import {
  activeSession,
  activeTargetFor,
  historyFor,
  itemsForRoutine,
  lastCompletedSession,
  nextInRotation,
  rotationRoutines,
  routineById,
  sessionsForLog,
  weeklySetsPerMuscleGroup,
} from './queries'
import { seedDemoData } from './seed'
import { getDb, resetDb } from './store'
import { emptyDb, type Db, type Routine, type Session } from './types'

const T0 = 1_750_000_000_000
const DAY = 24 * 3600 * 1000

beforeEach(() => {
  resetDb()
  seedDemoData(T0)
})

describe('rotation', () => {
  it('orders rotation routines by cycleOrder and excludes non-rotation ones', () => {
    const cycle = rotationRoutines(getDb())
    expect(cycle.map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs', 'Push B'])
  })

  it('suggests the routine after the last completed rotation session', () => {
    // demo schedule ends: ... Push A (4d), Pull A (2d) → next is Legs
    expect(nextInRotation(getDb())!.name).toBe('Legs')
  })

  it('wraps around the cycle and skips non-rotation sessions', () => {
    const db = emptyDb()
    const r = (id: string, cycleOrder: number | null): Routine => ({
      id,
      name: id,
      defaultRestSec: 90,
      cycleOrder,
      warmup: false,
      archived: false,
    })
    const s = (id: string, routineId: string, daysAgo: number): Session => ({
      id,
      routineId,
      routineName: routineId,
      status: 'completed',
      startedAt: T0 - daysAgo * DAY,
      finishedAt: T0 - daysAgo * DAY + 1,
    })
    db.routines = [r('A', 0), r('B', 1), r('X', null)]
    db.sessions = [s('s1', 'B', 4), s('s2', 'X', 1)] // most recent is non-rotation
    const next = nextInRotation(db as Db)
    expect(next!.id).toBe('A') // after B, wrapping past the end
  })

  it('falls back to the first routine in the cycle with no completed sessions', () => {
    resetDb()
    seedDemoData(T0)
    const db = { ...getDb(), sessions: [] }
    expect(nextInRotation(db)!.name).toBe('Push A')
  })

  it('returns null with no rotation at all', () => {
    expect(nextInRotation(emptyDb())).toBeNull()
  })
})

describe('sessions', () => {
  it('activeSession is null until one starts', () => {
    expect(activeSession(getDb())).toBeNull()
    const routine = routineById(getDb(), 'r-push-a')!
    const s = startSession(routine, T0)
    expect(activeSession(getDb())!.id).toBe(s.id)
    // double-start returns the existing active session
    expect(startSession(routine, T0 + 1).id).toBe(s.id)
  })

  it('lastCompletedSession is the most recently finished one', () => {
    const last = lastCompletedSession(getDb())!
    expect(last.routineName).toBe('Pull A')
    expect(last.startedAt).toBe(T0 - 2 * DAY)
  })
})

describe('historyFor', () => {
  it('groups working sets by session, most recent first, warm-ups excluded', () => {
    const hist = historyFor(getDb(), 'bench-press')
    expect(hist).toHaveLength(3)
    expect(hist[0].session.startedAt).toBeGreaterThan(hist[1].session.startedAt)
    for (const h of hist) {
      expect(h.logs).toHaveLength(4) // 4 working sets; 2 warm-ups excluded
      expect(h.logs.every((l) => !l.isWarmup)).toBe(true)
    }
    expect(hist[0].logs[0].weightKg).toBe(62.5)
    expect(hist[2].logs[0].weightKg).toBe(60)
  })

  it('is empty for an exercise never performed', () => {
    expect(historyFor(getDb(), 'front-squat')).toEqual([])
  })
})

describe('sessionsForLog', () => {
  it('returns all sessions with working logs, most recent first', () => {
    const all = sessionsForLog(getDb(), null)
    expect(all).toHaveLength(12)
    expect(all[0].session.routineName).toBe('Pull A')
    const flat = all.flatMap((v) => v.exercises.flatMap((e) => e.logs))
    expect(flat.every((l) => !l.isWarmup)).toBe(true)
  })

  it('filters by a single exercise', () => {
    const bench = sessionsForLog(getDb(), { type: 'exercise', value: 'bench-press' })
    expect(bench).toHaveLength(3)
    for (const v of bench) {
      expect(v.exercises).toHaveLength(1)
      expect(v.exercises[0].exerciseId).toBe('bench-press')
    }
  })

  it('filters by muscle group and drops sessions left empty', () => {
    const chest = sessionsForLog(getDb(), { type: 'group', value: 'chest' })
    // chest appears in Push A (×3) and Push B (×2) only
    expect(chest).toHaveLength(5)
    for (const v of chest) {
      expect(['Push A', 'Push B']).toContain(v.session.routineName)
    }
  })
})

describe('weeklySetsPerMuscleGroup', () => {
  it('averages working sets per week per group over the window', () => {
    const out = weeklySetsPerMuscleGroup(getDb(), 3, T0)
    // chest: bench 3×4 + incline 3×3 + fly 3×3 + machine press 2×3 = 36 → 12/wk
    expect(out.chest).toBe(12)
    expect(out.cardio).toBeUndefined() // strength groups only
    expect(out.core).toBe(2) // hanging leg raise 3 + cable crunch 3 over 3 wk
  })

  it('ignores logs outside the window', () => {
    const narrow = weeklySetsPerMuscleGroup(getDb(), 1, T0 - 100 * DAY)
    expect(Object.values(narrow).every((v) => v === 0)).toBe(true)
  })
})

describe('activeTargetFor', () => {
  it('returns the unexpired target and null after expiry', () => {
    const t = activeTargetFor(getDb(), 'bench-press', T0)
    expect(t).toMatchObject({ weightKg: 65, note: '8 reps @ RIR 2' })
    expect(activeTargetFor(getDb(), 'bench-press', T0 + 30 * DAY)).toBeNull()
    expect(activeTargetFor(getDb(), 'cable-fly', T0)).toBeNull()
  })
})

describe('itemsForRoutine', () => {
  it('returns items in order with resolved fields', () => {
    const items = itemsForRoutine(getDb(), 'r-push-a')
    expect(items.map((i) => i.exerciseId)).toEqual([
      'bench-press',
      'incline-db-press',
      'cable-fly',
      'lateral-raise',
    ])
    expect(items[0]).toMatchObject({ sets: 4, repsPerSet: 8, targetRIR: 2 })
  })
})

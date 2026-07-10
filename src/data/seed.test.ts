import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_ROUTINE, EXERCISE_DB } from '../runner/demo'
import { cleanupSeededCatalog, ensureCatalog, seedDemoData, STARTER_EXERCISES } from './seed'
import { getDb, resetDb, update } from './store'
import type { Exercise } from './types'

const T0 = 1_750_000_000_000

beforeEach(() => resetDb())

describe('starter catalog', () => {
  it('has ~40 strength + 4 cardio exercises with unique ids', () => {
    const strength = STARTER_EXERCISES.filter((e) => e.kind === 'strength')
    const cardio = STARTER_EXERCISES.filter((e) => e.kind === 'cardio')
    expect(strength.length).toBeGreaterThanOrEqual(40)
    expect(cardio.length).toBe(4)
    expect(new Set(STARTER_EXERCISES.map((e) => e.id)).size).toBe(STARTER_EXERCISES.length)
    for (const c of cardio) expect(c.metrics!.length).toBeGreaterThanOrEqual(2)
  })

  it('is a superset of the old runner demo DB', () => {
    const names = new Set(STARTER_EXERCISES.map((e) => e.name))
    for (const d of EXERCISE_DB) expect(names.has(d.name), d.name).toBe(true)
    for (const seed of DEMO_ROUTINE) expect(names.has(seed.exercise.name)).toBe(true)
  })

  it('covers every muscle group and equipment used by the picker chips', () => {
    const groups = new Set(STARTER_EXERCISES.map((e) => e.muscleGroup))
    for (const g of ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio']) {
      expect(groups.has(g), g).toBe(true)
    }
    const equipment = new Set(STARTER_EXERCISES.map((e) => e.equipment))
    for (const q of ['barbell', 'dumbbell', 'cable', 'machine', 'body']) {
      expect(equipment.has(q), q).toBe(true)
    }
  })

  it('includes assisted exercises for the negative-weight load type', () => {
    expect(STARTER_EXERCISES.some((e) => e.loadType === 'assisted')).toBe(true)
  })

  it('ensureCatalog seeds once and never overwrites', () => {
    ensureCatalog()
    expect(getDb().exercises.length).toBe(STARTER_EXERCISES.length)
    update((db) => ({ ...db, exercises: db.exercises.slice(0, 1) }))
    ensureCatalog()
    expect(getDb().exercises.length).toBe(1)
  })
})

describe('cleanupSeededCatalog', () => {
  function seedEx(id: string, isCustom: boolean): Exercise {
    return {
      id,
      name: id,
      muscleGroup: 'chest',
      primaryMuscle: 'chest',
      equipment: 'barbell',
      loadType: 'weighted',
      kind: 'strength',
      type: 'weight',
      isCustom,
      notes: '',
    }
  }

  // A store mixing an unreferenced seed row (should be deleted) with seed rows
  // held by a live routine, an archived routine, a setLog, and a target, plus a
  // custom row nothing references (never touched).
  function setupMixed(): void {
    update((db) => ({
      ...db,
      exercises: [
        seedEx('unused-seed', false),
        seedEx('routine-seed', false),
        seedEx('archived-routine-seed', false),
        seedEx('log-seed', false),
        seedEx('target-seed', false),
        seedEx('custom-unused', true),
      ],
      routines: [
        { id: 'r-live', name: 'Live', defaultRestSec: 90, cycleOrder: 0, warmup: false, archived: false },
        { id: 'r-arch', name: 'Arch', defaultRestSec: 90, cycleOrder: null, warmup: false, archived: true },
      ],
      routineItems: [
        { id: 'ri1', routineId: 'r-live', exerciseId: 'routine-seed', order: 0, sets: 3, repsPerSet: 10, targetRIR: null, restSec: null },
        { id: 'ri2', routineId: 'r-arch', exerciseId: 'archived-routine-seed', order: 0, sets: 3, repsPerSet: 10, targetRIR: null, restSec: null },
      ],
      setLogs: [
        { id: 'l1', sessionId: 's1', exerciseId: 'log-seed', exerciseName: 'Log Seed', setNumber: 1, isWarmup: false, weightKg: 50, reps: 10, rir: 2, values: null, completedAt: T0 },
      ],
      targets: [
        { id: 't1', exerciseId: 'target-seed', weightKg: 60, note: '', createdAt: T0, expiresAt: T0 + 1000 },
      ],
    }))
  }

  it('deletes unreferenced non-custom exercises', () => {
    setupMixed()
    cleanupSeededCatalog()
    const ids = getDb().exercises.map((e) => e.id)
    expect(ids).not.toContain('unused-seed')
  })

  it('keeps routine-referenced (live + archived), setLog-referenced, target-referenced, and custom exercises', () => {
    setupMixed()
    cleanupSeededCatalog()
    const ids = new Set(getDb().exercises.map((e) => e.id))
    expect(ids.has('routine-seed')).toBe(true)
    expect(ids.has('archived-routine-seed')).toBe(true)
    expect(ids.has('log-seed')).toBe(true)
    expect(ids.has('target-seed')).toBe(true)
    expect(ids.has('custom-unused')).toBe(true)
    expect(ids.size).toBe(5)
  })

  it('is idempotent on a second run', () => {
    setupMixed()
    cleanupSeededCatalog()
    const first = JSON.stringify(getDb())
    cleanupSeededCatalog()
    expect(JSON.stringify(getDb())).toBe(first)
  })

  it('leaves a fresh empty store empty (never reseeds)', () => {
    expect(getDb().exercises).toHaveLength(0)
    cleanupSeededCatalog()
    expect(getDb().exercises).toHaveLength(0)
  })

  it('never deletes custom exercises even when unreferenced', () => {
    update((db) => ({ ...db, exercises: [seedEx('c1', true), seedEx('c2', true)] }))
    cleanupSeededCatalog()
    expect(getDb().exercises.map((e) => e.id)).toEqual(['c1', 'c2'])
  })
})

describe('seedDemoData', () => {
  beforeEach(() => seedDemoData(T0))

  it('creates the 4 rotation routines plus 2 non-rotation ones', () => {
    const db = getDb()
    const rotation = db.routines.filter((r) => r.cycleOrder !== null)
    expect(rotation.map((r) => r.name).sort()).toEqual(['Legs', 'Pull A', 'Push A', 'Push B'])
    expect(new Set(rotation.map((r) => r.cycleOrder))).toEqual(new Set([0, 1, 2, 3]))
    expect(db.routines.filter((r) => r.cycleOrder === null)).toHaveLength(2)
  })

  it('keeps referential integrity across routines, items, sessions, and logs', () => {
    const db = getDb()
    const exerciseIds = new Set(db.exercises.map((e) => e.id))
    const routineIds = new Set(db.routines.map((r) => r.id))
    const sessionIds = new Set(db.sessions.map((s) => s.id))
    for (const it of db.routineItems) {
      expect(exerciseIds.has(it.exerciseId)).toBe(true)
      expect(routineIds.has(it.routineId)).toBe(true)
    }
    for (const l of db.setLogs) {
      expect(exerciseIds.has(l.exerciseId)).toBe(true)
      expect(sessionIds.has(l.sessionId)).toBe(true)
    }
    for (const t of db.targets) expect(exerciseIds.has(t.exerciseId)).toBe(true)
  })

  it('produces 2–3 weeks of completed sessions with plausible logs', () => {
    const db = getDb()
    expect(db.sessions).toHaveLength(12)
    expect(db.sessions.every((s) => s.status === 'completed' && s.finishedAt !== null)).toBe(true)
    const span = T0 - Math.min(...db.sessions.map((s) => s.startedAt))
    expect(span).toBeGreaterThanOrEqual(14 * 24 * 3600 * 1000)
    expect(span).toBeLessThanOrEqual(21 * 24 * 3600 * 1000)
    // warm-up logs exist (Push A bench)
    expect(db.setLogs.some((l) => l.isWarmup && l.exerciseId === 'bench-press')).toBe(true)
    // cardio logs carry values, zero weight
    const cardioLog = db.setLogs.find((l) => l.exerciseId === 'row-erg')!
    expect(cardioLog.weightKg).toBe(0)
    expect(cardioLog.values).toBeTruthy()
    // RIR present on working strength sets, null on warm-ups
    expect(db.setLogs.filter((l) => !l.isWarmup && l.exerciseId === 'bench-press').every((l) => l.rir !== null)).toBe(true)
    expect(db.setLogs.filter((l) => l.isWarmup).every((l) => l.rir === null)).toBe(true)
  })

  it('is deterministic for a fixed now', () => {
    const first = JSON.stringify(getDb())
    resetDb()
    seedDemoData(T0)
    expect(JSON.stringify(getDb())).toBe(first)
  })
})

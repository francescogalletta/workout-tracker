import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_ROUTINE, EXERCISE_DB } from '../runner/demo'
import { ensureCatalog, seedDemoData, STARTER_EXERCISES } from './seed'
import { getDb, resetDb, update } from './store'

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

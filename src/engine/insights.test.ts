import { describe, expect, it } from 'vitest'
import { emptyDb, type Db, type SetLog } from '../data/types'
import { muscleBalance, suggestedAdjustments } from './insights'

const T0 = 1_750_000_000_000
const DAY = 24 * 3600 * 1000
const WEEKS = 4

let logSeq = 0
function log(
  exerciseId: string,
  weightKg: number,
  reps: number,
  rir: number | null,
  daysAgo: number,
  extra: Partial<SetLog> = {},
): SetLog {
  return {
    id: `l${++logSeq}`,
    sessionId: extra.sessionId ?? `sess-${daysAgo}`,
    exerciseId,
    exerciseName: exerciseId,
    setNumber: 1,
    isWarmup: false,
    weightKg,
    reps,
    rir,
    values: null,
    completedAt: T0 - daysAgo * DAY,
    ...extra,
  }
}

function baseDb(): Db {
  const db = emptyDb()
  db.exercises = [
    { id: 'bench', name: 'Bench Press', muscleGroup: 'chest', primaryMuscle: 'chest', equipment: 'barbell', loadType: 'weighted', kind: 'strength', isCustom: false, notes: '' },
    { id: 'row', name: 'Barbell Row', muscleGroup: 'back', primaryMuscle: 'upper back', equipment: 'barbell', loadType: 'weighted', kind: 'strength', isCustom: false, notes: '' },
    { id: 'squat', name: 'Back Squat', muscleGroup: 'legs', primaryMuscle: 'quads', equipment: 'barbell', loadType: 'weighted', kind: 'strength', isCustom: false, notes: '' },
    { id: 'erg', name: 'Row Erg', muscleGroup: 'cardio', primaryMuscle: 'cardio', equipment: 'machine', loadType: 'bodyweight', kind: 'cardio', metrics: [], isCustom: false, notes: '' },
  ]
  db.routines = [
    { id: 'r1', name: 'A', defaultRestSec: 90, cycleOrder: 0, warmup: false, archived: false },
  ]
  db.routineItems = [
    { id: 'i1', routineId: 'r1', exerciseId: 'bench', order: 0, sets: 4, repsPerSet: 10, targetRIR: 2, restSec: null },
    { id: 'i2', routineId: 'r1', exerciseId: 'row', order: 1, sets: 3, repsPerSet: 10, targetRIR: 2, restSec: null },
    { id: 'i3', routineId: 'r1', exerciseId: 'squat', order: 2, sets: 3, repsPerSet: 8, targetRIR: 2, restSec: null },
  ]
  return db
}

describe('suggestedAdjustments — lower weight', () => {
  it('fires at exactly 40% RIR-0 sets with avg reps below target', () => {
    const db = baseDb()
    db.setLogs = [
      log('bench', 50, 8, 0, 3),
      log('bench', 50, 8, 0, 3),
      log('bench', 50, 9, 1, 3),
      log('bench', 50, 9, 1, 3),
      log('bench', 50, 9, 2, 3),
    ] // 2/5 = 40% at RIR 0, avg reps 8.6 < 10
    const out = suggestedAdjustments(db, WEEKS, T0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      exerciseId: 'bench',
      kind: 'lower',
      currentWeightKg: 50,
      suggestedWeightKg: 45, // −10% rounded to 1.25
    })
    expect(out[0].detail).toContain('40% of sets at RIR 0')
  })

  it('rounds the −10% suggestion to 1.25 kg', () => {
    const db = baseDb()
    db.setLogs = [log('bench', 52.5, 8, 0, 2), log('bench', 52.5, 8, 0, 2)]
    const out = suggestedAdjustments(db, WEEKS, T0)
    expect(out[0].suggestedWeightKg).toBe(47.5) // 47.25 → 1.25 grid → 47.5
  })

  it('does not fire below 40% or when avg reps meet the target', () => {
    const db = baseDb()
    db.setLogs = [
      log('bench', 50, 8, 0, 3),
      log('bench', 50, 9, 1, 3),
      log('bench', 50, 9, 1, 3), // 33% at RIR 0
    ]
    expect(suggestedAdjustments(db, WEEKS, T0)).toHaveLength(0)
    db.setLogs = [log('bench', 50, 10, 0, 3), log('bench', 50, 10, 0, 3)] // reps at target
    expect(suggestedAdjustments(db, WEEKS, T0)).toHaveLength(0)
  })
})

describe('suggestedAdjustments — add weight', () => {
  it('fires when avg RIR ≥ target + 1 (exact boundary) and adds one increment', () => {
    const db = baseDb()
    db.setLogs = [log('row', 60, 10, 3, 2), log('row', 60, 10, 3, 2), log('row', 60, 10, 3, 2)]
    const out = suggestedAdjustments(db, WEEKS, T0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      exerciseId: 'row',
      kind: 'raise',
      currentWeightKg: 60,
      suggestedWeightKg: 62.5,
    })
  })

  it('stays quiet at avg RIR below target + 1', () => {
    const db = baseDb()
    db.setLogs = [log('row', 60, 10, 3, 2), log('row', 60, 10, 2, 2)]
    expect(suggestedAdjustments(db, WEEKS, T0)).toHaveLength(0)
  })
})

describe('suggestedAdjustments — scoping and ordering', () => {
  it('ignores warm-ups, cardio, out-of-window logs, and exercises without a routine item', () => {
    const db = baseDb()
    db.exercises.push({ id: 'orphan', name: 'Orphan', muscleGroup: 'arms', primaryMuscle: 'biceps', equipment: 'cable', loadType: 'weighted', kind: 'strength', isCustom: false, notes: '' })
    db.setLogs = [
      log('bench', 50, 8, 0, 3, { isWarmup: true }),
      log('erg', 0, 0, null, 3),
      log('bench', 50, 8, 0, WEEKS * 7 + 1), // outside the window
      log('orphan', 20, 8, 0, 3),
      log('orphan', 20, 8, 0, 3),
    ]
    expect(suggestedAdjustments(db, WEEKS, T0)).toHaveLength(0)
  })

  it('sorts lower-weight suggestions before add-weight ones', () => {
    const db = baseDb()
    db.setLogs = [
      log('row', 60, 10, 3, 2),
      log('row', 60, 10, 3, 2),
      log('bench', 50, 8, 0, 3),
      log('bench', 50, 8, 0, 3),
    ]
    const out = suggestedAdjustments(db, WEEKS, T0)
    expect(out.map((a) => a.kind)).toEqual(['lower', 'raise'])
  })

  it('uses the most recent session in the window for the current weight', () => {
    const db = baseDb()
    db.setLogs = [
      log('bench', 47.5, 8, 0, 10, { sessionId: 'old' }),
      log('bench', 50, 8, 0, 2, { sessionId: 'new' }),
    ]
    const out = suggestedAdjustments(db, WEEKS, T0)
    expect(out[0].currentWeightKg).toBe(50)
  })
})

describe('muscleBalance', () => {
  it('computes working sets per week per group vs the 10–20 band', () => {
    const db = baseDb()
    // 20 bench sets over 2 weeks = 10/wk (ok, exact lower edge);
    // 19 squat sets = 9.5/wk (low); back untouched (0, low).
    db.setLogs = [
      ...Array.from({ length: 20 }, (_, i) => log('bench', 50, 10, 2, (i % 12) + 1)),
      ...Array.from({ length: 19 }, (_, i) => log('squat', 100, 8, 2, (i % 12) + 1)),
      log('erg', 0, 0, null, 2), // cardio never counts
      log('bench', 50, 10, null, 3, { isWarmup: true }), // warm-ups never count
    ]
    const rows = muscleBalance(db, 2, T0)
    expect(rows.map((r) => r.muscleGroup)).toEqual(['chest', 'back', 'legs'])
    expect(rows[0]).toMatchObject({ muscleGroup: 'chest', setsPerWeek: 10, status: 'ok' })
    expect(rows[1]).toMatchObject({ muscleGroup: 'back', setsPerWeek: 0, status: 'low' })
    expect(rows[2]).toMatchObject({ muscleGroup: 'legs', setsPerWeek: 9.5, status: 'low' })
  })
})

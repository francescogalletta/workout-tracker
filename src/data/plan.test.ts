import { beforeEach, describe, expect, it } from 'vitest'
import { importRecompPlan, RECOMP_CUSTOM_EXERCISES, RECOMP_ROUTINE_IDS } from './plan'
import { itemsForRoutine, rotationRoutines } from './queries'
import { seedDemoData, STARTER_EXERCISES } from './seed'
import { getDb, resetDb } from './store'
import { effectiveRIR } from './types'

const T0 = 1_750_000_000_000

beforeEach(() => resetDb())

describe('importRecompPlan', () => {
  beforeEach(() => importRecompPlan(T0))

  it('creates the 5 split days in rotation order with the plan names', () => {
    const rotation = rotationRoutines(getDb())
    expect(rotation.map((r) => r.id)).toEqual([
      'r-recomp-upper',
      'r-recomp-lower',
      'r-recomp-push',
      'r-recomp-pull',
      'r-recomp-legs',
    ])
    expect(rotation.map((r) => r.cycleOrder)).toEqual([0, 1, 2, 3, 4])
    expect(rotation.map((r) => r.name)).toEqual([
      'Upper (strength bias)',
      'Lower (strength bias)',
      'Push (hypertrophy)',
      'Pull (hypertrophy)',
      'Legs (hypertrophy)',
    ])
    // Plan warms up the first compound of every session.
    expect(rotation.every((r) => r.warmup)).toBe(true)
    expect(RECOMP_ROUTINE_IDS).toEqual(rotation.map((r) => r.id))
  })

  it('gives each day the document exercise count', () => {
    const db = getDb()
    const counts = Object.fromEntries(
      RECOMP_ROUTINE_IDS.map((id) => [id, itemsForRoutine(db, id).length]),
    )
    expect(counts).toEqual({
      'r-recomp-upper': 9,
      'r-recomp-lower': 8,
      'r-recomp-push': 6,
      'r-recomp-pull': 6,
      'r-recomp-legs': 8,
    })
  })

  it('every working set carries the Phase-0 target of RIR 3 (via routine default)', () => {
    const db = getDb()
    const items = db.routineItems.filter((it) => it.routineId.startsWith('r-recomp-'))
    expect(items.length).toBe(37)
    // Phase-0 RIR lives on the routines; items defer to it (null override).
    expect(items.every((it) => it.targetRIR === null)).toBe(true)
    const routines = db.routines.filter((r) => r.id.startsWith('r-recomp-'))
    expect(routines.every((r) => r.defaultTargetRIR === 3)).toBe(true)
    expect(
      items.every((it) => effectiveRIR(it, routines.find((r) => r.id === it.routineId)!) === 3),
    ).toBe(true)
  })

  it('spot-checks sets/reps/RIR/rest against the document', () => {
    const db = getDb()
    // Upper › Barbell bench 4×6–8 → bottom of range, strength-day default 150 s.
    const bench = itemsForRoutine(db, 'r-recomp-upper')[0]
    expect(bench.exerciseId).toBe('bench-press')
    expect([bench.sets, bench.repsPerSet, bench.targetRIR]).toEqual([4, 6, null])
    expect(bench.restSec).toBe(null) // uses routine default 150
    expect(db.routines.find((r) => r.id === 'r-recomp-upper')!.defaultRestSec).toBe(150)

    // Lower › trap-bar deadlift is the guardrail swap for the floor deadlift.
    const trap = itemsForRoutine(db, 'r-recomp-lower')[0]
    expect(trap.exerciseId).toBe('trap-bar-deadlift')
    expect([trap.sets, trap.repsPerSet]).toEqual([4, 6])

    // Push › lateral raises 4×12–20 → 12 reps, isolation rest override 60 s.
    const laterals = itemsForRoutine(db, 'r-recomp-push')[3]
    expect(laterals.exerciseId).toBe('lateral-raise')
    expect([laterals.sets, laterals.repsPerSet, laterals.restSec]).toEqual([4, 12, 60])

    // Legs › Bulgarian split squat 3×10–12/leg → 10, supported guardrail move.
    const bss = itemsForRoutine(db, 'r-recomp-legs')[2]
    expect(bss.exerciseId).toBe('bulgarian-split-squat')
    expect([bss.sets, bss.repsPerSet]).toEqual([3, 10])
  })

  it('creates custom exercises with isCustom + sane groups, no catalog dupes', () => {
    const db = getDb()
    const catalogIds = new Set(STARTER_EXERCISES.map((e) => e.id))
    for (const ce of RECOMP_CUSTOM_EXERCISES) {
      expect(catalogIds.has(ce.id), `${ce.id} must not collide with catalog`).toBe(false)
      const row = db.exercises.find((e) => e.id === ce.id)!
      expect(row, ce.id).toBeTruthy()
      expect(row.isCustom).toBe(true)
      expect(row.kind).toBe('strength')
      expect(row.muscleGroup).toBeTruthy()
      expect(row.primaryMuscle).toBeTruthy()
      expect(row.equipment).toBeTruthy()
    }
    // Guardrail swaps and anti-movement core all landed as customs. (Side Plank
    // now ships in the starter catalog as a timed hold, so it is no longer a
    // plan-owned custom — the plan just references the catalog row.)
    for (const id of ['trap-bar-deadlift', 'back-extension', 'pallof-press', 'dead-bug', 'bird-dog']) {
      expect(db.exercises.some((e) => e.id === id && e.isCustom)).toBe(true)
    }
    // Anti-movement core is modelled as strength (no invented cardio metrics).
    const core = db.exercises.find((e) => e.id === 'side-plank')!
    expect(core.kind).toBe('strength')
    expect(core.metrics).toBeUndefined()
  })

  it('every plan item references a real exercise', () => {
    const db = getDb()
    const exIds = new Set(db.exercises.map((e) => e.id))
    const items = db.routineItems.filter((it) => it.routineId.startsWith('r-recomp-'))
    for (const it of items) expect(exIds.has(it.exerciseId), it.exerciseId).toBe(true)
  })
})

describe('importRecompPlan idempotency', () => {
  it('re-running produces an identical, diff-free Db', () => {
    importRecompPlan(T0)
    const first = JSON.stringify(getDb())
    importRecompPlan(T0)
    expect(JSON.stringify(getDb())).toBe(first)
    // No duplicate routines or items.
    const db = getDb()
    expect(db.routines.filter((r) => r.id.startsWith('r-recomp-'))).toHaveLength(5)
    expect(db.routineItems.filter((it) => it.routineId.startsWith('r-recomp-'))).toHaveLength(37)
    const exCount = db.exercises.length
    importRecompPlan(T0)
    expect(getDb().exercises.length).toBe(exCount)
  })
})

describe('importRecompPlan coexistence with demo data', () => {
  beforeEach(() => {
    seedDemoData(T0)
    importRecompPlan(T0)
  })

  it('leaves the demo routines intact and appends the plan to the rotation', () => {
    const db = getDb()
    // Demo rotation routines survive.
    for (const id of ['r-push-a', 'r-pull-a', 'r-legs', 'r-push-b']) {
      expect(db.routines.some((r) => r.id === id), id).toBe(true)
    }
    // Demo items untouched.
    expect(itemsForRoutine(db, 'r-push-a').length).toBeGreaterThan(0)
    // Demo sessions/logs untouched.
    expect(db.sessions.length).toBe(12)

    const rotation = rotationRoutines(db)
    // Dense 0..n-1 with no gaps or collisions.
    expect(rotation.map((r) => r.cycleOrder)).toEqual(rotation.map((_, i) => i))
    // Demo's 4 rotation slots keep positions 0–3; plan appended at 4–8.
    const planIdx = RECOMP_ROUTINE_IDS.map((id) => rotation.findIndex((r) => r.id === id))
    expect(planIdx).toEqual([4, 5, 6, 7, 8])
  })

  it('still idempotent when demo data is present', () => {
    const first = JSON.stringify(getDb())
    importRecompPlan(T0)
    expect(JSON.stringify(getDb())).toBe(first)
  })
})

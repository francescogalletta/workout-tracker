import { describe, expect, it } from 'vitest'
import { emptyDb, type Db, type Exercise, type Routine, type SetLog } from '../types'
import { SETTINGS_SLUG, diffDb, type TxOp } from './diff'
import { deterministicUuid, isUuid, slugToUuid } from './ids'
import { type InstantData, rowsToDb } from './mapper'

const OWNER = 'user-1'

function ex(id: string, over: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: id,
    muscleGroup: 'chest',
    primaryMuscle: 'chest',
    equipment: 'barbell',
    loadType: 'weighted',
    kind: 'strength',
    isCustom: false,
    notes: '',
    ...over,
  }
}

function routine(id: string, over: Partial<Routine> = {}): Routine {
  return { id, name: id, defaultRestSec: 90, cycleOrder: null, warmup: true, archived: false, ...over }
}

function setLog(id: string, over: Partial<SetLog> = {}): SetLog {
  return {
    id,
    sessionId: 's1',
    exerciseId: 'bench-press',
    exerciseName: 'Bench Press',
    setNumber: 1,
    isWarmup: false,
    weightKg: 60,
    reps: 8,
    rir: 2,
    values: null,
    completedAt: 1000,
    ...over,
  }
}

const byEntity = (ops: TxOp[], entity: string) => ops.filter((o) => o.entity === entity)

describe('diffDb', () => {
  it('no-op for identical snapshots', () => {
    const db = emptyDb()
    expect(diffDb(db, db, OWNER)).toEqual([])
    // A structurally-equal but distinct object also diffs to nothing.
    expect(diffDb(emptyDb(), emptyDb(), OWNER)).toEqual([])
  })

  it('emits create ops with slug + owner for added rows', () => {
    const prev = emptyDb()
    const next: Db = { ...prev, exercises: [ex('bench-press', { notes: 'seat 4' })] }
    const ops = diffDb(prev, next, OWNER)
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op).toMatchObject({ entity: 'exercises', id: 'bench-press', op: 'update' })
    // create carries every field except `id`, plus slug + owner…
    expect(op.fields).toMatchObject({ name: 'bench-press', notes: 'seat 4', slug: 'bench-press', owner: OWNER })
    // …and never the reserved `id`.
    expect(op.fields).not.toHaveProperty('id')
  })

  it('emits update ops with ONLY changed fields (no slug/owner) for edits', () => {
    const prev: Db = { ...emptyDb(), routines: [routine('r1', { cycleOrder: null })] }
    const next: Db = { ...emptyDb(), routines: [routine('r1', { cycleOrder: 2, name: 'Push A' })] }
    const ops = diffDb(prev, next, OWNER)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'routines', id: 'r1', op: 'update' })
    expect(ops[0].fields).toEqual({ cycleOrder: 2, name: 'Push A' })
  })

  it('detects deep changes in json fields (values) but skips unchanged ones', () => {
    const prev: Db = { ...emptyDb(), setLogs: [setLog('l1', { values: { time: 600 } })] }
    const same: Db = { ...emptyDb(), setLogs: [setLog('l1', { values: { time: 600 } })] }
    expect(diffDb(prev, same, OWNER)).toEqual([])

    const changed: Db = { ...emptyDb(), setLogs: [setLog('l1', { values: { time: 900 } })] }
    const ops = diffDb(prev, changed, OWNER)
    expect(ops).toHaveLength(1)
    expect(ops[0].fields).toEqual({ values: { time: 900 } })
  })

  it('emits delete ops for removed rows', () => {
    const prev: Db = { ...emptyDb(), exercises: [ex('a'), ex('b')] }
    const next: Db = { ...emptyDb(), exercises: [ex('a')] }
    const ops = diffDb(prev, next, OWNER)
    expect(ops).toEqual([{ entity: 'exercises', id: 'b', op: 'delete' }])
  })

  it('handles adds, updates and deletes together', () => {
    const prev: Db = { ...emptyDb(), exercises: [ex('a', { notes: 'x' }), ex('b')] }
    const next: Db = { ...emptyDb(), exercises: [ex('a', { notes: 'y' }), ex('c')] }
    const ops = diffDb(prev, next, OWNER)
    const ex_ops = byEntity(ops, 'exercises')
    expect(ex_ops).toHaveLength(3)
    expect(ex_ops.find((o) => o.id === 'a')).toMatchObject({ op: 'update', fields: { notes: 'y' } })
    expect(ex_ops.find((o) => o.id === 'c')?.op).toBe('update')
    expect(ex_ops.find((o) => o.id === 'c')?.fields).toMatchObject({ slug: 'c', owner: OWNER })
    expect(ex_ops.find((o) => o.id === 'b')).toEqual({ entity: 'exercises', id: 'b', op: 'delete' })
  })

  it('upserts the settings singleton on any settings change', () => {
    const prev = emptyDb()
    const next: Db = { ...prev, settings: { ...prev.settings, email: 'a@b.c', defaultRestSec: 120 } }
    const ops = diffDb(prev, next, OWNER)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'settings', id: SETTINGS_SLUG, op: 'update' })
    // full row upsert, with slug + owner
    expect(ops[0].fields).toMatchObject({
      email: 'a@b.c',
      defaultRestSec: 120,
      slug: SETTINGS_SLUG,
      owner: OWNER,
    })
  })

  it('does not touch settings when unchanged', () => {
    const db = { ...emptyDb(), exercises: [ex('a')] }
    const next = { ...db, exercises: [ex('a', { notes: 'n' })] }
    expect(byEntity(diffDb(db, next, OWNER), 'settings')).toEqual([])
  })
})

describe('slugToUuid / deterministicUuid', () => {
  it('passes real UUIDs through unchanged (lowercased)', () => {
    const u = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
    expect(slugToUuid(u)).toBe(u)
    expect(slugToUuid(u.toUpperCase())).toBe(u)
  })

  it('maps slugs to deterministic, well-formed v5 UUIDs', () => {
    const a = slugToUuid('bench-press')
    const b = slugToUuid('bench-press')
    expect(a).toBe(b) // deterministic
    expect(isUuid(a)).toBe(true) // well-formed
    expect(a[14]).toBe('5') // version nibble
    expect('89ab').toContain(a[19]) // variant nibble
    expect(slugToUuid('incline-db-press')).not.toBe(a) // distinct slugs → distinct ids
  })

  it('deterministicUuid is stable for the same input', () => {
    expect(deterministicUuid('r-push-a')).toBe(deterministicUuid('r-push-a'))
  })
})

describe('rowsToDb (read mapper)', () => {
  it('restores app ids from slug and drops instant id/owner/slug', () => {
    const data: InstantData = {
      exercises: [
        {
          id: 'uuid-xyz',
          slug: 'bench-press',
          owner: OWNER,
          name: 'Bench Press',
          muscleGroup: 'chest',
          primaryMuscle: 'chest',
          equipment: 'barbell',
          loadType: 'weighted',
          kind: 'strength',
          isCustom: false,
          notes: '',
        },
      ],
    }
    const db = rowsToDb(data)
    expect(db.exercises).toHaveLength(1)
    expect(db.exercises[0].id).toBe('bench-press')
    expect(db.exercises[0]).not.toHaveProperty('owner')
    expect(db.exercises[0]).not.toHaveProperty('slug')
  })

  it('coerces missing optional numbers to null', () => {
    const db = rowsToDb({
      routines: [{ slug: 'r1', name: 'R', defaultRestSec: 90, warmup: true, archived: false }],
      sessions: [{ slug: 's1', routineName: 'R', status: 'active', startedAt: 5 }],
    })
    expect(db.routines[0].cycleOrder).toBeNull()
    expect(db.sessions[0].finishedAt).toBeNull()
    expect(db.sessions[0].routineId).toBeNull()
  })

  it('reads the settings singleton, else defaults', () => {
    expect(rowsToDb({}).settings.email).toBeNull()
    const db = rowsToDb({ settings: [{ slug: 'settings', email: 'a@b.c', defaultRestSec: 60, soundEnabled: false, weightIncrementKg: 5, unit: 'lb', theme: 'ember' }] })
    expect(db.settings).toMatchObject({ email: 'a@b.c', defaultRestSec: 60, unit: 'lb', theme: 'ember' })
  })

  it('round-trips a create diff back through the mapper', () => {
    // Simulate: diff produces create fields → those become the stored row →
    // mapper restores the original app row.
    const original = ex('bench-press', { notes: 'seat 4' })
    const [op] = diffDb(emptyDb(), { ...emptyDb(), exercises: [original] }, OWNER)
    const storedRow = { id: slugToUuid(op.id), ...op.fields }
    const db = rowsToDb({ exercises: [storedRow] })
    expect(db.exercises[0]).toEqual(original)
  })
})

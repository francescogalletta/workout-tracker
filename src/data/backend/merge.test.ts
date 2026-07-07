import { describe, expect, it } from 'vitest'
import { type Db, emptyDb } from '../types'
import { diffDb } from './diff'
import { mergeDb } from './merge'

/**
 * mergeDb is the pure core of the sign-in merge-up. These tests pin the four
 * hard requirements: empty remote → local uploaded; disjoint → union; id
 * conflict → remote wins; and idempotency (a second merge produces no further
 * `diffDb` ops), including the deterministic-slug catalog collision case.
 */

const OWNER = 'auth-user-1'

function ex(id: string, name: string): Db['exercises'][number] {
  return {
    id,
    name,
    muscleGroup: 'chest',
    primaryMuscle: 'chest',
    equipment: 'barbell',
    loadType: 'weighted',
    kind: 'strength',
    isCustom: false,
    notes: '',
  }
}

function routine(id: string, name: string): Db['routines'][number] {
  return { id, name, defaultRestSec: 90, cycleOrder: null, warmup: false, archived: false }
}

function dbWith(patch: Partial<Db>): Db {
  return { ...emptyDb(), ...patch }
}

describe('mergeDb', () => {
  it('uploads all local data when the remote is empty (new account)', () => {
    const local = dbWith({
      exercises: [ex('bench-press', 'Bench Press')],
      routines: [routine('r-push', 'Push')],
    })
    const merged = mergeDb(emptyDb(), local)
    expect(merged.exercises).toEqual(local.exercises)
    expect(merged.routines).toEqual(local.routines)
    // Everything local is missing from the empty remote → all become create ops.
    const ops = diffDb(emptyDb(), merged, OWNER)
    expect(ops.filter((o) => o.entity === 'exercises')).toHaveLength(1)
    expect(ops.filter((o) => o.entity === 'routines')).toHaveLength(1)
  })

  it('unions disjoint remote and local data', () => {
    const remote = dbWith({ exercises: [ex('squat', 'Squat')] })
    const local = dbWith({ exercises: [ex('bench-press', 'Bench Press')] })
    const merged = mergeDb(remote, local)
    expect(merged.exercises.map((e) => e.id).sort()).toEqual(['bench-press', 'squat'])
    // Remote rows come first, local-only appended.
    expect(merged.exercises[0].id).toBe('squat')
    expect(merged.exercises[1].id).toBe('bench-press')
  })

  it('lets the remote row win on an id conflict', () => {
    const remote = dbWith({ exercises: [ex('bench-press', 'Bench Press (cloud)')] })
    const local = dbWith({ exercises: [ex('bench-press', 'Bench Press (local edit)')] })
    const merged = mergeDb(remote, local)
    expect(merged.exercises).toHaveLength(1)
    expect(merged.exercises[0].name).toBe('Bench Press (cloud)')
  })

  it('deterministic-slug catalog rows collide by id and dedupe to a no-op', () => {
    // Same catalog seeded on both sides → identical slug ids.
    const catalog = [ex('bench-press', 'Bench Press'), ex('squat', 'Squat')]
    const remote = dbWith({ exercises: catalog })
    const local = dbWith({ exercises: catalog })
    const merged = mergeDb(remote, local)
    expect(merged.exercises).toHaveLength(2) // no duplicates
    // Nothing to upload: the merged catalog already equals the remote catalog.
    const ops = diffDb(remote, merged, OWNER)
    expect(ops).toEqual([])
  })

  it('remote settings win when they exist (email marker), else local settings', () => {
    const remote = dbWith({ settings: { ...emptyDb().settings, email: 'me@cloud.com', unit: 'lb' } })
    const local = dbWith({ settings: { ...emptyDb().settings, email: 'me@local.com', unit: 'kg' } })
    expect(mergeDb(remote, local).settings.unit).toBe('lb') // remote wins

    const freshRemote = emptyDb() // no email → no remote settings row
    const offlineLocal = dbWith({
      settings: { ...emptyDb().settings, theme: 'ember', unit: 'lb' },
    })
    expect(mergeDb(freshRemote, offlineLocal).settings.theme).toBe('ember') // local kept
  })

  it('is idempotent under diffDb — merging twice yields no further ops', () => {
    const remote = dbWith({
      exercises: [ex('squat', 'Squat')],
      settings: { ...emptyDb().settings, email: 'me@cloud.com' },
    })
    const local = dbWith({
      exercises: [ex('squat', 'Squat'), ex('bench-press', 'Bench Press')],
      routines: [routine('r-push', 'Push')],
    })
    const merged = mergeDb(remote, local)
    // After the first upload, remote becomes `merged`. A second merge with the
    // same local must reproduce merged exactly → diffDb sees nothing to do.
    const again = mergeDb(merged, local)
    expect(diffDb(merged, again, OWNER)).toEqual([])
  })
})

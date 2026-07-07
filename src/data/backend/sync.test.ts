import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Db, emptyDb } from '../types'
import { diffDb } from './diff'
import { DB_BACKUP_KEY, type DbBackup, adoptRemote, classifySync, remoteCounts } from './sync'

/**
 * Pure core of the replace-after-warning sign-in adoption. classifySync's truth
 * table (fresh/meaningful keyed on routines/sessions/setLogs/targets only) and
 * adoptRemote (backs local up, folds email, replaces verbatim, idempotent).
 */

const OWNER = 'auth-user-1'

function routine(id: string, name: string): Db['routines'][number] {
  return { id, name, defaultRestSec: 90, cycleOrder: null, warmup: false, archived: false }
}

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

function session(id: string): Db['sessions'][number] {
  return { id, routineId: null, routineName: 'Push', status: 'completed', startedAt: 1, finishedAt: 2 }
}

function target(id: string): Db['targets'][number] {
  return { id, exerciseId: 'bench', weightKg: 100, note: '', createdAt: 1, expiresAt: 2 }
}

function setLog(id: string): Db['setLogs'][number] {
  return {
    id,
    sessionId: 's1',
    exerciseId: 'bench',
    exerciseName: 'Bench',
    setNumber: 1,
    isWarmup: false,
    weightKg: 100,
    reps: 5,
    rir: 2,
    values: null,
    completedAt: 1,
  }
}

function dbWith(patch: Partial<Db>): Db {
  return { ...emptyDb(), ...patch }
}

describe('classifySync', () => {
  const meaningful = dbWith({ routines: [routine('r1', 'Push')] })
  const fresh = emptyDb()

  it('remote fresh, local fresh → upload-local', () => {
    expect(classifySync(fresh, fresh)).toBe('upload-local')
  })

  it('remote fresh, local meaningful → upload-local', () => {
    expect(classifySync(fresh, meaningful)).toBe('upload-local')
  })

  it('remote meaningful, local fresh → adopt-remote', () => {
    expect(classifySync(meaningful, fresh)).toBe('adopt-remote')
  })

  it('remote meaningful AND local meaningful → conflict', () => {
    expect(classifySync(meaningful, meaningful)).toBe('conflict')
  })

  it('counts sessions, setLogs and targets as meaningful too', () => {
    expect(classifySync(dbWith({ sessions: [session('s1')] }), fresh)).toBe('adopt-remote')
    expect(classifySync(dbWith({ setLogs: [setLog('l1')] }), fresh)).toBe('adopt-remote')
    expect(classifySync(dbWith({ targets: [target('t1')] }), fresh)).toBe('adopt-remote')
  })

  it('an exercises-only remote reads as fresh (catalog does not count)', () => {
    const catalogOnly = dbWith({ exercises: [ex('bench-press', 'Bench Press')] })
    expect(classifySync(catalogOnly, meaningful)).toBe('upload-local')
  })

  it('a settings-only local reads as fresh (device prefs do not count)', () => {
    const settingsOnly = dbWith({ settings: { ...emptyDb().settings, theme: 'ember', unit: 'lb' } })
    expect(classifySync(meaningful, settingsOnly)).toBe('adopt-remote')
  })
})

describe('remoteCounts', () => {
  it('reports routines and workouts (sessions) from the remote snapshot', () => {
    const remote = dbWith({
      routines: [routine('r1', 'Push'), routine('r2', 'Pull')],
      sessions: [session('s1'), session('s2'), session('s3')],
    })
    expect(remoteCounts(remote)).toEqual({ routines: 2, workouts: 3 })
  })
})

describe('adoptRemote', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('writes a timestamped backup of the local Db before overwriting', () => {
    const local = dbWith({ routines: [routine('r-local', 'Local')] })
    const remote = dbWith({ routines: [routine('r-remote', 'Remote')] })
    const before = Date.now()
    adoptRemote(remote, local, 'me@x.com')
    const raw = store.get(DB_BACKUP_KEY)
    expect(raw).toBeTruthy()
    const backup = JSON.parse(raw!) as DbBackup
    expect(backup.db).toEqual(local)
    expect(typeof backup.savedAt).toBe('number')
    expect(backup.savedAt).toBeGreaterThanOrEqual(before)
  })

  it('folds the signed-in email into settings when the remote has none', () => {
    const remote = dbWith({ routines: [routine('r-remote', 'Remote')] })
    const adopted = adoptRemote(remote, emptyDb(), 'me@x.com')
    expect(adopted.settings.email).toBe('me@x.com')
  })

  it('keeps the remote email when it already has one', () => {
    const remote = dbWith({ settings: { ...emptyDb().settings, email: 'cloud@x.com' } })
    const adopted = adoptRemote(remote, emptyDb(), 'device@x.com')
    expect(adopted.settings.email).toBe('cloud@x.com')
  })

  it('replaces local verbatim otherwise — no local rows unioned in', () => {
    const local = dbWith({
      routines: [routine('r-local', 'Local')],
      exercises: [ex('local-ex', 'Local Ex')],
    })
    const remote = dbWith({ routines: [routine('r-remote', 'Remote')] })
    const adopted = adoptRemote(remote, local, null)
    expect(adopted.routines).toEqual(remote.routines)
    expect(adopted.exercises).toEqual(remote.exercises) // local exercise NOT present
  })

  it('re-adopting an already-adopted Db is a no-op under diffDb', () => {
    const remote = dbWith({ routines: [routine('r-remote', 'Remote')] })
    const first = adoptRemote(remote, emptyDb(), 'me@x.com')
    const again = adoptRemote(first, emptyDb(), 'me@x.com')
    expect(diffDb(first, again, OWNER)).toEqual([])
  })
})

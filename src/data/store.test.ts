import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Db, DEFAULT_APP_SETTINGS, emptyDb } from './types'
import type { Backend } from './backend/backend'

/**
 * The store is a module-level singleton, so these tests use vi.resetModules
 * + dynamic import to exercise the load-from-localStorage path with a fresh
 * module instance per test.
 */

function memoryStorage() {
  const mem = new Map<string, string>()
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    _mem: mem,
  }
}

describe('store', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    vi.resetModules()
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts empty with default settings', async () => {
    const { getDb } = await import('./store')
    const db = getDb()
    expect(db.exercises).toEqual([])
    expect(db.sessions).toEqual([])
    expect(db.settings).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('update persists to lift.db.v1 and notifies subscribers', async () => {
    const { getDb, update, subscribe, DB_KEY } = await import('./store')
    expect(DB_KEY).toBe('lift.db.v1')
    let calls = 0
    const unsub = subscribe(() => calls++)
    update((db) => ({ ...db, settings: { ...db.settings, defaultRestSec: 120 } }))
    expect(calls).toBe(1)
    expect(getDb().settings.defaultRestSec).toBe(120)
    expect(JSON.parse(storage.getItem('lift.db.v1')!).settings.defaultRestSec).toBe(120)
    unsub()
    update((db) => ({ ...db, settings: { ...db.settings, defaultRestSec: 60 } }))
    expect(calls).toBe(1) // unsubscribed
  })

  it('returning the same reference from update is a no-op (no persist, no notify)', async () => {
    const { update, subscribe } = await import('./store')
    let calls = 0
    subscribe(() => calls++)
    update((db) => db)
    expect(calls).toBe(0)
    expect(storage.getItem('lift.db.v1')).toBeNull()
  })

  it('loads persisted state on module init and self-heals missing fields', async () => {
    storage.setItem(
      'lift.db.v1',
      JSON.stringify({ settings: { defaultRestSec: 60 }, routines: [] }),
    )
    const { getDb } = await import('./store')
    const db = getDb()
    expect(db.settings.defaultRestSec).toBe(60)
    expect(db.settings.weightIncrementKg).toBe(2.5) // healed from defaults
    expect(db.setLogs).toEqual([]) // missing array healed
  })

  it('survives corrupt storage by starting empty', async () => {
    storage.setItem('lift.db.v1', '{not json')
    const { getDb } = await import('./store')
    expect(getDb().sessions).toEqual([])
  })

  it('resetDb wipes state and notifies', async () => {
    const { getDb, update, resetDb } = await import('./store')
    update((db) => ({ ...db, settings: { ...db.settings, email: 'x@y.z' } }))
    let notified = false
    const unsub = (await import('./store')).subscribe(() => (notified = true))
    resetDb()
    expect(getDb().settings.email).toBeNull()
    expect(notified).toBe(true)
    unsub()
  })
})

/** Minimal in-memory instant backend double for the sign-in state machine. */
function fakeBackend(initial: Db): Backend & { signOutCalls: number } {
  let snap = initial
  return {
    signOutCalls: 0,
    getDb: () => snap,
    update(fn) {
      snap = fn(snap)
    },
    reset() {
      snap = emptyDb()
    },
    set(next) {
      snap = next
    },
    signOut() {
      this.signOutCalls++
    },
  }
}

function routine(id: string, name: string): Db['routines'][number] {
  return { id, name, defaultRestSec: 90, cycleOrder: null, warmup: false, archived: false }
}

describe('store — sign-in conflict state machine', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    vi.resetModules()
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('meaningful remote + meaningful local pauses on a conflict (no flip)', async () => {
    const store = await import('./store')
    // Seed local with meaningful data.
    store.update((db) => ({ ...db, routines: [routine('r-local', 'Local')] }))
    const inst = fakeBackend(emptyDb())
    store.__enableSyncForTest(inst, { ...emptyDb(), routines: [routine('r-remote', 'Remote')] }, 'me@x.com')

    expect(store.getSyncConflict()).toEqual({ counts: { routines: 1, workouts: 0 } })
    expect(store.usingInstant()).toBe(false) // still on local
    expect(inst.signOutCalls).toBe(0)
  })

  it('cancel leaves local byte-identical and signed out, ends the session', async () => {
    const store = await import('./store')
    store.update((db) => ({
      ...db,
      routines: [routine('r-local', 'Local')],
      settings: { ...db.settings, theme: 'ember' },
    }))
    const before = JSON.stringify(store.getDb())
    const inst = fakeBackend(emptyDb())
    store.__enableSyncForTest(inst, { ...emptyDb(), routines: [routine('r-remote', 'Remote')] }, 'me@x.com')
    expect(store.getSyncConflict()).not.toBeNull()

    store.resolveSyncConflictCancel()
    expect(store.getSyncConflict()).toBeNull()
    expect(store.usingInstant()).toBe(false)
    expect(inst.signOutCalls).toBe(1) // instant session ended
    expect(JSON.stringify(store.getDb())).toBe(before) // local untouched
    expect(store.getDb().settings.email).toBeNull()
  })

  it('adopt replaces local with remote and flips to instant, backing local up', async () => {
    const store = await import('./store')
    store.update((db) => ({ ...db, routines: [routine('r-local', 'Local')] }))
    const inst = fakeBackend(emptyDb())
    const remote: Db = { ...emptyDb(), routines: [routine('r-remote', 'Remote')] }
    store.__enableSyncForTest(inst, remote, 'me@x.com')

    store.resolveSyncConflictAdopt()
    expect(store.getSyncConflict()).toBeNull()
    expect(store.usingInstant()).toBe(true)
    // The active backend now holds the remote routine (email folded), not local's.
    expect(store.getDb().routines.map((r) => r.id)).toEqual(['r-remote'])
    expect(store.getDb().settings.email).toBe('me@x.com')
    // A backup of the pre-adoption local was written.
    expect(storage.getItem('lift.db.backup')).toBeTruthy()
  })

  it('a fresh remote uploads local (case 1, mergeDb) and flips', async () => {
    const store = await import('./store')
    store.update((db) => ({ ...db, routines: [routine('r-local', 'Local')] }))
    const inst = fakeBackend(emptyDb())
    store.__enableSyncForTest(inst, emptyDb(), 'me@x.com') // remote fresh

    expect(store.getSyncConflict()).toBeNull()
    expect(store.usingInstant()).toBe(true)
    expect(store.getDb().routines.map((r) => r.id)).toEqual(['r-local']) // uploaded
    expect(store.getDb().settings.email).toBe('me@x.com')
  })
})

describe('store — sync status machine', () => {
  let storage: ReturnType<typeof memoryStorage>
  // Captures the connect-timeout callback so tests can fire it deterministically.
  let fireTimeout: (() => void) | null

  beforeEach(() => {
    vi.resetModules()
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    fireTimeout = null
  })
  afterEach(() => vi.unstubAllGlobals())

  async function loadStoreWithFakeTimer() {
    const store = await import('./store')
    store.__setSyncTimers(
      (fn) => {
        fireTimeout = fn
        return 1
      },
      () => {
        fireTimeout = null
      },
    )
    return store
  }

  it('resting state is unavailable in the test env (no backend configured)', async () => {
    const store = await import('./store')
    expect(store.getSyncStatus().state).toBe('unavailable')
  })

  it('off→connecting→on: connecting exposes the account, on exposes counts + upload diagnostic', async () => {
    const store = await loadStoreWithFakeTimer()
    // Seed meaningful local so the empty-but-healthy remote triggers upload-local.
    store.update((db) => ({ ...db, routines: [routine('r-local', 'Local')] }))

    store.__beginConnectingForTest('me@x.com')
    let status = store.getSyncStatus()
    expect(status.state).toBe('connecting')
    expect(status.account).toBe('me@x.com')

    const inst = fakeBackend(emptyDb())
    store.__deliverRemoteForTest(inst, emptyDb(), 'me@x.com') // empty-but-healthy remote

    status = store.getSyncStatus()
    expect(status.state).toBe('on')
    expect(status.account).toBe('me@x.com')
    expect(status.remoteCounts).toEqual({ routines: 1, workouts: 0 })
    // Diagnostic honesty: the account was empty (not permission-hidden) → say so.
    expect(status.detail).toContain('had no data')
  })

  it('on: workouts count reflects COMPLETED sessions only', async () => {
    const store = await loadStoreWithFakeTimer()
    const inst = fakeBackend(emptyDb())
    const remote: Db = {
      ...emptyDb(),
      routines: [routine('r1', 'A')],
      sessions: [
        { id: 's1', routineId: 'r1', routineName: 'A', status: 'completed', startedAt: 1, finishedAt: 2 },
        { id: 's2', routineId: 'r1', routineName: 'A', status: 'active', startedAt: 3, finishedAt: null },
      ],
    }
    store.__beginConnectingForTest('me@x.com')
    store.__deliverRemoteForTest(inst, remote, 'me@x.com') // remote meaningful, local fresh → adopt
    const status = store.getSyncStatus()
    expect(status.state).toBe('on')
    expect(status.remoteCounts).toEqual({ routines: 1, workouts: 1 })
  })

  it('connecting→error when the first snapshot times out', async () => {
    const store = await loadStoreWithFakeTimer()
    store.__beginConnectingForTest('me@x.com')
    expect(store.getSyncStatus().state).toBe('connecting')

    expect(fireTimeout).toBeTypeOf('function')
    fireTimeout!() // 12s elapsed with no snapshot

    const status = store.getSyncStatus()
    expect(status.state).toBe('error')
    expect(status.account).toBe('me@x.com')
    expect(status.detail).toContain('timed out')
  })

  it('error→connecting on retry (live but silent subscription re-armed)', async () => {
    const store = await loadStoreWithFakeTimer()
    const inst = fakeBackend(emptyDb())
    store.__beginConnectingForTest('me@x.com', inst)
    fireTimeout!()
    expect(store.getSyncStatus().state).toBe('error')

    store.retrySync()
    expect(store.getSyncStatus().state).toBe('connecting')
    expect(store.getSyncStatus().account).toBe('me@x.com')
  })

  it('a reported subscription error surfaces as the error state', async () => {
    const store = await loadStoreWithFakeTimer()
    store.__beginConnectingForTest('me@x.com')
    store.__reportSyncErrorForTest({ message: 'permission denied' }, 'query')
    const status = store.getSyncStatus()
    expect(status.state).toBe('error')
    expect(status.detail).toContain('permission denied')
  })

  it('getSyncStatus returns a stable reference between notifications', async () => {
    const store = await import('./store')
    const a = store.getSyncStatus()
    const b = store.getSyncStatus()
    expect(a).toBe(b) // memoized — required by useSyncExternalStore
    store.update((db) => ({ ...db, settings: { ...db.settings, defaultRestSec: 120 } }))
    expect(store.getSyncStatus()).not.toBe(a) // invalidated on change
  })
})

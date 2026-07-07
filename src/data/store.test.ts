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

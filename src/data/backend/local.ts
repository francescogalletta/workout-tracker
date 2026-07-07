import { type Db, emptyDb } from '../types'
import type { Backend } from './backend'

/**
 * localStorage-backed backend (`lift.db.v1`) — the app's original store, now
 * behind the `Backend` seam. Used when `VITE_INSTANT_APP_ID` is absent and in
 * every vitest run (fully offline, no network, no InstantDB imports). Writes
 * are synchronous + optimistic (SPEC §8.1); subscribers notified immediately.
 */

export const DB_KEY = 'lift.db.v1'

export function createLocalBackend(notify: () => void): Backend {
  let db: Db = load()

  function load(): Db {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DB_KEY) : null
      if (!raw) return emptyDb()
      const parsed = JSON.parse(raw) as Partial<Db>
      const base = emptyDb()
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
      }
    } catch {
      return emptyDb()
    }
  }

  function persist(): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(DB_KEY, JSON.stringify(db))
    } catch {
      // storage may be full/unavailable; keep the in-memory copy authoritative
    }
  }

  function update(fn: (db: Db) => Db): void {
    const next = fn(db)
    if (next === db) return
    db = next
    persist()
    notify()
  }

  return {
    getDb: () => db,
    update,
    reset() {
      db = emptyDb()
      persist()
      notify()
    },
    set(next) {
      db = next
      persist()
      notify()
    },
    signOut() {
      update((d) => ({ ...d, settings: { ...d.settings, email: null } }))
    },
  }
}

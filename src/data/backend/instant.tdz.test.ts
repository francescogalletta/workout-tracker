import { describe, expect, it, vi } from 'vitest'
import type { Backend } from './backend'
import type { Db } from '../types'

/**
 * Regression for the production-only crash the owner saw on his phone:
 *
 *   "Sync couldn't read your account (Cannot access 'd' before initialization)"
 *
 * A warm InstantDB client delivers the FIRST query snapshot SYNCHRONOUSLY, from
 * inside the `subscribeQuery(...)` call — which itself runs synchronously inside
 * `const inst = createInstantBackend(...)` (store.enableSync). If the first-data
 * callback reads that not-yet-initialized `const inst`, it is a temporal-dead-zone
 * ReferenceError (minified: `const d`). It never reproduced in the suite because
 * the store's test seams inject an already-built backend and never run the real
 * `createInstantBackend`.
 *
 * We mock instantClient so `subscribeQuery` fires synchronously (the warm-cache
 * condition), then mirror enableSync's exact wiring and assert no TDZ.
 */
vi.mock('./instantClient', () => ({
  idb: {
    _core: {
      // Fire the first snapshot SYNCHRONOUSLY, exactly like a warm cache does.
      subscribeQuery: (_q: unknown, cb: (resp: { data?: unknown; error?: unknown }) => void) => {
        cb({ data: {} })
      },
    },
    tx: {},
    transact: () => Promise.resolve({}),
    auth: { signOut: () => {} },
  },
}))

describe('createInstantBackend — synchronous first snapshot (prod TDZ repro)', () => {
  it('delivers the backend to onFirstData without a dead-zone read of the caller const', async () => {
    const { createInstantBackend } = await import('./instant')
    const seen: Array<Backend | undefined> = []

    expect(() => {
      // Mirrors store.enableSync: `const inst = createInstantBackend(notify, remote => onFirstRemote(inst, ...))`.
      const inst: Backend = createInstantBackend(
        () => {},
        (_remote: Db, backend?: Backend) => {
          // Pre-fix: onFirstData is called with only the snapshot, so `backend` is
          // undefined and this reads the still-initializing `inst` → ReferenceError
          // "Cannot access 'inst' before initialization". Post-fix: `backend` is the
          // freshly-built api and `inst` is never touched here.
          seen.push(backend ?? inst)
        },
        () => {},
      )
      seen.push(inst)
    }).not.toThrow()

    // The backend handed to the callback must be the same instance returned.
    expect(seen[0]).toBe(seen[1])
  })
})

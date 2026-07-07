import { type Db, emptyDb } from '../types'
import type { Backend } from './backend'
import { getUserId } from './authState'
import { diffDb } from './diff'
import { slugToUuid } from './ids'
import { type InstantData, rowsToDb } from './mapper'
import { idb } from './instantClient'

/**
 * InstantDB-backed backend. Reads come from one everything-query subscription
 * mapped into the `Db` snapshot; writes diff the snapshot against the caller's
 * transform and emit a single `db.transact`. Local-first: reads/writes hit
 * InstantDB's own local store, so this stays offline-capable and never blocks
 * rendering (SPEC §8.1 — no loading gates here; the only gate is the cold-start
 * auth check, handled in `AppInstant`).
 */

const QUERY = {
  exercises: {},
  routines: {},
  routineItems: {},
  sessions: {},
  setLogs: {},
  targets: {},
  settings: {},
}

/**
 * @param onFirstData Fired once, with the first remote snapshot AND this backend
 *   instance, when the everything-query first resolves. `store.enableSync` uses
 *   it to run the sign-in merge-up against the freshly-loaded cloud data (the
 *   merge must wait for the real remote, not the empty cold-start snapshot).
 *
 *   The backend is passed as the SECOND argument on purpose: a warm InstantDB
 *   cache delivers the first snapshot SYNCHRONOUSLY, from inside `subscribeQuery`
 *   — which runs while the caller's `const inst = createInstantBackend(...)` is
 *   still initializing. If the callback reached back for that `const` it would be
 *   a temporal-dead-zone ReferenceError ("Cannot access 'inst'/'d' before
 *   initialization" — the production crash this indirection fixes). Handing the
 *   already-built `api` object in makes that read structurally impossible.
 * @param onError Fired when the subscription reports a query error or a
 *   background `transact` rejects. `store.enableSync` maps this to the 'error'
 *   sync status so the failure is visible instead of silent.
 */
export function createInstantBackend(
  notify: () => void,
  onFirstData?: (remote: Db, backend: Backend) => void,
  onError?: (err: unknown, kind: 'query' | 'transact') => void,
): Backend {
  // Optimistic snapshot: seeded from query results, advanced eagerly on write.
  let snap: Db = emptyDb()
  let firstDataDelivered = false

  function update(fn: (db: Db) => Db): void {
    const next = fn(snap)
    if (next === snap) return
    const owner = getUserId() ?? ''
    const ops = diffDb(snap, next, owner)
    // Optimistic: reflect immediately, transact in the background.
    snap = next
    notify()
    if (ops.length === 0) return
    const tx = idb.tx as unknown as Record<
      string,
      Record<string, { update: (f: Record<string, unknown>) => unknown; delete: () => unknown }>
    >
    const chunks = ops.map((o) => {
      const ref = tx[o.entity][slugToUuid(o.id)]
      return o.op === 'delete' ? ref.delete() : ref.update(o.fields ?? {})
    })
    void idb.transact(chunks as never).catch((err: unknown) => {
      console.warn('[instant] transact failed', err)
      onError?.(err, 'transact')
    })
  }

  // Build the backend object BEFORE subscribing, so a synchronous first snapshot
  // has a fully-initialized instance to hand to `onFirstData` (see the doc above).
  const api: Backend = {
    getDb: () => snap,
    update,
    reset() {
      // Wiping cloud data is not a supported flow; sign-out (below) is.
      console.warn('[instant] reset() is a no-op on the InstantDB backend')
    },
    set(next) {
      // Route a full replace through the diff so it becomes one transaction.
      update(() => next)
    },
    signOut() {
      update((d) => ({ ...d, settings: { ...d.settings, email: null } }))
      void idb.auth.signOut()
    },
  }

  // subscribeQuery lives on the core db; tx/transact are on the React db. This may
  // invoke the callback synchronously (warm cache) — `api` above is already ready.
  idb._core.subscribeQuery(QUERY, (resp) => {
    const r = resp as { data?: unknown; error?: unknown }
    if (r.error) {
      // A query error post-sign-in is meaningful (this backend only exists after
      // sign-in): surface it as an observable sync error, keep rendering local.
      console.warn('[instant] query error', r.error)
      onError?.(r.error, 'query')
      return
    }
    if (!r.data) return
    snap = rowsToDb(r.data as InstantData)
    notify()
    if (!firstDataDelivered) {
      firstDataDelivered = true
      onFirstData?.(snap, api)
    }
  })

  return api
}

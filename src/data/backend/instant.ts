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
 * @param onFirstData Fired once, with the first remote snapshot, when the
 *   everything-query first resolves. `store.enableSync` uses it to run the
 *   sign-in merge-up against the freshly-loaded cloud data (the merge must wait
 *   for the real remote, not the empty cold-start snapshot).
 */
export function createInstantBackend(
  notify: () => void,
  onFirstData?: (remote: Db) => void,
): Backend {
  // Optimistic snapshot: seeded from query results, advanced eagerly on write.
  let snap: Db = emptyDb()
  let firstDataDelivered = false

  // subscribeQuery lives on the core db; tx/transact are on the React db.
  idb._core.subscribeQuery(QUERY, (resp) => {
    const r = resp as { data?: unknown; error?: unknown }
    if (r.error) {
      // Permission errors before sign-in are expected; log others, keep rendering.
      console.warn('[instant] query error', r.error)
      return
    }
    if (!r.data) return
    snap = rowsToDb(r.data as InstantData)
    notify()
    if (!firstDataDelivered) {
      firstDataDelivered = true
      onFirstData?.(snap)
    }
  })

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
    })
  }

  return {
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
}

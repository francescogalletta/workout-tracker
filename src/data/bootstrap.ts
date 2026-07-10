import { getDb, runWhenSettled } from './store'
import { importRecompPlan } from './plan'
import { cleanupSeededCatalog, migrateCatalog, seedDemoData } from './seed'

const DEFAULT_SEARCH = typeof window !== 'undefined' ? window.location.search : ''

/**
 * Boot-time store maintenance. New users are NOT seeded a catalog any more (they
 * build their library via `createExercise`); instead every boot:
 *   1. `cleanupSeededCatalog` deletes the abandoned pre-seeded exercises that
 *      nothing references (idempotent — see its doc), and
 *   2. `migrateCatalog` backfills the legacy `type` field on surviving rows.
 * Then the optional `?demo` dataset (when there is no user data yet) and the
 * `?plan` training-plan import run, in that order, so `?demo&?plan` keeps
 * demo-first ordering.
 *
 * ALL of this runs inside ONE `runWhenSettled` callback so that on a signed-in
 * device it lands on the ACCOUNT (instant backend) rather than local: the
 * cleanup's row removals only propagate to InstantDB as real deletes once the
 * instant backend is live (the sign-in reconciliation lets remote win on every
 * id collision, so an immediate local delete would just be re-adopted from the
 * cloud). With no InstantDB configured, `runWhenSettled` fires synchronously at
 * boot, so pure-local users are cleaned immediately.
 */
export function runSeed(search: string = DEFAULT_SEARCH): void {
  const wantDemo = /[?&]demo(=|&|$)/.test(search)
  const wantPlan = /[?&]plan(=|&|$)/.test(search)
  runWhenSettled(() => {
    cleanupSeededCatalog()
    migrateCatalog()
    if (wantDemo) {
      const db = getDb()
      if (db.routines.length === 0 && db.sessions.length === 0) seedDemoData(Date.now())
    }
    // `?plan` imports the built-in split training plan. It is idempotent
    // (deterministic slug ids) and coexistence-safe, so unlike `?demo` it needs
    // no empty-store gate. It ensures exactly the exercises it uses exist.
    if (wantPlan) importRecompPlan(Date.now())
  })
}

/**
 * Called once from main.tsx before first render. The app always boots on the
 * local backend; the maintenance + `?demo`/`?plan` imports are deferred until
 * the sync session settles (see `runSeed`) so a signed-in device's writes reach
 * the account instead of local. When a user later signs in, `store.enableSync`
 * merges any local data up to the cloud.
 */
export function bootstrap(search: string = DEFAULT_SEARCH): void {
  runSeed(search)
}

import { getDb, runWhenSettled } from './store'
import { importRecompPlan } from './plan'
import { ensureCatalog, migrateCatalog, seedDemoData } from './seed'

const DEFAULT_SEARCH = typeof window !== 'undefined' ? window.location.search : ''

/**
 * Seed the local store: the exercise catalog into an empty store (idempotent),
 * plus the full `?demo` dataset when the flag is present and there is no user
 * data yet, plus the built-in `?plan` training-plan import when that flag is
 * present. The catalog rows use deterministic slug ids, so a redundant re-seed
 * is a harmless upsert rather than a duplicate. `?demo` and `?plan` are
 * composable — with both, the demo data seeds first and the plan appends to its
 * rotation.
 *
 * The catalog seeds IMMEDIATELY (both backends carry the same slug catalog; the
 * local UI needs exercises before any sign-in). The `?demo`/`?plan` writes are
 * DEFERRED through `runWhenSettled` so that on a signed-in device they land on
 * the ACCOUNT (instant backend) instead of local, where the sign-in conflict
 * flow would discard them. With no InstantDB configured they still fire
 * immediately at boot. Both flags share ONE deferred callback so `?demo&?plan`
 * keeps demo-first ordering.
 */
export function runSeed(search: string = DEFAULT_SEARCH): void {
  ensureCatalog()
  migrateCatalog()
  const wantDemo = /[?&]demo(=|&|$)/.test(search)
  const wantPlan = /[?&]plan(=|&|$)/.test(search)
  if (!wantDemo && !wantPlan) return
  runWhenSettled(() => {
    if (wantDemo) {
      const db = getDb()
      if (db.routines.length === 0 && db.sessions.length === 0) seedDemoData(Date.now())
    }
    // `?plan` imports the built-in split training plan. It is idempotent
    // (deterministic slug ids) and coexistence-safe, so unlike `?demo` it needs
    // no empty-store gate.
    if (wantPlan) importRecompPlan(Date.now())
  })
}

/**
 * Called once from main.tsx before first render. The app always boots on the
 * local backend, so the catalog seeds immediately. The `?demo`/`?plan` imports
 * are deferred until the sync session settles (see `runSeed`) so a signed-in
 * device's import reaches the account instead of local. When a user later signs
 * in, `store.enableSync` merges the seeded local data up to the cloud (the
 * deterministic-slug catalog collides with the account's copy and dedupes).
 */
export function bootstrap(search: string = DEFAULT_SEARCH): void {
  runSeed(search)
}

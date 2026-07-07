import { getDb } from './store'
import { importRecompPlan } from './plan'
import { ensureCatalog, seedDemoData } from './seed'

const DEFAULT_SEARCH = typeof window !== 'undefined' ? window.location.search : ''

/**
 * Seed the local store: the exercise catalog into an empty store (idempotent),
 * plus the full `?demo` dataset when the flag is present and there is no user
 * data yet, plus the built-in `?plan` training-plan import when that flag is
 * present. The
 * catalog rows use deterministic slug ids, so a redundant re-seed is a harmless
 * upsert rather than a duplicate. `?demo` and `?plan` are composable — with
 * both, the demo data seeds first and the plan appends to its rotation.
 */
export function runSeed(search: string = DEFAULT_SEARCH): void {
  ensureCatalog()
  if (/[?&]demo(=|&|$)/.test(search)) {
    const db = getDb()
    if (db.routines.length === 0 && db.sessions.length === 0) seedDemoData(Date.now())
  }
  // `?plan` imports the built-in split training plan. It is idempotent (deterministic
  // slug ids) and coexistence-safe, so unlike `?demo` it needs no empty-store gate.
  if (/[?&]plan(=|&|$)/.test(search)) {
    importRecompPlan(Date.now())
  }
}

/**
 * Called once from main.tsx before first render. The app always boots on the
 * local backend, so this always seeds. When a user later signs in,
 * `store.enableSync` merges this seeded local data up to the cloud (the
 * deterministic-slug catalog collides with the account's copy and dedupes).
 */
export function bootstrap(search: string = DEFAULT_SEARCH): void {
  runSeed(search)
}

import { type Db } from '../types'

/**
 * Sign-in merge-up. When a signed-out user (all data on the local backend)
 * signs in, we union their local data into whatever the cloud already holds and
 * upload the difference. This module is the pure, unit-tested core of that flow;
 * the async wiring (wait for the first remote snapshot, then `diff`/`transact`
 * the local-only rows) lives in `store.enableSync` + the instant backend.
 *
 * `mergeDb(remote, local)` semantics:
 *   - Array entities: union by `id`. On an id collision REMOTE WINS (the cloud
 *     is the shared source of truth); local-only rows are appended. Because seed
 *     and demo rows use deterministic slug ids, the catalog present on both
 *     sides collides by id and dedupes to a single (remote) copy — no dup rows.
 *   - Settings: the remote row wins if it exists, else the local row. A synced
 *     account always has its `email` mirrored into settings, so a non-null
 *     remote `email` is the marker for "remote settings row exists". A brand-new
 *     account (empty remote, no email) keeps the offline user's local prefs.
 *
 * The result is deterministic (remote order first, then appended local-only
 * rows) and idempotent under `diffDb`: once the merged Db has been uploaded so
 * remote === merged, `mergeDb(merged, local)` re-produces merged, so a second
 * merge yields no further transaction ops.
 */

function unionById<T extends { id: string }>(remote: T[], local: T[]): T[] {
  const remoteIds = new Set(remote.map((r) => r.id))
  const localOnly = local.filter((r) => !remoteIds.has(r.id))
  return [...remote, ...localOnly]
}

export function mergeDb(remote: Db, local: Db): Db {
  return {
    exercises: unionById(remote.exercises, local.exercises),
    routines: unionById(remote.routines, local.routines),
    routineItems: unionById(remote.routineItems, local.routineItems),
    sessions: unionById(remote.sessions, local.sessions),
    setLogs: unionById(remote.setLogs, local.setLogs),
    targets: unionById(remote.targets, local.targets),
    settings: remote.settings.email != null ? remote.settings : local.settings,
  }
}

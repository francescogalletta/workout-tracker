import { type Db } from '../types'

/**
 * Sign-in adoption logic. When a signed-out user (all data on the local backend)
 * signs in, the first remote snapshot has to be reconciled with local. The owner
 * decision is REPLACE-after-warning, not union: when an account already holds
 * meaningful data, the remote copy wins and the device's data is replaced (after
 * an explicit confirmation). This module is the pure, unit-tested core of that
 * decision; the async wiring + the modal live in `store.ts` and `App.tsx`.
 *
 * "Meaningful data" = any routines, sessions, setLogs, or targets rows. The
 * exercises catalog and settings row do NOT count (both sides seed the same
 * catalog at boot, and settings is device-local preferences), so a brand-new
 * account with only the seeded catalog reads as fresh.
 *
 * classifySync(remote, local):
 *   - 'upload-local'  remote fresh (whatever local is)   → mergeDb + upload (case 1)
 *   - 'adopt-remote'  remote meaningful, local fresh       → adopt silently (case 2)
 *   - 'conflict'      remote meaningful AND local meaningful → pause, warn (case 3)
 */

/** Any routines/sessions/setLogs/targets rows. Catalog + settings do NOT count. */
export function isMeaningful(db: Db): boolean {
  return (
    db.routines.length > 0 ||
    db.sessions.length > 0 ||
    db.setLogs.length > 0 ||
    db.targets.length > 0
  )
}

export type SyncClass = 'upload-local' | 'adopt-remote' | 'conflict'

export function classifySync(remote: Db, local: Db): SyncClass {
  if (!isMeaningful(remote)) return 'upload-local'
  return isMeaningful(local) ? 'conflict' : 'adopt-remote'
}

/** Counts surfaced in the conflict modal, read from the REMOTE snapshot. */
export interface RemoteCounts {
  routines: number
  workouts: number
}

export function remoteCounts(remote: Db): RemoteCounts {
  return { routines: remote.routines.length, workouts: remote.sessions.length }
}

/** Single-slot backup of the pre-adoption local Db, overwritten each adoption. */
export const DB_BACKUP_KEY = 'lift.db.backup'

export interface DbBackup {
  savedAt: number
  db: Db
}

/**
 * Persist a one-off backup of the current local Db before it is overwritten by
 * an adopt-remote. Single slot (overwrites), tolerant of storage being
 * unavailable (mirrors the local backend's persist guard).
 */
export function backupLocalDb(local: Db, now: number = Date.now()): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const payload: DbBackup = { savedAt: now, db: local }
      localStorage.setItem(DB_BACKUP_KEY, JSON.stringify(payload))
    }
  } catch {
    // storage may be full/unavailable; the adoption still proceeds.
  }
}

/**
 * Adopt the remote snapshot, replacing local. Backs the current local Db up
 * first (`lift.db.backup`), then returns the remote Db verbatim with the
 * signed-in email folded into settings (so Settings shows the synced state even
 * before the remote settings row mirrors it). Local rows are NOT unioned in —
 * remote OVERRIDES. Idempotent: re-adopting an already-adopted Db (email
 * already present) returns it unchanged, so `diffDb` sees nothing to upload.
 */
export function adoptRemote(remote: Db, local: Db, email: string | null): Db {
  backupLocalDb(local)
  if (email && remote.settings.email == null) {
    return { ...remote, settings: { ...remote.settings, email } }
  }
  return remote
}

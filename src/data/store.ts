import { useSyncExternalStore } from 'react'
import { type Db, emptyDb } from './types'
import type { Backend } from './backend/backend'
import { createLocalBackend } from './backend/local'
import { mergeDb } from './backend/merge'
import { adoptRemote, classifySync, remoteCounts, type RemoteCounts } from './backend/sync'
import { setUserId } from './backend/authState'

/**
 * Store facade. Delegates to one of two backends behind a single interface so
 * the entire app (`getDb`/`update`/`useDb` + the mutation helpers) is
 * backend-agnostic:
 *   - `local`   — localStorage store. The app ALWAYS boots on this backend, so
 *                 it is fully functional offline with no account (SPEC: sign-in
 *                 is opt-in sync, never a gate). It is also the only backend in
 *                 every vitest run.
 *   - `instant` — InstantDB-backed. The app switches to it at runtime when a
 *                 user signs in (or already has a live session), via
 *                 `enableSync`. Loaded through a dynamic import so its SDK is
 *                 never evaluated in the node test env.
 *
 * Switching directions:
 *   - local → instant (`enableSync`): a small state machine keyed on the first
 *     remote snapshot (`classifySync`, in backend/sync.ts):
 *       · remote fresh                  → mergeDb(remote, local) + upload, flip.
 *       · remote meaningful, local fresh → adopt remote silently, flip.
 *       · remote AND local meaningful    → PAUSE. Stay on local, expose a
 *         pending-conflict (`getSyncConflict`) that App renders as a modal;
 *         resolve with `resolveSyncConflictAdopt` (replace local with remote,
 *         after backing local up) or `resolveSyncConflictCancel` (sign the
 *         InstantDB session out, leave local EXACTLY as it was).
 *     The app stays on local (usable, no blank screen) until a flip completes.
 *   - instant → local (`signOut`): snapshot the current Db into localStorage,
 *     end the InstantDB session, switch to local. No data is lost either way.
 */

export const DB_KEY = 'lift.db.v1'

/**
 * True in a real browser build with an app id configured (never in tests).
 * Gates whether the InstantDB auth machinery is mounted at all and whether
 * Settings offers the sync affordance. Distinct from whether the instant
 * backend is *currently active* — the app boots on local regardless.
 */
export const hasInstant =
  Boolean(import.meta.env.VITE_INSTANT_APP_ID) && import.meta.env.MODE !== 'test'

const listeners = new Set<() => void>()
function notify(): void {
  for (const cb of listeners) cb()
}

// The app always boots on local. `backend` is repointed to the instant backend
// once a user signs in; `localBackend` is retained so sign-out can snapshot
// back into it.
const localBackend: Backend = createLocalBackend(notify)
let backend: Backend = localBackend
let mode: 'local' | 'instant' = 'local'
let pendingInstant = false

// Pending-conflict state (case 3). Non-null while the modal is up; the app stays
// on the local backend and the scratch fields hold what the two resolutions need.
let pendingConflict: { counts: RemoteCounts } | null = null
let conflictInst: Backend | null = null
let conflictRemote: Db | null = null
let conflictLocal: Db | null = null
let conflictEmail: string | null = null

function clearConflictScratch(): void {
  conflictInst = null
  conflictRemote = null
  conflictLocal = null
  conflictEmail = null
}

/** True once the instant backend is the active one (post sign-in). */
export function usingInstant(): boolean {
  return mode === 'instant'
}

/**
 * The pending sign-in conflict, or null. Non-null means an account with
 * meaningful data was found while the device also holds meaningful data, so we
 * paused before replacing local. App renders this as a blocking modal.
 */
export function getSyncConflict(): { counts: RemoteCounts } | null {
  return pendingConflict
}

/** Flip to the instant backend with `snapshot` as the first uploaded state. */
function activate(inst: Backend, snapshot: Db): void {
  // Route the whole snapshot through the diff → one transaction with only the
  // rows/settings the cloud was missing.
  inst.set(snapshot)
  backend = inst
  mode = 'instant'
  pendingInstant = false
  pendingConflict = null
  clearConflictScratch()
  notify()
}

/**
 * Decide what to do with the first remote snapshot. Pure classification lives in
 * `classifySync`; this applies the effect. Referenced by `enableSync` and the
 * test seam below.
 */
function onFirstRemote(inst: Backend, remote: Db, localSnapshot: Db, email: string | null): void {
  const cls = classifySync(remote, localSnapshot)
  if (cls === 'conflict') {
    // PAUSE: stay on local, surface the modal. Nothing is written yet.
    conflictInst = inst
    conflictRemote = remote
    conflictLocal = localSnapshot
    conflictEmail = email
    pendingConflict = { counts: remoteCounts(remote) }
    notify()
    return
  }
  if (cls === 'adopt-remote') {
    // Remote meaningful, local fresh → adopt silently (nothing to lose).
    activate(inst, adoptRemote(remote, localSnapshot, email))
    return
  }
  // upload-local (case 1): union local up, remote wins on id conflicts.
  let merged = mergeDb(remote, localSnapshot)
  // Reflect the signed-in identity so Settings shows the synced state even for a
  // brand-new account (empty remote, no mirrored email yet).
  if (email && merged.settings.email == null) {
    merged = { ...merged, settings: { ...merged.settings, email } }
  }
  activate(inst, merged)
}

/**
 * Opt into cloud sync for a signed-in user. Idempotent and safe to call on
 * every auth render: no-ops unless an app id is configured and we are still on
 * the local backend (and no flip/conflict is already in flight). Snapshots the
 * local Db, loads the instant backend, and on its first remote snapshot runs the
 * classify → (upload | adopt | conflict) state machine.
 */
export function enableSync(userId: string, email: string | null): void {
  if (!hasInstant || mode === 'instant' || pendingInstant) return
  pendingInstant = true
  const localSnapshot = backend.getDb()
  setUserId(userId)
  void import('./backend/instant').then(({ createInstantBackend }) => {
    const inst = createInstantBackend(notify, (remote) =>
      onFirstRemote(inst, remote, localSnapshot, email),
    )
  })
}

/**
 * Resolve a pending conflict by adopting the remote account: back the current
 * local Db up, replace local with remote (email folded in), and flip to instant.
 * No local rows are uploaded — remote overrides.
 */
export function resolveSyncConflictAdopt(): void {
  if (!pendingConflict || !conflictInst || !conflictRemote) return
  activate(conflictInst, adoptRemote(conflictRemote, conflictLocal ?? emptyDb(), conflictEmail))
}

/**
 * Resolve a pending conflict by cancelling: end the InstantDB session and stay
 * on local. Local data is left EXACTLY as it was (we never flipped backends, so
 * nothing was ever written to it) — usable, signed out.
 */
export function resolveSyncConflictCancel(): void {
  if (!pendingConflict) return
  // Ends the InstantDB auth session (and clears the remote email marker). Runs
  // against the instant backend's own snapshot — never touches local.
  conflictInst?.signOut()
  setUserId(null)
  pendingConflict = null
  pendingInstant = false
  clearConflictScratch()
  notify()
}

/**
 * Test seam: drive the first-remote state machine with a fake instant backend,
 * bypassing the dynamic import + `hasInstant` gate (both unavailable under
 * vitest). Mirrors `enableSync`'s setup. Not used in production.
 */
export function __enableSyncForTest(inst: Backend, remote: Db, email: string | null): void {
  pendingInstant = true
  const localSnapshot = backend.getDb()
  setUserId('test-user-id')
  onFirstRemote(inst, remote, localSnapshot, email)
}

/** Current snapshot (stable reference until the next change). */
export function getDb(): Db {
  return backend.getDb()
}

/** Apply a pure transform, persist/transact, and notify. */
export function update(fn: (db: Db) => Db): void {
  backend.update(fn)
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Reset to an empty store (tests + local "sign out / wipe"). */
export function resetDb(): void {
  backend.reset()
}

/** Replace the whole store (dev seeding helpers). */
export function setDb(next: Db): void {
  backend.set(next)
}

/**
 * Sign out. On instant: snapshot the merged Db into localStorage (data stays,
 * the app stays fully usable), end the InstantDB session, and switch back to
 * the local backend. On local: just clear the mirrored email.
 */
export function signOut(): void {
  if (mode === 'instant') {
    const snapshot = backend.getDb()
    backend.signOut() // clears remote email + ends the InstantDB session
    localBackend.set({ ...snapshot, settings: { ...snapshot.settings, email: null } })
    backend = localBackend
    mode = 'local'
    pendingInstant = false
    setUserId(null)
    notify()
  } else {
    backend.signOut()
  }
}

/** React binding: re-renders on any store change. */
export function useDb(): Db {
  return useSyncExternalStore(subscribe, getDb, getDb)
}

/** React binding for the pending sign-in conflict (drives the modal). */
export function useSyncConflict(): { counts: RemoteCounts } | null {
  return useSyncExternalStore(subscribe, getSyncConflict, getSyncConflict)
}

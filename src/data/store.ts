import { useSyncExternalStore } from 'react'
import { type Db, emptyDb } from './types'
import type { Backend } from './backend/backend'
import { createLocalBackend } from './backend/local'
import { mergeDb } from './backend/merge'
import { adoptRemote, classifySync, isMeaningful, remoteCounts, type RemoteCounts } from './backend/sync'
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
  // Any state change invalidates the memoized status snapshot (see getSyncStatus,
  // which must return a stable reference between notifies for useSyncExternalStore).
  statusCache = null
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

// ── Sync status machine ────────────────────────────────────────────────────
// Observability layer over the enableSync lifecycle. The states:
//   'unavailable' no backend configured (idle, !hasInstant)
//   'off'         backend configured, not syncing (idle, hasInstant)
//   'connecting'  signed in, awaiting the first remote snapshot (timer armed)
//   'conflict'    first snapshot found meaningful data on both sides (modal up)
//   'on'          the instant backend is live; carries account + live counts
//   'error'       the first snapshot never arrived (~12s timeout) OR the
//                 subscription/transact reported an error
export interface SyncStatus {
  state: 'unavailable' | 'off' | 'connecting' | 'conflict' | 'on' | 'error'
  detail?: string
  account?: string
  remoteCounts?: { routines: number; workouts: number }
}

/** How long to wait for the first remote snapshot before flipping to 'error'. */
export const SYNC_CONNECT_TIMEOUT_MS = 12_000

// Injectable timer so the connecting→error timeout is testable without wall-clock
// waits. Reset to the real timers on every module load (vitest resetModules).
type Scheduler = (fn: () => void, ms: number) => unknown
let scheduleTimeout: Scheduler = (fn, ms) => setTimeout(fn, ms)
let cancelScheduled: (handle: unknown) => void = (h) =>
  clearTimeout(h as ReturnType<typeof setTimeout>)

/** Test seam: swap the connect-timeout timer for a fake the test can fire. */
export function __setSyncTimers(schedule: Scheduler, cancel: (handle: unknown) => void): void {
  scheduleTimeout = schedule
  cancelScheduled = cancel
}

// ── Deferred-import settle detection ────────────────────────────────────────
// `?plan`/`?demo` writes must land on the ACCOUNT when signed in, not on the
// local backend where the conflict flow could discard them. `runWhenSettled`
// (below) parks the write until the sync session settles. Two extra signals:
//
//   instantConfigured — mirrors `hasInstant`: is an InstantDB backend wired for
//     this page load? When false the local backend is the only one, so the
//     write runs immediately. A test seam flips it because `hasInstant` is
//     always false under vitest.
//   authResolved — has InstantDB's `useAuth` finished its initial load?
//     Distinguishes a transient boot 'off' (auth still resolving, wait) from a
//     real signed-out 'off' (import locally). Set by `AppInstant` once
//     `useAuth().isLoading` flips false. Immediately true when !instantConfigured.
let instantConfigured = hasInstant
let authResolved = !hasInstant

/** How long to wait for the session to settle before importing locally anyway. */
export const SETTLE_FALLBACK_MS = 20_000

// Separate injectable timer for the settle fallback so a test can fire it
// without disturbing the connect-timeout timer above.
let scheduleSettle: Scheduler = (fn, ms) => setTimeout(fn, ms)
let cancelSettle: (handle: unknown) => void = (h) =>
  clearTimeout(h as ReturnType<typeof setTimeout>)

/** Test seam: swap the settle-fallback timer for a fake the test can fire. */
export function __setSettleTimer(schedule: Scheduler, cancel: (handle: unknown) => void): void {
  scheduleSettle = schedule
  cancelSettle = cancel
}

/** Test seam: pretend an InstantDB backend is (not) configured this load. */
export function __setInstantConfiguredForTest(value: boolean): void {
  instantConfigured = value
  authResolved = !value
}

/**
 * Signal that InstantDB auth has resolved its initial load (session found or
 * definitively signed out). Called by `AppInstant` when `useAuth().isLoading`
 * flips false. Lets a parked `runWhenSettled` tell a real signed-out 'off' from
 * a transient boot 'off'. Idempotent; notifies so parked evaluators re-run.
 */
export function markAuthResolved(): void {
  if (authResolved) return
  authResolved = true
  notify()
}

let lastSyncError: string | null = null
let syncAccount: string | null = null
let syncUserId: string | null = null
let syncInst: Backend | null = null
// One-line diagnostic shown after a flip (e.g. the empty-but-healthy upload case),
// held until the next state change.
let uploadDetail: string | null = null
let connectTimer: unknown = null
let statusCache: SyncStatus | null = null

function clearConnectTimer(): void {
  if (connectTimer != null) {
    cancelScheduled(connectTimer)
    connectTimer = null
  }
}

/** Timeout while still connecting → surface a human-readable error. */
function onConnectTimeout(): void {
  connectTimer = null
  if (pendingInstant && mode === 'local' && !pendingConflict && !lastSyncError) {
    lastSyncError = "Can't reach your account — the first sync timed out. Check your connection, then retry."
    notify()
  }
}

/** Enter the 'connecting' phase and arm the first-snapshot timeout. */
function beginConnecting(email: string | null): void {
  pendingInstant = true
  syncAccount = email
  lastSyncError = null
  uploadDetail = null
  clearConnectTimer()
  connectTimer = scheduleTimeout(onConnectTimeout, SYNC_CONNECT_TIMEOUT_MS)
  notify()
}

/** Turn an InstantDB error into a human-readable, non-technical line. */
function humanSyncError(err: unknown, kind: 'query' | 'transact'): string {
  const message =
    (err as { message?: unknown })?.message ??
    (err as { body?: { message?: unknown } })?.body?.message
  const suffix = typeof message === 'string' && message ? ` (${message})` : ''
  return kind === 'transact'
    ? `A change couldn't be saved to the cloud${suffix}. It's still on this device — retry to sync it.`
    : `Sync couldn't read your account${suffix}. Check your connection or permissions, then retry.`
}

/** Wired to the instant backend's subscription/transact error callbacks. */
function reportSyncError(err: unknown, kind: 'query' | 'transact'): void {
  clearConnectTimer()
  lastSyncError = humanSyncError(err, kind)
  notify()
}

function computeSyncStatus(): SyncStatus {
  // An in-flight or established machine reports its real state regardless of the
  // build-time hasInstant flag (a live machine proves a backend exists). Only a
  // fully idle store falls back to unavailable/off.
  if (pendingConflict) {
    return { state: 'conflict', account: syncAccount ?? undefined, remoteCounts: pendingConflict.counts }
  }
  if (lastSyncError) {
    return { state: 'error', detail: lastSyncError, account: syncAccount ?? undefined }
  }
  if (mode === 'instant') {
    const db = backend.getDb()
    return {
      state: 'on',
      account: db.settings.email ?? syncAccount ?? undefined,
      detail: uploadDetail ?? undefined,
      remoteCounts: {
        routines: db.routines.length,
        workouts: db.sessions.filter((s) => s.status === 'completed').length,
      },
    }
  }
  if (pendingInstant) {
    return { state: 'connecting', account: syncAccount ?? undefined }
  }
  // `instantConfigured` mirrors `hasInstant` in production; a test seam flips it
  // so the idle 'off' state (and the deferral path) is exercisable under vitest.
  return { state: instantConfigured ? 'off' : 'unavailable' }
}

/**
 * Current sync status. Memoized between notifications so the returned reference
 * is stable (required by `useSyncExternalStore` — a fresh object every call
 * would loop). `notify()` clears the cache on any store change.
 */
export function getSyncStatus(): SyncStatus {
  if (!statusCache) statusCache = computeSyncStatus()
  return statusCache
}

/** React binding: re-renders on any store/sync-status change. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus, getSyncStatus)
}

/**
 * Run `fn` exactly once, when the sync session has settled enough that a write
 * lands on the right backend. Used for the boot-time `?plan`/`?demo` imports so
 * a signed-in device's import goes to the ACCOUNT (via the instant backend)
 * rather than to local, where the sign-in conflict flow could discard it.
 *
 *   no InstantDB configured  → run now (local is the only backend).
 *   status 'on'              → run now (writes go to the account, idempotent).
 *   status 'conflict'        → wait; fires later when it resolves to 'on'
 *                              (adopt) or to a resolved 'off' (cancel/sign-out).
 *   status 'off' + resolved  → run now (genuinely signed out → import locally).
 *   status 'off', unresolved → wait (transient boot 'off', auth still loading).
 *   status 'connecting'      → wait.
 *   status 'error'           → run now locally (data exists on-device; the
 *                              status machine already surfaces the error).
 *
 * Guards: fires at most once, unsubscribes after firing, and a ~20s fallback
 * imports locally if nothing ever settles.
 */
export function runWhenSettled(fn: () => void): void {
  if (!instantConfigured) {
    fn()
    return
  }
  let fired = false
  let unsub: (() => void) | null = null
  const fire = (): void => {
    if (fired) return
    fired = true
    if (fallback != null) {
      cancelSettle(fallback)
      fallback = null
    }
    unsub?.()
    fn()
  }
  const evaluate = (): void => {
    const state = getSyncStatus().state
    if (state === 'on' || state === 'error' || (state === 'off' && authResolved)) fire()
  }
  let fallback: unknown = scheduleSettle(() => {
    fallback = null
    fire()
  }, SETTLE_FALLBACK_MS)
  unsub = subscribe(evaluate)
  evaluate() // handle an already-settled state synchronously
}

/**
 * Re-attempt sync after an error or a stuck 'connecting'. Idempotent and safe to
 * call from a Settings button. If the instant backend is already live we just
 * clear a transient error (its optimistic write already retries under the hood);
 * if a subscription exists but never delivered, we re-open the connecting window;
 * otherwise we start the whole enableSync flow again.
 */
export function retrySync(): void {
  if (mode === 'instant') {
    if (lastSyncError) {
      lastSyncError = null
      notify()
    }
    return
  }
  if (syncInst) {
    // Subscription is live but the first snapshot never arrived — re-arm the window.
    beginConnecting(syncAccount)
    return
  }
  if (hasInstant && syncUserId != null) {
    pendingInstant = false
    enableSync(syncUserId, syncAccount)
  }
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
  lastSyncError = null
  syncInst = inst
  syncAccount = snapshot.settings.email ?? syncAccount
  clearConnectTimer()
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
  // DIAGNOSTIC HONESTY: we only reach here from a SUCCESSFUL first snapshot (the
  // subscription's error path never calls this), so an empty remote is genuinely
  // "empty-but-healthy", NOT permission-hidden. Record which of the two happened
  // so the owner's exact symptom (empty account vs a fresh device) is
  // distinguishable after the fact. A subscription error would instead surface as
  // state 'error' via reportSyncError.
  uploadDetail = isMeaningful(localSnapshot)
    ? "This account had no data yet — this device's data was uploaded to it."
    : 'New account — nothing to sync yet. Data added here will sync from now on.'
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
  syncUserId = userId
  beginConnecting(email)
  const localSnapshot = backend.getDb()
  setUserId(userId)
  void import('./backend/instant')
    .then(({ createInstantBackend }) => {
      const inst = createInstantBackend(
        notify,
        (remote) => onFirstRemote(inst, remote, localSnapshot, email),
        // Subscription/transact errors surface as the 'error' status.
        (err, kind) => reportSyncError(err, kind),
      )
      syncInst = inst
    })
    .catch((err: unknown) => reportSyncError(err, 'query'))
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
  clearConnectTimer()
  lastSyncError = null
  syncAccount = null
  syncUserId = null
  syncInst = null
  uploadDetail = null
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

/**
 * Test seam: enter the 'connecting' phase (no snapshot delivered yet), arming the
 * connect timeout via the injected timer. Pass a fake `inst` to also let
 * `retrySync` re-arm the connecting window as it would against a live but
 * silent subscription.
 */
export function __beginConnectingForTest(email: string | null, inst?: Backend): void {
  syncUserId = 'test-user-id'
  syncInst = inst ?? null
  beginConnecting(email)
}

/** Test seam: deliver the first remote snapshot to a connecting machine. */
export function __deliverRemoteForTest(inst: Backend, remote: Db, email: string | null): void {
  onFirstRemote(inst, remote, backend.getDb(), email)
}

/** Test seam: report a subscription/transact error into the status machine. */
export function __reportSyncErrorForTest(err: unknown, kind: 'query' | 'transact'): void {
  reportSyncError(err, kind)
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
    clearConnectTimer()
    lastSyncError = null
    syncAccount = null
    syncUserId = null
    syncInst = null
    uploadDetail = null
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

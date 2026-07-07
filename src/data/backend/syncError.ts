/**
 * Pure presenter for sync errors. Turns a raw error string (whatever InstantDB
 * or the store recorded) plus the browser's online flag into plain-language,
 * action-first copy for a non-technical owner. No imports → a leaf module, so it
 * can never participate in an import cycle.
 *
 * Design rule (owner request): LEAD WITH WHAT TO DO, reassure that on-device data
 * is safe, and keep the raw message only as a small secondary "Details:" line for
 * bug reports. Known cases are classified; everything else falls back to a
 * generic, still-actionable message.
 */

export interface SyncErrorView {
  /** Short, plain headline. */
  title: string
  /** Action-first body: what happened + numbered next steps. */
  body: string
  /** Raw technical message, surfaced small for bug reports. Absent when unknown. */
  details?: string
}

/** Server said the account isn't allowed to read/write this data. */
const PERMISSION_RE = /permission|unauthor|forbidden|denied|not allowed|403/i

/** A JS crash leaked into the sync path (the owner's TDZ bug is one of these). */
const CODE_CRASH_RE =
  /ReferenceError|TypeError|SyntaxError|RangeError|before initialization|is not a function|is not defined|is not iterable|undefined is not|null is not|cannot read prop|cannot access/i

/**
 * Classify a sync error into presentation copy.
 *
 * @param raw    The recorded error string (may be null/empty when only a timeout).
 * @param online `navigator.onLine` at render time — an offline device gets the
 *   friendliest message and no scary details.
 */
export function classifySyncError(raw: string | null | undefined, online: boolean): SyncErrorView {
  const details = raw && raw.trim() ? raw.trim() : undefined

  if (!online) {
    return {
      title: 'You look offline',
      body: "Sync is paused. Your data is safe on this device and will catch up automatically when you're back online.",
    }
  }

  if (details && CODE_CRASH_RE.test(details)) {
    return {
      title: 'The app hit a bug syncing',
      body: 'Your data is safe on this device. Try: 1) Retry below, 2) if it keeps happening, sign out and back in.',
      details,
    }
  }

  if (details && PERMISSION_RE.test(details)) {
    return {
      title: "Your account can't read this data",
      body: "That's a permissions issue, not lost data — everything is safe on this device. Try: 1) Retry below, 2) sign out and back in.",
      details,
    }
  }

  return {
    title: 'Sync hit a problem',
    body: "Your data is safe on this device. Try: 1) Retry below, 2) check you're online, 3) if it keeps happening, sign out and back in.",
    details,
  }
}

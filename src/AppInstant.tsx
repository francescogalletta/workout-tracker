import { useEffect, useMemo } from 'react'
import { Shell } from './App'
import type { AuthApi } from './auth'
import { idb } from './data/backend/instantClient'
import { enableSync } from './data/store'

/**
 * InstantSync shell (lazy-loaded — only ever imported in a real browser build
 * with an app id configured). It does NOT gate the app: `Shell` renders content
 * from the first paint on the local backend. Its only jobs are:
 *   - Watch InstantDB's `useAuth`. When a session resolves (fresh sign-in or a
 *     pre-existing session on cold start), call `enableSync`, which merges the
 *     local data up and switches the store to the instant backend.
 *   - Provide the real magic-code `AuthApi` to the Sign In screen via `Shell`.
 *
 * Catalog/`?demo` seeding is NOT done here anymore: the app always seeds the
 * local backend at boot, and `enableSync` merges that up (deterministic slug
 * ids make it a no-op against an existing account).
 */
export default function InstantSync() {
  const { user } = idb.useAuth()

  useEffect(() => {
    if (user) enableSync(user.id, user.email ?? null)
  }, [user])

  const authApi: AuthApi = useMemo(
    () => ({
      sendMagicCode: (email) => idb.auth.sendMagicCode({ email }).then(() => undefined),
      signInWithMagicCode: (email, code) =>
        idb.auth.signInWithMagicCode({ email, code }).then(() => undefined),
    }),
    [],
  )

  return <Shell authApi={authApi} />
}

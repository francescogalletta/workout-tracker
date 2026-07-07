import { type Db } from '../types'

/**
 * The storage seam. Both backends (localStorage `local`, InstantDB `instant`)
 * implement this; `src/data/store.ts` is a thin facade that delegates to the
 * active one and swaps between them at runtime (sign-in → instant, sign-out →
 * local). The app only ever touches the facade, so every call site
 * (`getDb`/`update`/`useDb` + the mutation helpers) is backend-agnostic.
 */
export interface Backend {
  getDb(): Db
  /** Apply a pure transform. Must be a no-op when `fn` returns the same ref. */
  update(fn: (db: Db) => Db): void
  /** Wipe to an empty store (tests + local sign-out). */
  reset(): void
  /** Replace the whole store (dev seeding helpers; instant merge-up upload). */
  set(next: Db): void
  /** Sign out: clear the mirrored email (+ end the auth session on instant). */
  signOut(): void
}

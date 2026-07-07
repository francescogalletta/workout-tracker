import { init } from '@instantdb/react'
import schema from '../../../instant.schema'

/**
 * The single InstantDB client. Imported ONLY from code paths that run in the
 * browser with the instant backend active — `instant.ts` (dynamically imported
 * by the store facade) and `AppInstant.tsx` (React.lazy). It is never reached
 * from a static import chain of App/SignIn, so vitest (local backend, node)
 * never evaluates `@instantdb/react`.
 *
 * The app id is public (SPEC §2) and read from the build-time env var.
 */
const appId = import.meta.env.VITE_INSTANT_APP_ID as string

export const idb = init({ appId, schema })

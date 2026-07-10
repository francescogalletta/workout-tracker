import { useSyncExternalStore } from 'react'

/**
 * Dependency-free hash router. Routes:
 *   #/            Home
 *   #/signin      Sign In
 *   #/routines    Routines list
 *   #/routines/:id  Routine editor
 *   #/exercises   Exercises library
 *   #/run         Workout Runner
 *   #/insights    Insights (history + plan; #/history parses here for old links)
 *   #/settings    Settings
 * Unknown hashes fall back to Home.
 */

export type Route =
  | { name: 'home' }
  | { name: 'signin' }
  | { name: 'routines' }
  | { name: 'routineEditor'; id: string }
  | { name: 'exercises' }
  | { name: 'run' }
  | { name: 'insights' }
  | { name: 'settings' }

export function parseRoute(hash: string): Route {
  const path = (hash.startsWith('#') ? hash.slice(1) : hash) || '/'
  if (path === '/' || path === '') return { name: 'home' }
  if (path === '/signin') return { name: 'signin' }
  if (path === '/routines') return { name: 'routines' }
  const editor = path.match(/^\/routines\/([^/]+)$/)
  if (editor) return { name: 'routineEditor', id: decodeURIComponent(editor[1]) }
  if (path === '/exercises') return { name: 'exercises' }
  if (path === '/run') return { name: 'run' }
  // '/history' is the pre-rename hash — kept so bookmarks and installed PWAs
  // with a saved state keep landing on the right screen.
  if (path === '/insights' || path === '/history') return { name: 'insights' }
  if (path === '/settings') return { name: 'settings' }
  return { name: 'home' }
}

/** Navigate to a path like "/routines/abc" (leading '#' optional). */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return
  window.location.hash = path.startsWith('#') ? path : `#${path}`
}

function subscribeHash(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

function getHash(): string {
  return typeof window === 'undefined' ? '#/' : window.location.hash || '#/'
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, getHash, () => '#/')
  return parseRoute(hash)
}

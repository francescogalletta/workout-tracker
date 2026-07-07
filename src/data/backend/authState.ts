/**
 * Tiny bridge carrying the authenticated user's id from the React auth layer
 * (`AppInstant` calls InstantDB's `useAuth`) to the non-React data backend
 * (`instant.ts`, which needs `auth.id` to stamp `owner` on writes and to know
 * when to run first-load seeding). Kept in its own module so both the lazy
 * auth shell and the dynamically-imported data backend share one instance.
 */
let currentUserId: string | null = null
const subs = new Set<() => void>()

export function setUserId(id: string | null): void {
  if (id === currentUserId) return
  currentUserId = id
  for (const cb of subs) cb()
}

export function getUserId(): string | null {
  return currentUserId
}

export function onUserId(cb: () => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

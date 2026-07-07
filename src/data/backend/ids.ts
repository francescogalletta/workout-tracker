/**
 * App id ↔ InstantDB row id mapping.
 *
 * InstantDB requires every row id to be a UUID. The app's ids are a mix of:
 *   - real UUIDs (runtime rows from `crypto.randomUUID()` via `newId`), and
 *   - human slugs from the seed/demo data ('bench-press', 'r-push-a', …).
 *
 * `slugToUuid` maps either onto a stable UUID: a real UUID passes through
 * unchanged, and a slug is hashed into a deterministic v5-style UUID. Because
 * the mapping is deterministic, writing the same slug always targets the same
 * row — so catalog/demo seeding is idempotent across reloads and devices with
 * no lookup table required. The app id itself is preserved in each row's
 * `slug` attribute and restored on read, so the `Db` snapshot never sees a
 * UUID it didn't already have.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** xmur3 string hash → seed generator. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0').slice(-width)

/** Deterministic, well-formed v5-style UUID for an arbitrary string. */
export function deterministicUuid(input: string): string {
  const rng = xmur3(input)
  const a = rng()
  const b = rng()
  const c = rng()
  const d = rng()
  const s = hex(a, 8) + hex(b, 8) + hex(c, 8) + hex(d, 8) // 32 hex chars
  const time_low = s.slice(0, 8)
  const time_mid = s.slice(8, 12)
  const time_hi = '5' + s.slice(13, 16) // version 5
  const variant = ((parseInt(s[16], 16) & 0x3) | 0x8).toString(16) // 10xx variant
  const clock = variant + s.slice(17, 20)
  const node = s.slice(20, 32)
  return `${time_low}-${time_mid}-${time_hi}-${clock}-${node}`
}

/** Map an app id (UUID or slug) to its stable InstantDB row UUID. */
export function slugToUuid(appId: string): string {
  return UUID_RE.test(appId) ? appId.toLowerCase() : deterministicUuid(appId)
}

export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

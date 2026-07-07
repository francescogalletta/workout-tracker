import type { Db } from '../types'

/**
 * Diff-based write path. `update(fn)` on the InstantDB backend snapshots the
 * current mapped `Db`, runs `fn`, then diffs the two per entity array (by app
 * id) to produce a minimal list of transaction ops which are turned into a
 * single `db.transact([...])`. This preserves every existing call site: the
 * app keeps returning whole new `Db` objects and never learns about InstantDB.
 *
 * This module is pure and fully unit-tested (`diff.test.ts`); the InstantDB
 * SDK is only touched in `instant.ts`, which maps `TxOp[]` onto `db.tx`.
 */

export type EntityName =
  | 'exercises'
  | 'routines'
  | 'routineItems'
  | 'sessions'
  | 'setLogs'
  | 'targets'
  | 'settings'

/** Array-backed entities, in a stable order (settings is a singleton, handled apart). */
export const ARRAY_ENTITIES = [
  'exercises',
  'routines',
  'routineItems',
  'sessions',
  'setLogs',
  'targets',
] as const

/** Fixed slug/id for the single per-user settings row. */
export const SETTINGS_SLUG = 'settings'

export interface TxOp {
  entity: EntityName
  /** App id (slug). The instant backend maps this to a UUID via `slugToUuid`. */
  id: string
  op: 'update' | 'delete'
  /** Present for `update` only. */
  fields?: Record<string, unknown>
}

/** Deep-ish equality: Object.is for scalars, JSON for objects/arrays (metrics, values). */
function valueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/** Changed fields of `after` vs `before` (both share the same key set), minus `id`. */
function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(after)) {
    if (key === 'id') continue
    if (!valueEqual(before[key], after[key])) out[key] = after[key]
  }
  return out
}

/** All fields of a new row for a create: everything except `id`, plus slug + owner. */
function createFields(
  row: Record<string, unknown>,
  owner: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    if (key === 'id') continue
    out[key] = row[key]
  }
  out.slug = row.id
  out.owner = owner
  return out
}

function diffArray(
  entity: (typeof ARRAY_ENTITIES)[number],
  prev: Array<{ id: string }>,
  next: Array<{ id: string }>,
  owner: string,
  ops: TxOp[],
): void {
  const prevById = new Map(prev.map((r) => [r.id, r]))
  const nextById = new Map(next.map((r) => [r.id, r]))

  for (const [id, row] of nextById) {
    const before = prevById.get(id)
    if (!before) {
      ops.push({
        entity,
        id,
        op: 'update',
        fields: createFields(row as Record<string, unknown>, owner),
      })
      continue
    }
    const changed = changedFields(
      before as Record<string, unknown>,
      row as Record<string, unknown>,
    )
    // Stamp `owner` on updates too, not just creates. The dashboard rule is
    // `update: auth.id == newData.owner`, and InstantDB's `newData` is the PATCH
    // being applied (the docs: "the changes that are being made to the object"),
    // NOT the merged row — so an update that omits `owner` has `newData.owner`
    // undefined and is silently rejected. Including it (redundant but harmless,
    // it equals the existing value) satisfies the rule under either evaluation
    // semantics and never changes what the row stores.
    if (Object.keys(changed).length > 0)
      ops.push({ entity, id, op: 'update', fields: { ...changed, owner } })
  }

  for (const id of prevById.keys()) {
    if (!nextById.has(id)) ops.push({ entity, id, op: 'delete' })
  }
}

/**
 * Diff two `Db` snapshots into transaction ops. `owner` is the authenticated
 * user's `auth.id`, stamped on every created row for the ownership perms.
 */
export function diffDb(prev: Db, next: Db, owner: string): TxOp[] {
  const ops: TxOp[] = []
  for (const entity of ARRAY_ENTITIES) {
    diffArray(entity, prev[entity], next[entity], owner, ops)
  }

  const changed = changedFields(
    prev.settings as unknown as Record<string, unknown>,
    next.settings as unknown as Record<string, unknown>,
  )
  if (Object.keys(changed).length > 0) {
    ops.push({
      entity: 'settings',
      id: SETTINGS_SLUG,
      op: 'update',
      // Upsert the whole settings row (slug + owner keep the singleton owned).
      fields: { ...(next.settings as unknown as Record<string, unknown>), slug: SETTINGS_SLUG, owner },
    })
  }

  return ops
}

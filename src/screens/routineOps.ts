import type { Db, Exercise, Routine, RoutineItem, Session } from '../data/types'
import { newId } from '../data/types'
import { getDb, update } from '../data/store'
import { exerciseById, itemsForRoutine } from '../data/queries'

/**
 * Shared, pure rotation + preview logic for Home and Routines (agent B).
 *
 * cycleOrder semantics (SPEC §3): the rotation is the set of routines with a
 * non-null `cycleOrder`, ordered by it. After every toggle/reorder we
 * re-number that set 0..n-1 (see `normalizeTo`) so `nextInRotation` and the
 * position badges always see a dense, gap-free sequence.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Rotation routines (non-null cycleOrder, not archived), ordered by position. */
export function rotationList(routines: Routine[]): Routine[] {
  return routines
    .filter((r) => r.cycleOrder !== null && !r.archived)
    .slice()
    .sort((a, b) => (a.cycleOrder ?? 0) - (b.cycleOrder ?? 0))
}

/** Non-rotation, non-archived routines (in stable insertion order). */
export function nonRotationList(routines: Routine[]): Routine[] {
  return routines.filter((r) => r.cycleOrder === null && !r.archived)
}

/**
 * Re-number the rotation so the ids in `orderedIds` get cycleOrder 0..n-1,
 * and any id in `nulls` becomes non-rotation (cycleOrder null). Untouched
 * routines keep their value. Returns a new array (referentially stable rows
 * where nothing changed).
 */
function normalizeTo(routines: Routine[], orderedIds: string[], nulls: string[] = []): Routine[] {
  const pos = new Map(orderedIds.map((id, i) => [id, i]))
  return routines.map((r) => {
    if (pos.has(r.id)) {
      const next = pos.get(r.id)!
      return r.cycleOrder === next ? r : { ...r, cycleOrder: next }
    }
    if (nulls.includes(r.id)) return r.cycleOrder === null ? r : { ...r, cycleOrder: null }
    return r
  })
}

/** Swap a rotation routine with its neighbour (-1 up / +1 down). Edge = no-op. */
export function reorderRotation(routines: Routine[], id: string, dir: -1 | 1): Routine[] {
  const order = rotationList(routines).map((r) => r.id)
  const i = order.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return routines
  ;[order[i], order[j]] = [order[j], order[i]]
  return normalizeTo(routines, order)
}

/** Append a routine to the end of the rotation. */
export function addToRotation(routines: Routine[], id: string): Routine[] {
  const order = rotationList(routines).map((r) => r.id)
  if (order.includes(id)) return routines
  order.push(id)
  return normalizeTo(routines, order)
}

/** Drop a routine from the rotation and re-number the rest. */
export function removeFromRotation(routines: Routine[], id: string): Routine[] {
  const order = rotationList(routines)
    .map((r) => r.id)
    .filter((x) => x !== id)
  return normalizeTo(routines, order, [id])
}

// --- store-bound mutations ---------------------------------------------------

export function reorderRotationMut(id: string, dir: -1 | 1): void {
  update((db) => ({ ...db, routines: reorderRotation(db.routines, id, dir) }))
}

export function setInRotation(id: string, inRotation: boolean): void {
  update((db) => ({
    ...db,
    routines: inRotation ? addToRotation(db.routines, id) : removeFromRotation(db.routines, id),
  }))
}

/**
 * Create a fresh (non-rotation) routine and return it. Warm-ups on by default;
 * the routine's default rest seeds from the app-level Default rest setting so
 * the Settings control actually reaches new routines (it drives nothing else —
 * seeds read `routine.defaultRestSec`). Used by both screens' "+ New routine" /
 * "Create first routine" entries.
 */
export function createRoutine(name = 'New routine'): Routine {
  const routine: Routine = {
    id: newId('r'),
    name,
    defaultRestSec: getDb().settings.defaultRestSec,
    cycleOrder: null,
    warmup: true,
    archived: false,
  }
  update((db) => ({ ...db, routines: [...db.routines, routine] }))
  return routine
}

// --- preview / meta text -----------------------------------------------------

/**
 * Home's 2-line exercise preview from ordered exercise names:
 *   line1 = first two names ("Bench Press · Incline DB Press")
 *   line2 = third name, plus "· N more" when there are still more after it
 *           ("Cable Fly · 3 more").
 */
export function previewLines(names: string[]): [string, string] {
  const line1 = names.slice(0, 2).join(' · ')
  const rest = names.slice(2)
  let line2 = ''
  if (rest.length === 1) line2 = rest[0]
  else if (rest.length > 1) line2 = `${rest[0]} · ${rest.length - 1} more`
  return [line1, line2]
}

/** Ordered exercise names for a routine (unknown ids skipped). */
export function exerciseNames(db: Db, routineId: string): string[] {
  return itemsForRoutine(db, routineId)
    .map((it: RoutineItem) => exerciseById(db, it.exerciseId))
    .filter((e): e is Exercise => e !== null)
    .map((e) => e.name)
}

const short = (ts: number): string => WEEKDAYS[new Date(ts).getDay()]

/** "Last · Pull A · Thu, 62 min" — null when there is no completed session. */
export function lastSessionLine(session: Session | null): string | null {
  if (!session) return null
  const day = short(session.startedAt)
  const mins = session.finishedAt
    ? Math.max(0, Math.round((session.finishedAt - session.startedAt) / 60000))
    : 0
  return `Last · ${session.routineName} · ${day}, ${mins} min`
}

/** Number of routine items → "6 exercises" / "1 exercise". */
export function exerciseCountLabel(n: number): string {
  return `${n} exercise${n === 1 ? '' : 's'}`
}

/**
 * Routines row sub-line: "N exercises · last Sun" (or "· never done"), with an
 * "up next · " prefix when this routine is the rotation suggestion.
 */
export function routineSub(db: Db, routine: Routine, upNext: boolean): string {
  const count = itemsForRoutine(db, routine.id).length
  const done = db.sessions
    .filter((s) => s.routineId === routine.id && s.status === 'completed')
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0]
  const recency = done ? `last ${short(done.finishedAt ?? done.startedAt)}` : 'never done'
  const base = `${exerciseCountLabel(count)} · ${recency}`
  return upNext ? `up next · ${base}` : base
}

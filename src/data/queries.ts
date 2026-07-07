import type { Db, Exercise, InsightTarget, Routine, RoutineItem, Session, SetLog } from './types'

/**
 * Pure read helpers over a Db snapshot. All of these are safe to call in
 * render (they derive, never mutate).
 */

const WEEK_MS = 7 * 24 * 3600 * 1000

export function exerciseById(db: Db, id: string): Exercise | null {
  return db.exercises.find((e) => e.id === id) ?? null
}

export function routineById(db: Db, id: string): Routine | null {
  return db.routines.find((r) => r.id === id) ?? null
}

/** Items of a routine, ordered. */
export function itemsForRoutine(db: Db, routineId: string): RoutineItem[] {
  return db.routineItems
    .filter((it) => it.routineId === routineId)
    .slice()
    .sort((a, b) => a.order - b.order)
}

/** Routines in the rotation, by cycle position. */
export function rotationRoutines(db: Db): Routine[] {
  return db.routines
    .filter((r) => r.cycleOrder !== null && !r.archived)
    .slice()
    .sort((a, b) => (a.cycleOrder ?? 0) - (b.cycleOrder ?? 0))
}

/** The one active session, or null (SPEC §3: only one at a time). */
export function activeSession(db: Db): Session | null {
  const actives = db.sessions.filter((s) => s.status === 'active')
  if (actives.length === 0) return null
  return actives.reduce((a, b) => (b.startedAt > a.startedAt ? b : a))
}

export function lastCompletedSession(db: Db): Session | null {
  const done = db.sessions.filter((s) => s.status === 'completed')
  if (done.length === 0) return null
  return done.reduce((a, b) =>
    (b.finishedAt ?? b.startedAt) > (a.finishedAt ?? a.startedAt) ? b : a,
  )
}

/**
 * Next routine in the rotation: the one after the most recently completed
 * rotation session's routine; the first in the cycle when there is none.
 * A suggestion, never a lock (SPEC §3).
 */
export function nextInRotation(db: Db): Routine | null {
  const cycle = rotationRoutines(db)
  if (cycle.length === 0) return null
  const completed = db.sessions
    .filter((s) => s.status === 'completed' && s.routineId !== null)
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
  for (const s of completed) {
    const idx = cycle.findIndex((r) => r.id === s.routineId)
    if (idx !== -1) return cycle[(idx + 1) % cycle.length]
  }
  return cycle[0]
}

/**
 * Working-set history of one exercise: sessions most recent first, each with
 * its working setLogs in set order. Warm-ups excluded (they never feed
 * history or the engine, SPEC §5.3). Includes discarded sessions — those
 * sets were really performed.
 */
export function historyFor(
  db: Db,
  exerciseId: string,
): Array<{ session: Session; logs: SetLog[] }> {
  const bySession = new Map<string, SetLog[]>()
  for (const l of db.setLogs) {
    if (l.exerciseId !== exerciseId || l.isWarmup) continue
    const arr = bySession.get(l.sessionId)
    if (arr) arr.push(l)
    else bySession.set(l.sessionId, [l])
  }
  const out: Array<{ session: Session; logs: SetLog[] }> = []
  for (const session of db.sessions) {
    const logs = bySession.get(session.id)
    if (!logs) continue
    out.push({ session, logs: logs.slice().sort((a, b) => a.completedAt - b.completedAt) })
  }
  return out.sort((a, b) => b.session.startedAt - a.session.startedAt)
}

export type LogFilter = { type: 'exercise' | 'group'; value: string } | null

export interface LogSessionView {
  session: Session
  exercises: Array<{ exerciseId: string; exerciseName: string; logs: SetLog[] }>
}

/**
 * Sessions for the History › Log tab, most recent first, working sets only
 * (footnote: "Working sets only · warm-ups excluded"). Active sessions are
 * included so the log updates live mid-workout. `filter` narrows to one
 * exercise or one muscle group; sessions left empty by the filter are
 * dropped.
 */
export function sessionsForLog(db: Db, filter: LogFilter): LogSessionView[] {
  const groupOf = new Map(db.exercises.map((e) => [e.id, e.muscleGroup]))
  const keep = (l: SetLog): boolean => {
    if (l.isWarmup) return false
    if (!filter) return true
    if (filter.type === 'exercise') return l.exerciseId === filter.value
    return groupOf.get(l.exerciseId) === filter.value
  }

  const out: LogSessionView[] = []
  for (const session of db.sessions) {
    const logs = db.setLogs
      .filter((l) => l.sessionId === session.id && keep(l))
      .sort((a, b) => a.completedAt - b.completedAt)
    if (logs.length === 0) continue
    const order: string[] = []
    const byExercise = new Map<string, { exerciseId: string; exerciseName: string; logs: SetLog[] }>()
    for (const l of logs) {
      let entry = byExercise.get(l.exerciseId)
      if (!entry) {
        entry = { exerciseId: l.exerciseId, exerciseName: l.exerciseName, logs: [] }
        byExercise.set(l.exerciseId, entry)
        order.push(l.exerciseId)
      }
      entry.logs.push(l)
    }
    out.push({ session, exercises: order.map((id) => byExercise.get(id)!) })
  }
  return out.sort((a, b) => b.session.startedAt - a.session.startedAt)
}

/**
 * Average working sets per week per muscle group over the last `weeks`
 * weeks (strength only, warm-ups excluded). Groups with no sets in the
 * window are present with 0 when the catalog knows them.
 */
export function weeklySetsPerMuscleGroup(
  db: Db,
  weeks: number,
  now: number = Date.now(),
): Record<string, number> {
  const from = now - weeks * WEEK_MS
  const info = new Map(db.exercises.map((e) => [e.id, e]))
  const out: Record<string, number> = {}
  for (const e of db.exercises) {
    if (e.kind === 'strength') out[e.muscleGroup] = 0
  }
  for (const l of db.setLogs) {
    if (l.isWarmup || l.completedAt < from || l.completedAt > now) continue
    const e = info.get(l.exerciseId)
    if (!e || e.kind !== 'strength') continue
    out[e.muscleGroup] = (out[e.muscleGroup] ?? 0) + 1
  }
  for (const g of Object.keys(out)) out[g] = Math.round((out[g] / weeks) * 10) / 10
  return out
}

/** The unexpired Insights target for an exercise (latest wins), or null. */
export function activeTargetFor(db: Db, exerciseId: string, now: number): InsightTarget | null {
  const live = db.targets.filter((t) => t.exerciseId === exerciseId && t.expiresAt > now)
  if (live.length === 0) return null
  return live.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
}

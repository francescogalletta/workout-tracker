import { activeSession } from './queries'
import { getDb, update } from './store'
import type { AppSettings, Exercise, ExerciseType, Routine, Session, SetLog } from './types'
import { newId } from './types'

/**
 * Small write helpers over the store. All are optimistic + synchronous
 * (SPEC §8.1 zero loading states); each maps to one InstantDB transaction
 * later.
 */

/**
 * Create (and return) an active session for a routine. Only one active
 * session may exist — if one already does, it is returned unchanged so a
 * double-tap on Start can't fork the state.
 */
export function startSession(routine: Routine, now: number = Date.now()): Session {
  const existing = activeSession(getDb())
  if (existing) return existing
  const session: Session = {
    id: newId('s'),
    routineId: routine.id,
    routineName: routine.name,
    status: 'active',
    startedAt: now,
    finishedAt: null,
  }
  update((db) => ({ ...db, sessions: [...db.sessions, session] }))
  return session
}

export function finishSession(sessionId: string, now: number = Date.now()): void {
  update((db) => ({
    ...db,
    sessions: db.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: 'completed' as const, finishedAt: now } : s,
    ),
  }))
}

/** Discard keeps the session's setLogs — the sets were really performed. */
export function discardSession(sessionId: string, now: number = Date.now()): void {
  update((db) => ({
    ...db,
    sessions: db.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: 'discarded' as const, finishedAt: now } : s,
    ),
  }))
}

export function addSetLog(row: SetLog): void {
  update((db) => ({ ...db, setLogs: [...db.setLogs, row] }))
}

export function updateSetLog(id: string, patch: Partial<Omit<SetLog, 'id'>>): void {
  update((db) => ({
    ...db,
    setLogs: db.setLogs.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }))
}

/** "Also update routine" on swap: repoint the template item (SPEC §5.6). */
export function updateRoutineItemExercise(itemId: string, exerciseId: string): void {
  update((db) => ({
    ...db,
    routineItems: db.routineItems.map((it) => (it.id === itemId ? { ...it, exerciseId } : it)),
  }))
}

export function updateSettings(patch: Partial<AppSettings>): void {
  update((db) => ({ ...db, settings: { ...db.settings, ...patch } }))
}

/**
 * Create a user ("custom") exercise from the create-exercise flow. Type is
 * chosen once here (CHANGE_REQUEST §1.2/§2.4). Muscle group is not collected in
 * that minimal screen, so it defaults to `other` (still searchable in the
 * picker's "all" chip). Returns the new row so callers can immediately add it.
 */
export function createExercise(input: {
  name: string
  type: ExerciseType
  muscleGroup?: string
  primaryMuscle?: string
  equipment?: string
}): Exercise {
  const ex: Exercise = {
    id: newId('ex'),
    name: input.name.trim(),
    muscleGroup: input.muscleGroup ?? 'other',
    primaryMuscle: input.primaryMuscle ?? 'custom',
    equipment: input.equipment ?? (input.type === 'weight' ? 'barbell' : 'body'),
    loadType: input.type === 'weight' ? 'weighted' : 'bodyweight',
    kind: 'strength',
    type: input.type,
    isCustom: true,
    notes: '',
  }
  update((db) => ({ ...db, exercises: [...db.exercises, ex] }))
  return ex
}

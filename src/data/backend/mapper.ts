import {
  type AppSettings,
  type Db,
  DEFAULT_APP_SETTINGS,
  type Exercise,
  type InsightTarget,
  type Metric,
  type Routine,
  type RoutineItem,
  type Session,
  type SessionStatus,
  type SetLog,
  emptyDb,
} from '../types'

/**
 * Read path: map InstantDB query rows back into the app's `Db` snapshot shape,
 * so every pure query/screen/engine keeps working untouched. Each row's app id
 * is restored from its `slug`; the InstantDB `id`/`owner` are dropped. Optional
 * numeric fields are coerced `undefined → null` to match the app's nullable
 * semantics (e.g. `cycleOrder: null` = not in rotation).
 */

type Row = Record<string, unknown>

/** InstantDB query result: `{ [entity]: Row[] }`. */
export interface InstantData {
  exercises?: Row[]
  routines?: Row[]
  routineItems?: Row[]
  sessions?: Row[]
  setLogs?: Row[]
  targets?: Row[]
  settings?: Row[]
}

const appId = (r: Row): string => (r.slug as string) ?? (r.id as string)
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' ? v : null
const str = (v: unknown, dflt = ''): string => (typeof v === 'string' ? v : dflt)
const num = (v: unknown, dflt = 0): number => (typeof v === 'number' ? v : dflt)
const bool = (v: unknown, dflt = false): boolean => (typeof v === 'boolean' ? v : dflt)

function mapExercise(r: Row): Exercise {
  return {
    id: appId(r),
    name: str(r.name),
    muscleGroup: str(r.muscleGroup),
    primaryMuscle: str(r.primaryMuscle),
    equipment: str(r.equipment),
    loadType: str(r.loadType, 'weighted') as Exercise['loadType'],
    kind: str(r.kind, 'strength') as Exercise['kind'],
    ...(typeof r.type === 'string' ? { type: r.type as Exercise['type'] } : {}),
    ...(r.metrics != null ? { metrics: r.metrics as Metric[] } : {}),
    isCustom: bool(r.isCustom),
    notes: str(r.notes),
  }
}

function mapRoutine(r: Row): Routine {
  return {
    id: appId(r),
    name: str(r.name),
    defaultRestSec: num(r.defaultRestSec, 90),
    cycleOrder: numOrNull(r.cycleOrder),
    warmup: bool(r.warmup),
    archived: bool(r.archived),
  }
}

function mapRoutineItem(r: Row): RoutineItem {
  return {
    id: appId(r),
    routineId: str(r.routineId),
    exerciseId: str(r.exerciseId),
    order: num(r.order),
    sets: num(r.sets),
    repsPerSet: num(r.repsPerSet),
    targetRIR: num(r.targetRIR),
    ...(typeof r.durSec === 'number' ? { durSec: r.durSec } : {}),
    restSec: numOrNull(r.restSec),
  }
}

function mapSession(r: Row): Session {
  return {
    id: appId(r),
    routineId: typeof r.routineId === 'string' ? r.routineId : null,
    routineName: str(r.routineName),
    status: str(r.status, 'active') as SessionStatus,
    startedAt: num(r.startedAt),
    finishedAt: numOrNull(r.finishedAt),
  }
}

function mapSetLog(r: Row): SetLog {
  return {
    id: appId(r),
    sessionId: str(r.sessionId),
    exerciseId: str(r.exerciseId),
    exerciseName: str(r.exerciseName),
    setNumber: num(r.setNumber),
    isWarmup: bool(r.isWarmup),
    weightKg: num(r.weightKg),
    reps: num(r.reps),
    rir: numOrNull(r.rir),
    ...(typeof r.durSec === 'number' ? { durSec: r.durSec } : {}),
    values: (r.values ?? null) as Record<string, number> | null,
    completedAt: num(r.completedAt),
  }
}

function mapTarget(r: Row): InsightTarget {
  return {
    id: appId(r),
    exerciseId: str(r.exerciseId),
    weightKg: num(r.weightKg),
    note: str(r.note),
    createdAt: num(r.createdAt),
    expiresAt: num(r.expiresAt),
  }
}

function mapSettings(r: Row | undefined): AppSettings {
  if (!r) return { ...DEFAULT_APP_SETTINGS }
  return {
    defaultRestSec: num(r.defaultRestSec, DEFAULT_APP_SETTINGS.defaultRestSec),
    soundEnabled: bool(r.soundEnabled, DEFAULT_APP_SETTINGS.soundEnabled),
    weightIncrementKg: num(r.weightIncrementKg, DEFAULT_APP_SETTINGS.weightIncrementKg),
    unit: str(r.unit, DEFAULT_APP_SETTINGS.unit) as AppSettings['unit'],
    theme: str(r.theme, DEFAULT_APP_SETTINGS.theme) as AppSettings['theme'],
    email: typeof r.email === 'string' ? r.email : null,
  }
}

/** Build the app `Db` snapshot from an InstantDB query result. */
export function rowsToDb(data: InstantData | null | undefined): Db {
  if (!data) return emptyDb()
  return {
    exercises: (data.exercises ?? []).map(mapExercise),
    routines: (data.routines ?? []).map(mapRoutine),
    routineItems: (data.routineItems ?? []).map(mapRoutineItem),
    sessions: (data.sessions ?? []).map(mapSession),
    setLogs: (data.setLogs ?? []).map(mapSetLog),
    targets: (data.targets ?? []).map(mapTarget),
    settings: mapSettings(data.settings?.[0]),
  }
}

/**
 * Persistent data model — InstantDB-shaped so the swap to `@instantdb/react`
 * later is mechanical (SPEC.md §3, extended by PLAN.md and HANDOFF.md).
 *
 * All entities are plain rows with string `id`s and scalar links (`routineId`,
 * `sessionId`, `exerciseId`) rather than nested objects, mirroring InstantDB.
 * Weight is ALWAYS canonical kg; conversion happens at display time.
 */

/** One configurable cardio metric (time / resistance / pace / incline). */
export interface Metric {
  key: string
  label: string
  step: number
  min?: number
  max?: number
  fmt: 'clock' | 'num'
  pre?: string
  post?: string
  dflt: number
}

export type LoadType = 'weighted' | 'bodyweight' | 'assisted'
export type ExerciseKind = 'strength' | 'cardio'

export interface Exercise {
  id: string
  name: string
  /** Coarse group used for filtering & muscle-balance (chest/back/…/cardio). */
  muscleGroup: string
  /** Finer primary muscle (e.g. "lats", "side delts"). */
  primaryMuscle: string
  equipment: string
  loadType: LoadType
  kind: ExerciseKind
  /** Present for cardio exercises only. */
  metrics?: Metric[]
  isCustom: boolean
  notes: string
}

export interface Routine {
  id: string
  name: string
  defaultRestSec: number
  /** Position in the rotation; null = not in rotation. */
  cycleOrder: number | null
  /** Whether to prepend auto warm-ups to the first exercise (HANDOFF §6). */
  warmup: boolean
  archived: boolean
}

export interface RoutineItem {
  id: string
  routineId: string
  exerciseId: string
  order: number
  sets: number
  repsPerSet: number
  targetRIR: number
  /** Overrides the routine default; null = use routine default. */
  restSec: number | null
}

export type SessionStatus = 'active' | 'completed' | 'discarded'

export interface Session {
  id: string
  routineId: string | null
  routineName: string
  status: SessionStatus
  startedAt: number
  finishedAt: number | null
}

export interface SetLog {
  id: string
  sessionId: string
  exerciseId: string
  exerciseName: string
  setNumber: number
  isWarmup: boolean
  /** Canonical kg. 0 for cardio; added weight for bodyweight; negative for assisted. */
  weightKg: number
  reps: number
  rir: number | null
  /** Cardio metric values, else null. */
  values: Record<string, number> | null
  completedAt: number
}

export interface InsightTarget {
  id: string
  exerciseId: string
  weightKg: number
  note: string
  createdAt: number
  expiresAt: number
}

export interface AppSettings {
  defaultRestSec: number
  soundEnabled: boolean
  weightIncrementKg: number
  unit: 'kg' | 'lb'
  theme: 'volt' | 'ember'
  email: string | null
}

/** Full store snapshot persisted to localStorage under `lift.db.v1`. */
export interface Db {
  exercises: Exercise[]
  routines: Routine[]
  routineItems: RoutineItem[]
  sessions: Session[]
  setLogs: SetLog[]
  targets: InsightTarget[]
  settings: AppSettings
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultRestSec: 90,
  soundEnabled: true,
  weightIncrementKg: 2.5,
  unit: 'kg',
  theme: 'volt',
  email: null,
}

export function emptyDb(): Db {
  return {
    exercises: [],
    routines: [],
    routineItems: [],
    sessions: [],
    setLogs: [],
    targets: [],
    settings: { ...DEFAULT_APP_SETTINGS },
  }
}

let seq = 0
/** Stable-ish id: crypto.randomUUID when available, else a counter fallback. */
export function newId(prefix = 'id'): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    // fall through
  }
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}

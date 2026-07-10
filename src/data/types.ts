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
/**
 * How a strength exercise is logged (chosen once, at creation — never
 * per-routine). `weight` logs kg × reps @ RIR; `reps` is bodyweight (reps @ RIR,
 * no weight); `time` is a timed hold (seconds only, no reps/RIR). Cardio is
 * orthogonal (`kind: 'cardio'`) and ignores this. Optional on the row for
 * migration safety — read through `exerciseType()`, which defaults to `weight`.
 */
export type ExerciseType = 'weight' | 'reps' | 'time'

export interface Exercise {
  id: string
  name: string
  /** Coarse group used for filtering & muscle-balance (chest/back/…/core/cardio). */
  muscleGroup: string
  /** Finer primary muscle (e.g. "lats", "side delts"). */
  primaryMuscle: string
  equipment: string
  loadType: LoadType
  kind: ExerciseKind
  /** How the exercise is logged. Absent on legacy rows → treat as `weight`. */
  type?: ExerciseType
  /** Present for cardio exercises only. */
  metrics?: Metric[]
  isCustom: boolean
  notes: string
}

/** The logging type of an exercise, defaulting legacy/cardio rows to `weight`. */
export function exerciseType(ex: { type?: ExerciseType }): ExerciseType {
  return ex.type ?? 'weight'
}

/** Per-type routine-item + logged-set defaults (CHANGE_REQUEST §1.3). */
export const TYPE_DEFAULTS = {
  weight: { sets: 3, reps: 10, rir: 2 },
  reps: { sets: 3, reps: 12, rir: 2 },
  time: { sets: 3, durSec: 30 },
} as const
/** Timed-set duration granularity + floor (seconds). */
export const DUR_STEP = 5
export const DUR_MIN = 5

/** Max routine name length (item 1). Enforced at the input + name setter. */
export const MAX_ROUTINE_NAME_LEN = 40

/** Max exercise name length — enforced at create + rename (Exercises library). */
export const MAX_EXERCISE_NAME_LEN = 40

export interface Routine {
  id: string
  name: string
  defaultRestSec: number
  /**
   * Routine-wide RIR target. Absent on legacy rows → 2; read through
   * `routineDefaultRIR()` (same migration pattern as `Exercise.type`).
   */
  defaultTargetRIR?: number
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
  /** Overrides the routine's default RIR target; null = use routine default. */
  targetRIR: number | null
  /** Target hold seconds for `time` exercises; null/absent otherwise. */
  durSec?: number | null
  /** Overrides the routine default; null = use routine default. */
  restSec: number | null
}

/** The routine's RIR target, defaulting legacy rows (no field) to 2. */
export function routineDefaultRIR(r: { defaultTargetRIR?: number }): number {
  return r.defaultTargetRIR ?? 2
}

/** An item's effective RIR target: its override, else the routine default. */
export function effectiveRIR(
  item: Pick<RoutineItem, 'targetRIR'>,
  routine: { defaultTargetRIR?: number },
): number {
  return item.targetRIR ?? routineDefaultRIR(routine)
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
  /** Actual held seconds for `time` sets; null/absent otherwise. */
  durSec?: number | null
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

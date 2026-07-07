/**
 * Session-scoped runner types. Field names mirror the InstantDB schema in
 * SPEC.md §3 where they overlap (weightKg stored as `weight` here since the
 * whole app is kg-canonical; conversion happens at display time).
 */

export interface Settings {
  defaultRestSec: number
  soundEnabled: boolean
  weightIncrementKg: number
}

export const DEFAULT_SETTINGS: Settings = {
  defaultRestSec: 90,
  soundEnabled: true,
  weightIncrementKg: 2.5,
}

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

/** An exercise as it exists in the picker (mapped from the store catalog). */
export interface DbExercise {
  /** Store exercise id; absent only in legacy demo fixtures. */
  id?: string
  name: string
  muscle: string
  group: string
  equipment: string
  kind?: 'cardio'
  metrics?: Metric[]
}

/** Recommendation context for one exercise (engine output; SPEC §5.5). */
export interface Reco {
  lastW: number
  lastMain: string
  lastSub: string
  /** One-line reason from the engine (screens may surface it). */
  reason?: string | null
}

/** Active target accepted in History › Insights (README decision §4). */
export interface InsightTarget {
  w: number
  sub: string
  weeksLeft: number
}

/** One exercise inside the running session (session-scoped copy). */
export interface SessionExercise {
  /** Store exercise id (null in legacy demo fixtures / unknown exercises). */
  exerciseId?: string | null
  /** Store routineItem id — needed for "also update routine" on swap. */
  routineItemId?: string | null
  name: string
  kind: 'strength' | 'cardio'
  scheme: string
  targetReps: number | null
  targetRir: number | null
  restSec: number | null
  muscle: string
  group: string
  metrics: Metric[] | null
  reco: Reco | null
  target: InsightTarget | null
  plateauText: string | null
}

/** One set row. Strength sets use weight/reps/rir; cardio sets use values. */
export interface SetEntry {
  isWarmup: boolean
  logged: boolean
  weight: number | null
  reps: number
  rir: number | null
  values: Record<string, number> | null
  /** Store SetLog id once logged (edits to logged sets sync to the store). */
  logId?: string | null
}

export interface Ptr {
  e: number
  s: number
}

export interface RestState {
  endsAt: number
  exName: string
  nextE: number
  nextS: number
}

export interface SessionState {
  exercises: SessionExercise[]
  sets: SetEntry[][]
  ptr: Ptr
  resting: RestState | null
  startedAt: number
  finishedAt: number | null
  finished: boolean
}

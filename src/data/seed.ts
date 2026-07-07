import { getDb, update } from './store'
import type {
  Db,
  Exercise,
  InsightTarget,
  LoadType,
  Metric,
  Routine,
  RoutineItem,
  Session,
  SetLog,
} from './types'

/**
 * Starter exercise catalog (~44 strength + 4 cardio) — a superset of the old
 * runner demo DB. The full free-exercise-db import (SPEC §6) comes later and
 * will extend, not replace, these ids.
 */

function ex(
  id: string,
  name: string,
  muscleGroup: string,
  primaryMuscle: string,
  equipment: string,
  loadType: LoadType = 'weighted',
): Exercise {
  return { id, name, muscleGroup, primaryMuscle, equipment, loadType, kind: 'strength', isCustom: false, notes: '' }
}

function cardio(id: string, name: string, metrics: Metric[]): Exercise {
  return {
    id,
    name,
    muscleGroup: 'cardio',
    primaryMuscle: 'cardio',
    equipment: 'machine',
    loadType: 'bodyweight',
    kind: 'cardio',
    metrics,
    isCustom: false,
    notes: '',
  }
}

const time = (dflt: number): Metric => ({ key: 'time', label: 'Time', step: 60, min: 60, fmt: 'clock', dflt })
const level = (max: number, dflt: number): Metric => ({ key: 'res', label: 'Resistance · level', step: 1, min: 1, max, fmt: 'num', pre: 'lvl ', dflt })

export const STARTER_EXERCISES: Exercise[] = [
  // chest
  ex('bench-press', 'Bench Press', 'chest', 'chest', 'barbell'),
  ex('incline-bench-press', 'Incline Bench Press', 'chest', 'chest', 'barbell'),
  ex('dumbbell-bench-press', 'Dumbbell Bench Press', 'chest', 'chest', 'dumbbell'),
  ex('incline-db-press', 'Incline DB Press', 'chest', 'chest', 'dumbbell'),
  ex('machine-chest-press', 'Machine Chest Press', 'chest', 'chest', 'machine'),
  ex('smith-machine-press', 'Smith Machine Press', 'chest', 'chest', 'machine'),
  ex('pec-deck', 'Pec Deck', 'chest', 'chest', 'machine'),
  ex('cable-fly', 'Cable Fly', 'chest', 'chest', 'cable'),
  ex('cable-crossover', 'Cable Crossover', 'chest', 'chest', 'cable'),
  ex('weighted-dip', 'Weighted Dip', 'chest', 'chest', 'body', 'bodyweight'),
  ex('push-up', 'Push-Up', 'chest', 'chest', 'body', 'bodyweight'),
  // back
  ex('lat-pulldown', 'Lat Pulldown', 'back', 'lats', 'cable'),
  ex('pull-up', 'Pull-Up', 'back', 'lats', 'body', 'bodyweight'),
  ex('assisted-pull-up', 'Assisted Pull-Up', 'back', 'lats', 'machine', 'assisted'),
  ex('seated-cable-row', 'Seated Cable Row', 'back', 'lats', 'cable'),
  ex('barbell-row', 'Barbell Row', 'back', 'upper back', 'barbell'),
  ex('chest-supported-row', 'Chest-Supported Row', 'back', 'upper back', 'machine'),
  ex('deadlift', 'Deadlift', 'back', 'lower back', 'barbell'),
  // shoulders
  ex('overhead-press', 'Overhead Press', 'shoulders', 'front delts', 'barbell'),
  ex('arnold-press', 'Arnold Press', 'shoulders', 'front delts', 'dumbbell'),
  ex('lateral-raise', 'Lateral Raise', 'shoulders', 'side delts', 'dumbbell'),
  ex('cable-lateral-raise', 'Cable Lateral Raise', 'shoulders', 'side delts', 'cable'),
  ex('rear-delt-fly', 'Rear Delt Fly', 'shoulders', 'rear delts', 'machine'),
  ex('face-pull', 'Face Pull', 'shoulders', 'rear delts', 'cable'),
  // arms
  ex('biceps-curl', 'Biceps Curl', 'arms', 'biceps', 'dumbbell'),
  ex('hammer-curl', 'Hammer Curl', 'arms', 'biceps', 'dumbbell'),
  ex('ez-bar-curl', 'EZ-Bar Curl', 'arms', 'biceps', 'barbell'),
  ex('cable-curl', 'Cable Curl', 'arms', 'biceps', 'cable'),
  ex('triceps-pushdown', 'Triceps Pushdown', 'arms', 'triceps', 'cable'),
  ex('skullcrusher', 'Skullcrusher', 'arms', 'triceps', 'barbell'),
  ex('overhead-triceps-extension', 'Overhead Triceps Extension', 'arms', 'triceps', 'cable'),
  ex('assisted-dip', 'Assisted Dip', 'arms', 'triceps', 'machine', 'assisted'),
  // legs
  ex('back-squat', 'Back Squat', 'legs', 'quads', 'barbell'),
  ex('front-squat', 'Front Squat', 'legs', 'quads', 'barbell'),
  ex('leg-press', 'Leg Press', 'legs', 'quads', 'machine'),
  ex('bulgarian-split-squat', 'Bulgarian Split Squat', 'legs', 'quads', 'dumbbell'),
  ex('leg-extension', 'Leg Extension', 'legs', 'quads', 'machine'),
  ex('romanian-deadlift', 'Romanian Deadlift', 'legs', 'hamstrings', 'barbell'),
  ex('leg-curl', 'Leg Curl', 'legs', 'hamstrings', 'machine'),
  ex('hip-thrust', 'Hip Thrust', 'legs', 'glutes', 'barbell'),
  ex('standing-calf-raise', 'Standing Calf Raise', 'legs', 'calves', 'machine'),
  ex('seated-calf-raise', 'Seated Calf Raise', 'legs', 'calves', 'machine'),
  // core
  ex('hanging-leg-raise', 'Hanging Leg Raise', 'core', 'abs', 'body', 'bodyweight'),
  ex('cable-crunch', 'Cable Crunch', 'core', 'abs', 'cable'),
  // cardio
  cardio('row-erg', 'Row Erg', [
    time(600),
    level(10, 5),
    { key: 'pace', label: 'Pace · /500m', step: 5, min: 60, fmt: 'clock', post: ' /500m', dflt: 125 },
  ]),
  cardio('treadmill', 'Running (Treadmill)', [
    time(1200),
    { key: 'pace', label: 'Pace · /km', step: 5, min: 120, fmt: 'clock', post: ' /km', dflt: 330 },
    { key: 'incline', label: 'Incline · %', step: 0.5, min: 0, max: 15, fmt: 'num', post: '%', dflt: 1 },
  ]),
  cardio('elliptical', 'Elliptical', [
    time(1200),
    level(20, 8),
    { key: 'incline', label: 'Incline · %', step: 0.5, min: 0, max: 20, fmt: 'num', post: '%', dflt: 2 },
  ]),
  cardio('bike-erg', 'Bike Erg', [
    time(1200),
    level(10, 6),
    { key: 'pace', label: 'Pace · /km', step: 5, min: 60, fmt: 'clock', post: ' /km', dflt: 95 },
  ]),
]

/** Seed the exercise catalog when the store has none (idempotent). */
export function ensureCatalog(): void {
  if (getDb().exercises.length > 0) return
  update((db) => ({ ...db, exercises: STARTER_EXERCISES }))
}

// ---------------------------------------------------------------------------
// Demo data — dev (`?demo`) and tests only. A fresh user sees real empty
// states; this never runs automatically.
// ---------------------------------------------------------------------------

const DAY = 24 * 3600 * 1000
const MIN = 60 * 1000

interface ItemSpec {
  exerciseId: string
  sets: number
  reps: number
  rir: number
  restSec?: number
}

function routineOf(
  id: string,
  name: string,
  cycleOrder: number | null,
  warmup: boolean,
  defaultRestSec: number,
): Routine {
  return { id, name, cycleOrder, warmup, defaultRestSec, archived: false }
}

const ROUTINE_SPECS: Array<{ routine: Routine; items: ItemSpec[] }> = [
  {
    routine: routineOf('r-push-a', 'Push A', 0, true, 90),
    items: [
      { exerciseId: 'bench-press', sets: 4, reps: 8, rir: 2 },
      { exerciseId: 'incline-db-press', sets: 3, reps: 10, rir: 2 },
      { exerciseId: 'cable-fly', sets: 3, reps: 12, rir: 1, restSec: 60 },
      { exerciseId: 'lateral-raise', sets: 3, reps: 12, rir: 1, restSec: 60 },
    ],
  },
  {
    routine: routineOf('r-pull-a', 'Pull A', 1, false, 90),
    items: [
      { exerciseId: 'lat-pulldown', sets: 4, reps: 10, rir: 2 },
      { exerciseId: 'seated-cable-row', sets: 3, reps: 10, rir: 2 },
      { exerciseId: 'face-pull', sets: 3, reps: 15, rir: 2, restSec: 60 },
      { exerciseId: 'biceps-curl', sets: 3, reps: 12, rir: 1, restSec: 60 },
    ],
  },
  {
    routine: routineOf('r-legs', 'Legs', 2, true, 120),
    items: [
      { exerciseId: 'back-squat', sets: 4, reps: 6, rir: 2 },
      { exerciseId: 'romanian-deadlift', sets: 3, reps: 8, rir: 2 },
      { exerciseId: 'leg-press', sets: 3, reps: 10, rir: 2 },
      { exerciseId: 'leg-curl', sets: 3, reps: 12, rir: 1, restSec: 90 },
      { exerciseId: 'standing-calf-raise', sets: 3, reps: 15, rir: 1, restSec: 60 },
    ],
  },
  {
    routine: routineOf('r-push-b', 'Push B', 3, true, 90),
    items: [
      { exerciseId: 'overhead-press', sets: 4, reps: 8, rir: 2 },
      { exerciseId: 'machine-chest-press', sets: 3, reps: 10, rir: 2 },
      { exerciseId: 'cable-lateral-raise', sets: 3, reps: 15, rir: 1, restSec: 60 },
      { exerciseId: 'triceps-pushdown', sets: 3, reps: 12, rir: 1, restSec: 60 },
    ],
  },
  {
    routine: routineOf('r-arms', 'Arms', null, false, 60),
    items: [
      { exerciseId: 'ez-bar-curl', sets: 3, reps: 10, rir: 2 },
      { exerciseId: 'hammer-curl', sets: 3, reps: 12, rir: 1 },
      { exerciseId: 'skullcrusher', sets: 3, reps: 10, rir: 2 },
      { exerciseId: 'overhead-triceps-extension', sets: 3, reps: 12, rir: 1 },
    ],
  },
  {
    routine: routineOf('r-cardio-core', 'Cardio & Core', null, false, 60),
    items: [
      { exerciseId: 'row-erg', sets: 1, reps: 0, rir: 0 },
      { exerciseId: 'hanging-leg-raise', sets: 3, reps: 12, rir: 2 },
      { exerciseId: 'cable-crunch', sets: 3, reps: 15, rir: 1 },
    ],
  },
]

/** Per-exercise plan across occurrences (weights + optional reps/RIR overrides). */
interface OccSpec {
  w: number
  reps?: number[]
  rir?: number[]
}

const OCCURRENCES: Record<string, OccSpec[]> = {
  // Push A ×3 — bench progresses, cable fly plateaus at 25 kg, lateral raise
  // grinds at RIR 0 below target reps (lower-weight insight fodder).
  'bench-press': [
    { w: 60, reps: [10, 10, 9, 9], rir: [3, 3, 2, 2] },
    { w: 62.5 },
    { w: 62.5, reps: [9, 8, 8, 8], rir: [2, 2, 2, 3] },
  ],
  'incline-db-press': [{ w: 22, reps: [11, 11, 10], rir: [3, 2, 2] }, { w: 24 }, { w: 24 }],
  'cable-fly': [{ w: 25 }, { w: 25 }, { w: 25 }],
  'lateral-raise': [
    { w: 10, reps: [10, 9, 8], rir: [0, 0, 1] },
    { w: 10, reps: [10, 9, 9], rir: [0, 1, 0] },
    { w: 10, reps: [11, 10, 9], rir: [0, 0, 1] },
  ],
  // Pull A ×3 — seated cable row sandbagged (add-weight insight fodder).
  'lat-pulldown': [
    { w: 55, reps: [12, 11, 10, 10], rir: [3, 3, 3, 2] },
    { w: 57.5, reps: [11, 11, 10, 10], rir: [3, 3, 2, 3] },
    { w: 60 },
  ],
  'seated-cable-row': [
    { w: 50, rir: [3, 3, 3] },
    { w: 50, rir: [4, 3, 3] },
    { w: 50, rir: [3, 4, 3] },
  ],
  'face-pull': [{ w: 15 }, { w: 15 }, { w: 17.5 }],
  'biceps-curl': [{ w: 12 }, { w: 12 }, { w: 14 }],
  // Legs ×2
  'back-squat': [{ w: 90, reps: [8, 7, 6, 6], rir: [3, 2, 2, 2] }, { w: 95 }],
  'romanian-deadlift': [{ w: 80 }, { w: 80, reps: [9, 8, 8], rir: [3, 2, 2] }],
  'leg-press': [{ w: 150 }, { w: 155 }],
  'leg-curl': [{ w: 40 }, { w: 40 }],
  'standing-calf-raise': [{ w: 60 }, { w: 60 }],
  // Push B ×2
  'overhead-press': [{ w: 40, reps: [8, 8, 7, 7], rir: [2, 2, 2, 1] }, { w: 40 }],
  'machine-chest-press': [{ w: 55 }, { w: 57.5 }],
  'cable-lateral-raise': [{ w: 7.5 }, { w: 7.5 }],
  'triceps-pushdown': [{ w: 25 }, { w: 27.5 }],
  // Arms ×1
  'ez-bar-curl': [{ w: 25 }],
  'hammer-curl': [{ w: 12 }],
  'skullcrusher': [{ w: 20 }],
  'overhead-triceps-extension': [{ w: 22.5 }],
  // Cardio & Core ×1 (row erg logs via the cardio branch)
  'hanging-leg-raise': [{ w: 0 }], // strict bodyweight: added weight 0
  'cable-crunch': [{ w: 30 }],
}

/** Session schedule: [days ago, routine id]. Most recent completed = Pull A. */
const SCHEDULE: Array<[number, string]> = [
  [18, 'r-push-a'],
  [16, 'r-pull-a'],
  [14, 'r-legs'],
  [12, 'r-push-b'],
  [11, 'r-push-a'],
  [9, 'r-pull-a'],
  [8, 'r-arms'],
  [8, 'r-cardio-core'],
  [7, 'r-legs'],
  [5, 'r-push-b'],
  [4, 'r-push-a'],
  [2, 'r-pull-a'],
]

function roundInc(w: number, inc: number): number {
  const q = w / inc
  const base = Math.floor(q)
  return Math.round((q - base > 0.5 + 1e-9 ? base + 1 : base) * inc * 100) / 100
}

/**
 * Deterministic demo dataset: rotation routines Push A / Pull A / Legs /
 * Push B + 2 non-rotation, ~3 weeks of completed sessions with plausible
 * setLogs (a bench progression, a cable-fly plateau, insight fodder), and
 * one active Insights target on bench. Requires the catalog to be seeded.
 * Overwrites routines/sessions/logs; leaves exercises and settings alone,
 * except it signs in a demo account when no email is set (skips the gate).
 */
export function seedDemoData(now: number = Date.now()): void {
  ensureCatalog()

  const routines: Routine[] = []
  const routineItems: RoutineItem[] = []
  for (const spec of ROUTINE_SPECS) {
    routines.push(spec.routine)
    spec.items.forEach((it, i) => {
      routineItems.push({
        id: `${spec.routine.id}-i${i + 1}`,
        routineId: spec.routine.id,
        exerciseId: it.exerciseId,
        order: i,
        sets: it.sets,
        repsPerSet: it.reps,
        targetRIR: it.rir,
        restSec: it.restSec ?? null,
      })
    })
  }

  const sessions: Session[] = []
  const setLogs: SetLog[] = []
  const occSeen: Record<string, number> = {}
  let logSeq = 0

  SCHEDULE.forEach(([daysAgo, routineId], si) => {
    const spec = ROUTINE_SPECS.find((s) => s.routine.id === routineId)!
    const startedAt = now - daysAgo * DAY
    const session: Session = {
      id: `s-demo-${si + 1}`,
      routineId,
      routineName: spec.routine.name,
      status: 'completed',
      startedAt,
      finishedAt: startedAt + 62 * MIN,
    }
    sessions.push(session)

    spec.items.forEach((it, ii) => {
      const exercise = STARTER_EXERCISES.find((e) => e.id === it.exerciseId)!
      const t0 = startedAt + ii * 8 * MIN

      if (exercise.kind === 'cardio') {
        const values: Record<string, number> = {}
        for (const m of exercise.metrics ?? []) values[m.key] = m.dflt
        setLogs.push({
          id: `l-demo-${++logSeq}`,
          sessionId: session.id,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          setNumber: 1,
          isWarmup: false,
          weightKg: 0,
          reps: 0,
          rir: null,
          values,
          completedAt: t0 + 10 * MIN,
        })
        return
      }

      const occIdx = occSeen[it.exerciseId] ?? 0
      occSeen[it.exerciseId] = occIdx + 1
      const occ = OCCURRENCES[it.exerciseId]?.[occIdx] ?? { w: 20 }

      // Warm-ups for the routine's first exercise when the warmup flag is on.
      if (ii === 0 && spec.routine.warmup) {
        const wu: Array<[number, number]> = [
          [roundInc(occ.w * 0.5, 2.5), 8],
          [roundInc(occ.w * 0.7, 2.5), 5],
        ]
        wu.forEach(([w, reps], wi) => {
          setLogs.push({
            id: `l-demo-${++logSeq}`,
            sessionId: session.id,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            setNumber: wi + 1,
            isWarmup: true,
            weightKg: w,
            reps,
            rir: null,
            values: null,
            completedAt: t0 + wi * 2 * MIN,
          })
        })
      }

      for (let s = 0; s < it.sets; s++) {
        setLogs.push({
          id: `l-demo-${++logSeq}`,
          sessionId: session.id,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          setNumber: s + 1,
          isWarmup: false,
          weightKg: occ.w,
          reps: occ.reps?.[s] ?? it.reps,
          rir: occ.rir?.[s] ?? it.rir,
          values: null,
          completedAt: t0 + 5 * MIN + s * 150 * 1000,
        })
      }
    })
  })

  const targets: InsightTarget[] = [
    {
      id: 't-demo-bench',
      exerciseId: 'bench-press',
      weightKg: 65,
      note: '8 reps @ RIR 2',
      createdAt: now - 7 * DAY,
      expiresAt: now + 21 * DAY,
    },
  ]

  update((db: Db) => ({
    ...db,
    routines,
    routineItems,
    sessions,
    setLogs,
    targets,
    // Demo mode must never land on the sign-in gate.
    settings: { ...db.settings, email: db.settings.email ?? 'demo@lift.local' },
  }))
}

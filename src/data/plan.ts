import { ensureCatalog } from './seed'
import { update } from './store'
import type { Db, Exercise, LoadType, Routine, RoutineItem } from './types'

/**
 * Import a built-in 5-day split training plan into app data, written through
 * the store's `update()` so it works on the local backend and syncs through the
 * instant backend when signed in (ownership is stamped by the write path).
 *
 * Design decisions baked in:
 *
 *  - EFFORT: the introductory block of the plan uses a flat "leave ~3 reps in
 *    the tank (RIR 3)" effort target. That RIR scale is already the app's 0–4
 *    scale, so the mapping is the identity and every item gets targetRIR = 3.
 *    (Heavier later-block targets are not imported — re-run this importer to
 *    advance them once the plan progresses.)
 *  - REPS: double progression starts at the BOTTOM of each prescribed range,
 *    so an "8–10" becomes 8.
 *  - REST: the plan specifies only a strength-bias vs hypertrophy-bias split,
 *    no per-set rest seconds. We derive: strength days default 150 s,
 *    hypertrophy days 90 s; secondary compounds and isolations get shorter
 *    per-item overrides, anti-movement core shortest (45 s). Judgment call.
 *  - MOVEMENT SELECTION: the plan favours joint-friendly variations — trap-bar
 *    deadlift (not floor), chest-supported rows (not bent-over), back
 *    extensions, supported Bulgarian split squats, and anti-movement core
 *    (side plank, bird-dog, Pallof press, dead bug) instead of loaded spinal
 *    flexion. These selections are preserved as-is.
 *  - CORE: the anti-movement core work is prescribed as "3 sets each" with no
 *    reps and no durations. We model it as strength items (no cardio metrics
 *    invented) at a conservative 10-rep placeholder — the set count is from the
 *    plan, the rep number is not.
 *
 * IDEMPOTENT: every row has a deterministic slug id, so re-running (`?plan`)
 * updates in place and never duplicates. The import never deletes or reorders
 * the user's other routines: plan routines take the tail of the rotation,
 * existing rotation order is preserved and renormalised densely.
 */

/** Phase-0 (weeks 1–3) effort: flat RIR 3, already on the app's 0–4 scale. */
const PHASE0_RIR = 3

/** Deterministic id prefix for every routine this importer owns. */
const ID_PREFIX = 'r-recomp-'

function customEx(
  id: string,
  name: string,
  muscleGroup: string,
  primaryMuscle: string,
  equipment: string,
  loadType: LoadType = 'weighted',
): Exercise {
  return {
    id,
    name,
    muscleGroup,
    primaryMuscle,
    equipment,
    loadType,
    kind: 'strength',
    isCustom: true,
    notes: '',
  }
}

/**
 * Exercises the plan needs that the starter catalog lacks. Slug ids, sensible
 * groups/equipment/loadType. Appended (never overwriting) so history stays
 * distinct per movement (e.g. seated vs lying leg curl).
 */
export const RECOMP_CUSTOM_EXERCISES: Exercise[] = [
  customEx('db-shoulder-press', 'Seated DB Shoulder Press', 'shoulders', 'front delts', 'dumbbell'),
  // Trap bar loads quads + glutes + hams as a neutral-spine hinge/squat; the
  // plan's swap for the floor deadlift. Grouped with legs (not lower back).
  customEx('trap-bar-deadlift', 'Trap-Bar Deadlift', 'legs', 'glutes', 'barbell'),
  customEx('goblet-squat', 'Goblet Squat', 'legs', 'quads', 'dumbbell'),
  customEx('back-extension', '45° Back Extension', 'back', 'lower back', 'machine', 'bodyweight'),
  customEx('seated-leg-curl', 'Seated Leg Curl', 'legs', 'hamstrings', 'machine'),
  customEx('lying-leg-curl', 'Lying Leg Curl', 'legs', 'hamstrings', 'machine'),
  customEx('hack-squat', 'Hack Squat', 'legs', 'quads', 'machine'),
  customEx('incline-db-curl', 'Incline DB Curl', 'arms', 'biceps', 'dumbbell'),
  // Anti-movement core (guardrail): no loaded spinal flexion.
  customEx('side-plank', 'Side Plank', 'core', 'abs', 'body', 'bodyweight'),
  customEx('bird-dog', 'Bird-Dog', 'core', 'abs', 'body', 'bodyweight'),
  customEx('pallof-press', 'Pallof Press', 'core', 'abs', 'cable'),
  customEx('dead-bug', 'Dead Bug', 'core', 'abs', 'body', 'bodyweight'),
]

interface PlanItem {
  exerciseId: string
  sets: number
  /** Bottom of the plan's rep range (double-progression start). */
  reps: number
  /** Per-item rest override in seconds; omit to use the routine default. */
  rest?: number
}

interface PlanRoutine {
  /** Slug suffix after `r-recomp-`. */
  slug: string
  name: string
  defaultRestSec: number
  items: PlanItem[]
}

/**
 * The five training days of the split, in the plan's weekly order
 * (Upper → Lower → Push → Pull → Legs). Rest/cardio days are not routines.
 * Exercise order, set counts and the joint-friendly substitutions mirror the
 * plan exactly; reps are the bottom of each stated range.
 */
const PLAN_ROUTINES: PlanRoutine[] = [
  {
    slug: 'upper',
    name: 'Upper (strength bias)',
    defaultRestSec: 150,
    items: [
      { exerciseId: 'bench-press', sets: 4, reps: 6 },
      { exerciseId: 'chest-supported-row', sets: 4, reps: 6 },
      { exerciseId: 'db-shoulder-press', sets: 3, reps: 6 },
      { exerciseId: 'lat-pulldown', sets: 3, reps: 8, rest: 120 },
      { exerciseId: 'incline-db-press', sets: 3, reps: 8, rest: 120 },
      { exerciseId: 'lateral-raise', sets: 3, reps: 15, rest: 60 },
      { exerciseId: 'face-pull', sets: 3, reps: 12, rest: 60 },
      { exerciseId: 'cable-curl', sets: 3, reps: 10, rest: 60 },
      { exerciseId: 'triceps-pushdown', sets: 3, reps: 10, rest: 60 },
    ],
  },
  {
    slug: 'lower',
    name: 'Lower (strength bias)',
    defaultRestSec: 150,
    items: [
      { exerciseId: 'trap-bar-deadlift', sets: 4, reps: 6 },
      { exerciseId: 'goblet-squat', sets: 3, reps: 8, rest: 120 },
      { exerciseId: 'leg-press', sets: 3, reps: 10, rest: 120 },
      { exerciseId: 'back-extension', sets: 3, reps: 10, rest: 90 },
      { exerciseId: 'seated-leg-curl', sets: 3, reps: 10, rest: 90 },
      { exerciseId: 'standing-calf-raise', sets: 4, reps: 10, rest: 60 },
      { exerciseId: 'side-plank', sets: 3, reps: 10, rest: 45 },
      { exerciseId: 'bird-dog', sets: 3, reps: 10, rest: 45 },
    ],
  },
  {
    slug: 'push',
    name: 'Push (hypertrophy)',
    defaultRestSec: 90,
    items: [
      { exerciseId: 'incline-bench-press', sets: 4, reps: 8, rest: 120 },
      { exerciseId: 'db-shoulder-press', sets: 3, reps: 10 },
      { exerciseId: 'cable-fly', sets: 3, reps: 12, rest: 60 },
      { exerciseId: 'lateral-raise', sets: 4, reps: 12, rest: 60 },
      { exerciseId: 'overhead-triceps-extension', sets: 3, reps: 10, rest: 60 },
      { exerciseId: 'triceps-pushdown', sets: 3, reps: 12, rest: 60 },
    ],
  },
  {
    slug: 'pull',
    name: 'Pull (hypertrophy)',
    defaultRestSec: 90,
    items: [
      { exerciseId: 'pull-up', sets: 4, reps: 6, rest: 120 },
      { exerciseId: 'chest-supported-row', sets: 4, reps: 10 },
      { exerciseId: 'lat-pulldown', sets: 3, reps: 12 },
      { exerciseId: 'rear-delt-fly', sets: 3, reps: 15, rest: 60 },
      { exerciseId: 'incline-db-curl', sets: 3, reps: 10, rest: 60 },
      { exerciseId: 'hammer-curl', sets: 3, reps: 10, rest: 60 },
    ],
  },
  {
    slug: 'legs',
    name: 'Legs (hypertrophy)',
    defaultRestSec: 90,
    items: [
      { exerciseId: 'hack-squat', sets: 4, reps: 8, rest: 120 },
      { exerciseId: 'hip-thrust', sets: 3, reps: 8 },
      { exerciseId: 'bulgarian-split-squat', sets: 3, reps: 10 },
      { exerciseId: 'leg-extension', sets: 3, reps: 12, rest: 60 },
      { exerciseId: 'lying-leg-curl', sets: 3, reps: 12, rest: 60 },
      { exerciseId: 'seated-calf-raise', sets: 4, reps: 12, rest: 60 },
      { exerciseId: 'pallof-press', sets: 3, reps: 10, rest: 45 },
      { exerciseId: 'dead-bug', sets: 3, reps: 10, rest: 45 },
    ],
  },
]

/** Routine id for a plan day (deterministic). */
function routineId(slug: string): string {
  return `${ID_PREFIX}${slug}`
}

/** The plan warms up the first compound of EVERY session, so warmup is on. */
const WARMUP = true

/**
 * Import (or re-import) the split plan. Idempotent: deterministic slug
 * ids mean a second run produces an identical Db. Coexists with any existing
 * data — the user's other routines keep their order (renormalised densely) and
 * the plan takes the tail rotation slots.
 */
export function importRecompPlan(_now: number = Date.now()): void {
  ensureCatalog()

  const planRoutineIds = new Set(PLAN_ROUTINES.map((r) => routineId(r.slug)))

  update((db: Db): Db => {
    // 1. Upsert-if-absent the custom exercises the plan needs.
    const haveEx = new Set(db.exercises.map((e) => e.id))
    const exercises = [...db.exercises]
    for (const ce of RECOMP_CUSTOM_EXERCISES) {
      if (!haveEx.has(ce.id)) exercises.push(ce)
    }

    // 2. Renormalise the rotation of the user's OTHER routines densely,
    //    preserving their order, so the plan can take the tail slots.
    const others = db.routines.filter((r) => !planRoutineIds.has(r.id))
    const otherRotation = others
      .filter((r) => r.cycleOrder !== null)
      .slice()
      .sort((a, b) => (a.cycleOrder ?? 0) - (b.cycleOrder ?? 0))
    const denseOrder = new Map<string, number>()
    otherRotation.forEach((r, i) => denseOrder.set(r.id, i))
    const normalisedOthers: Routine[] = others.map((r) =>
      r.cycleOrder === null ? r : { ...r, cycleOrder: denseOrder.get(r.id)! },
    )
    const base = otherRotation.length

    // 3. Build the plan routines at the tail of the rotation.
    const planRoutines: Routine[] = PLAN_ROUTINES.map((spec, i) => ({
      id: routineId(spec.slug),
      name: spec.name,
      defaultRestSec: spec.defaultRestSec,
      cycleOrder: base + i,
      warmup: WARMUP,
      archived: false,
    }))

    // 4. Build the plan items with deterministic ids.
    const planItems: RoutineItem[] = []
    for (const spec of PLAN_ROUTINES) {
      const rid = routineId(spec.slug)
      spec.items.forEach((it, i) => {
        planItems.push({
          id: `${rid}-i${i + 1}`,
          routineId: rid,
          exerciseId: it.exerciseId,
          order: i,
          sets: it.sets,
          repsPerSet: it.reps,
          targetRIR: PHASE0_RIR,
          restSec: it.rest ?? null,
        })
      })
    }

    const otherItems = db.routineItems.filter((it) => !planRoutineIds.has(it.routineId))

    return {
      ...db,
      exercises,
      routines: [...normalisedOthers, ...planRoutines],
      routineItems: [...otherItems, ...planItems],
    }
  })
}

/** Exported for tests / tooling: the plan routine ids in rotation order. */
export const RECOMP_ROUTINE_IDS: string[] = PLAN_ROUTINES.map((r) => routineId(r.slug))

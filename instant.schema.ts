import { i } from '@instantdb/react'

/**
 * InstantDB schema for Lift — mirrors `src/data/types.ts` (SPEC §3).
 *
 * ID STRATEGY: every row's InstantDB id is a UUID (InstantDB requires UUID
 * ids), while the app's own string id ('bench-press', 'r-push-a', a runtime
 * crypto.randomUUID(), …) is stored in `slug`. The backend maps slug ↔ uuid
 * deterministically (`src/data/backend/ids.ts`), so all foreign keys stay as
 * plain slug strings (`routineId`, `exerciseId`, `sessionId`) exactly like the
 * localStorage model — no InstantDB links are used for app relationships.
 *
 * OWNERSHIP: every row carries `owner` (= the authenticated user's `auth.id`),
 * set on create. `instant.perms.ts` gates every entity on `auth.id == owner`
 * so the app is private by default (SPEC §2).
 *
 * Nested values (cardio `metrics: Metric[]`, set `values: Record<..>`) are
 * stored as `i.json()`. Timestamps are epoch-millis numbers (not i.date()) so
 * the mapped snapshot matches the app's numeric fields verbatim.
 */
const _schema = i.schema({
  entities: {
    exercises: i.entity({
      name: i.string(),
      muscleGroup: i.string(),
      primaryMuscle: i.string(),
      equipment: i.string(),
      loadType: i.string(),
      kind: i.string(),
      type: i.string().optional(),
      metrics: i.json().optional(),
      isCustom: i.boolean(),
      notes: i.string(),
      slug: i.string().indexed(),
      owner: i.string().indexed(),
    }),
    routines: i.entity({
      name: i.string(),
      defaultRestSec: i.number(),
      cycleOrder: i.number().optional(),
      warmup: i.boolean(),
      archived: i.boolean(),
      slug: i.string().indexed(),
      owner: i.string().indexed(),
    }),
    routineItems: i.entity({
      routineId: i.string().indexed(),
      exerciseId: i.string().indexed(),
      order: i.number(),
      sets: i.number(),
      repsPerSet: i.number(),
      targetRIR: i.number(),
      durSec: i.number().optional(),
      restSec: i.number().optional(),
      slug: i.string().indexed(),
      owner: i.string().indexed(),
    }),
    sessions: i.entity({
      routineId: i.string().optional(),
      routineName: i.string(),
      status: i.string().indexed(),
      startedAt: i.number().indexed(),
      finishedAt: i.number().optional(),
      slug: i.string().indexed(),
      owner: i.string().indexed(),
    }),
    setLogs: i.entity({
      sessionId: i.string().indexed(),
      exerciseId: i.string().indexed(),
      exerciseName: i.string(),
      setNumber: i.number(),
      isWarmup: i.boolean(),
      weightKg: i.number(),
      reps: i.number(),
      rir: i.number().optional(),
      durSec: i.number().optional(),
      values: i.json().optional(),
      completedAt: i.number().indexed(),
      slug: i.string().indexed(),
      owner: i.string().indexed(),
    }),
    targets: i.entity({
      exerciseId: i.string().indexed(),
      weightKg: i.number(),
      note: i.string(),
      createdAt: i.number(),
      expiresAt: i.number().indexed(),
      slug: i.string().indexed(),
      owner: i.string().indexed(),
    }),
    settings: i.entity({
      defaultRestSec: i.number(),
      soundEnabled: i.boolean(),
      weightIncrementKg: i.number(),
      unit: i.string(),
      theme: i.string(),
      email: i.string().optional(),
      slug: i.string().indexed(),
      owner: i.string().indexed(),
    }),
  },
  links: {},
})

type _AppSchema = typeof _schema
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema

export type { AppSchema }
export default schema

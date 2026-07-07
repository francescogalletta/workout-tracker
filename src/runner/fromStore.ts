import { activeTargetFor, historyFor, itemsForRoutine, routineById } from '../data/queries'
import { update } from '../data/store'
import type { Db, Exercise, Session, SetLog } from '../data/types'
import { detectPlateau, prescribe, type WorkingHistory } from '../engine/reco'
import { warmupSets } from '../engine/warmup'
import { fmtDur, fmtW } from '../lib/format'
import { TYPE_DEFAULTS } from '../data/types'
import { createSession, nextUnlogged, type SessionSeed } from './session'
import type { DbExercise, SessionExercise, SessionState, SetEntry } from './types'

/**
 * Bridges the persistent store (src/data) and the in-memory runner session.
 * The runner's UI state (pointer, rest, sheets) is never persisted; only
 * Session rows and SetLogs are. Resuming rebuilds the in-memory state from
 * the routine + engine and replays the session's setLogs onto it.
 */

const WEEK_MS = 7 * 24 * 3600 * 1000

/** Store exercise → picker item (the picker DB is the store catalog now). */
export function toPickerItem(e: Exercise): DbExercise {
  return {
    id: e.id,
    name: e.name,
    muscle: e.primaryMuscle,
    group: e.muscleGroup,
    equipment: e.equipment,
    ...(e.kind === 'cardio'
      ? { kind: 'cardio' as const, metrics: e.metrics }
      : { type: e.type ?? 'weight' }),
  }
}

function workingHistory(db: Db, exerciseId: string, excludeSessionId?: string): WorkingHistory {
  return historyFor(db, exerciseId)
    .filter((h) => h.session.id !== excludeSessionId)
    .map((h) => h.logs.map((l) => ({ weightKg: l.weightKg, reps: l.reps, rir: l.rir })))
    .filter((sets) => sets.length > 0)
}

/**
 * Build the session seeds for a routine from routineItems + engine output:
 * prescriptions, reason line, plateau banner, active Insights target, last-
 * session lines, and generated warm-ups (routine.warmup → first exercise
 * only, HANDOFF decision 6).
 */
export function seedsForRoutine(
  db: Db,
  routineId: string,
  now: number,
  excludeSessionId?: string,
): SessionSeed[] {
  const routine = routineById(db, routineId)
  if (!routine) return []
  const items = itemsForRoutine(db, routineId)
  const inc = db.settings.weightIncrementKg
  const seeds: SessionSeed[] = []

  items.forEach((item, idx) => {
    const ex = db.exercises.find((e) => e.id === item.exerciseId)
    if (!ex) return

    if (ex.kind === 'cardio') {
      const values: Record<string, number> = {}
      for (const m of ex.metrics ?? []) values[m.key] = m.dflt
      seeds.push({
        exercise: {
          exerciseId: ex.id,
          routineItemId: item.id,
          name: ex.name,
          kind: 'cardio',
          scheme: 'cardio',
          targetReps: null,
          targetRir: null,
          restSec: null,
          muscle: ex.primaryMuscle,
          group: ex.muscleGroup,
          metrics: ex.metrics ?? null,
          reco: null,
          target: null,
          plateauText: null,
        },
        sets: [{ isWarmup: false, weight: null, reps: 0, rir: null, values }],
      })
      return
    }

    const type = ex.type ?? 'weight'

    // Timed holds: no weight/reps/RIR, no reco/warm-ups — just a target duration.
    if (type === 'time') {
      const durSec = item.durSec ?? TYPE_DEFAULTS.time.durSec
      const sets: SessionSeed['sets'] = []
      for (let s = 0; s < item.sets; s++) {
        sets.push({ weight: null, reps: 0, rir: null, durSec })
      }
      seeds.push({
        exercise: {
          exerciseId: ex.id,
          routineItemId: item.id,
          name: ex.name,
          kind: 'strength',
          type,
          scheme: `${item.sets} × ${fmtDur(durSec)}`,
          targetReps: null,
          targetRir: null,
          restSec: item.restSec,
          muscle: ex.primaryMuscle,
          group: ex.muscleGroup,
          metrics: null,
          reco: null,
          target: null,
          plateauText: null,
        },
        sets,
      })
      return
    }

    // Bodyweight reps: reps @ RIR, no weight, no engine (weight history is 0kg).
    if (type === 'reps') {
      const sets: SessionSeed['sets'] = []
      for (let s = 0; s < item.sets; s++) {
        sets.push({ weight: null, reps: item.repsPerSet, rir: item.targetRIR })
      }
      seeds.push({
        exercise: {
          exerciseId: ex.id,
          routineItemId: item.id,
          name: ex.name,
          kind: 'strength',
          type,
          scheme: `${item.sets}×${item.repsPerSet} @ RIR ${item.targetRIR}`,
          targetReps: item.repsPerSet,
          targetRir: item.targetRIR,
          restSec: item.restSec,
          muscle: ex.primaryMuscle,
          group: ex.muscleGroup,
          metrics: null,
          reco: null,
          target: null,
          plateauText: null,
        },
        sets,
      })
      return
    }

    const history = workingHistory(db, ex.id, excludeSessionId)
    const presc = prescribe(history, item.repsPerSet, item.targetRIR, inc)
    const plateau = detectPlateau(history, item.repsPerSet, item.targetRIR, inc)
    const targetRow = activeTargetFor(db, ex.id, now)

    const sets: SessionSeed['sets'] = []
    if (idx === 0 && routine.warmup) {
      for (const wu of warmupSets(presc.weightKg, inc)) {
        sets.push({ isWarmup: true, weight: wu.weightKg, reps: wu.reps, rir: null })
      }
    }
    for (let s = 0; s < item.sets; s++) {
      sets.push({ weight: presc.weightKg, reps: item.repsPerSet, rir: item.targetRIR })
    }

    seeds.push({
      exercise: {
        exerciseId: ex.id,
        routineItemId: item.id,
        name: ex.name,
        kind: 'strength',
        type,
        scheme: `${item.sets}×${item.repsPerSet} @ RIR ${item.targetRIR}`,
        targetReps: item.repsPerSet,
        targetRir: item.targetRIR,
        restSec: item.restSec,
        muscle: ex.primaryMuscle,
        group: ex.muscleGroup,
        metrics: null,
        reco: presc.last
          ? {
              lastW: presc.last.weightKg,
              lastMain: `${fmtW(presc.last.weightKg)} kg`,
              lastSub: presc.last.line,
              reason: presc.reason,
            }
          : null,
        target: targetRow
          ? {
              w: targetRow.weightKg,
              sub: targetRow.note,
              weeksLeft: Math.max(0, Math.ceil((targetRow.expiresAt - now) / WEEK_MS)),
            }
          : null,
        plateauText: plateau,
      },
      sets,
    })
  })

  return seeds
}

function defaultStrengthSets(
  type: 'weight' | 'reps' | 'time',
): Array<Partial<SetEntry> & Pick<SetEntry, 'weight' | 'reps' | 'rir'>> {
  if (type === 'time') {
    return [0, 1, 2].map(() => ({ weight: null, reps: 0, rir: null, durSec: TYPE_DEFAULTS.time.durSec }))
  }
  const reps = type === 'reps' ? TYPE_DEFAULTS.reps.reps : TYPE_DEFAULTS.weight.reps
  return [0, 1, 2].map(() => ({ weight: null, reps, rir: 2 }))
}

/** Session exercise for a logged exercise that isn't in the routine (added mid-session). */
function adHocSeed(db: Db, log: SetLog): SessionSeed {
  const ex = db.exercises.find((e) => e.id === log.exerciseId)
  if (ex && ex.kind === 'cardio') {
    const values: Record<string, number> = {}
    for (const m of ex.metrics ?? []) values[m.key] = m.dflt
    return {
      exercise: {
        exerciseId: ex.id,
        routineItemId: null,
        name: ex.name,
        kind: 'cardio',
        scheme: 'cardio',
        targetReps: null,
        targetRir: null,
        restSec: null,
        muscle: ex.primaryMuscle,
        group: ex.muscleGroup,
        metrics: ex.metrics ?? null,
        reco: null,
        target: null,
        plateauText: null,
      },
      sets: [{ isWarmup: false, weight: null, reps: 0, rir: null, values }],
    }
  }
  const type = ex?.type ?? 'weight'
  const timed = type === 'time'
  const reps = type === 'reps' ? TYPE_DEFAULTS.reps.reps : TYPE_DEFAULTS.weight.reps
  return {
    exercise: {
      exerciseId: log.exerciseId || null,
      routineItemId: null,
      name: ex?.name ?? log.exerciseName,
      kind: 'strength',
      type,
      scheme: timed ? `3 × ${fmtDur(TYPE_DEFAULTS.time.durSec)}` : `3×${reps} @ RIR 2`,
      targetReps: timed ? null : reps,
      targetRir: timed ? null : 2,
      restSec: null,
      muscle: ex?.primaryMuscle ?? '',
      group: ex?.muscleGroup ?? '',
      metrics: null,
      reco: null,
      target: null,
      plateauText: null,
    },
    sets: defaultStrengthSets(type),
  }
}

/**
 * Rebuild the in-memory SessionState for an existing (resumed) session:
 * seeds from the routine + engine, then replay the session's setLogs —
 * matching each log to its set slot by exercise, warm-up flag, and set
 * number. Logged exercises not in the routine are appended (they were added
 * or swapped in mid-session).
 */
export function restoreState(db: Db, session: Session, now: number): SessionState {
  const seeds = session.routineId ? seedsForRoutine(db, session.routineId, now, session.id) : []
  const state = createSession(seeds, session.startedAt)
  const logs = db.setLogs
    .filter((l) => l.sessionId === session.id)
    .sort((a, b) => a.completedAt - b.completedAt)

  const exercises: SessionExercise[] = state.exercises.slice()
  const sets: SetEntry[][] = state.sets.map((arr) => arr.map((x) => ({ ...x })))

  for (const log of logs) {
    let e = exercises.findIndex((m) => m.exerciseId === log.exerciseId)
    if (e === -1) {
      const seed = adHocSeed(db, log)
      exercises.push({ ...seed.exercise, metrics: seed.exercise.metrics ?? null })
      sets.push(
        seed.sets.map((s) => ({
          isWarmup: s.isWarmup ?? false,
          logged: false,
          weight: s.weight,
          reps: s.reps,
          rir: s.rir,
          durSec: s.durSec ?? null,
          values: s.values ?? null,
        })),
      )
      e = exercises.length - 1
    }
    // nth set of the same type (warm-up vs working) within the exercise
    const slots = sets[e]
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.isWarmup === log.isWarmup)
    const slot = slots[log.setNumber - 1]
    const entry: SetEntry = {
      isWarmup: log.isWarmup,
      logged: true,
      weight: log.isWarmup || exercises[e].kind !== 'cardio' ? log.weightKg : null,
      reps: log.reps,
      rir: log.rir,
      durSec: typeof log.durSec === 'number' ? log.durSec : null,
      values: log.values ? { ...log.values } : null,
      logId: log.id,
    }
    if (slot) sets[e][slot.i] = entry
    else sets[e].push(entry)
  }

  const restored: SessionState = { ...state, exercises, sets }
  const routine = session.routineId ? routineById(db, session.routineId) : null
  restored.sessionRest = routine?.defaultRestSec ?? null
  const nxt = nextUnlogged(sets)
  if (nxt) restored.ptr = nxt
  return restored
}

/**
 * Push edits made to already-logged sets back to their SetLog rows.
 * Called from the runner after every state change; only rows whose values
 * actually differ are written.
 */
export function syncLoggedEdits(db: Db, state: SessionState): void {
  const patches = new Map<string, Partial<SetLog>>()
  state.sets.forEach((arr) => {
    for (const x of arr) {
      if (!x.logged || !x.logId) continue
      const row = db.setLogs.find((l) => l.id === x.logId)
      if (!row) continue
      const patch: Partial<SetLog> = {}
      const w = x.weight ?? 0
      if (row.weightKg !== w) patch.weightKg = w
      if (row.reps !== x.reps) patch.reps = x.reps
      if (row.rir !== x.rir) patch.rir = x.rir
      const dur = x.durSec ?? null
      if ((row.durSec ?? null) !== dur) patch.durSec = dur
      const values = x.values ? { ...x.values } : null
      if (JSON.stringify(row.values) !== JSON.stringify(values)) patch.values = values
      if (Object.keys(patch).length > 0) patches.set(x.logId, patch)
    }
  })
  if (patches.size === 0) return
  update((cur) => ({
    ...cur,
    setLogs: cur.setLogs.map((l) => {
      const patch = patches.get(l.id)
      return patch ? { ...l, ...patch } : l
    }),
  }))
}

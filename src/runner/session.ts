import { fmtDur } from '../lib/format'
import type {
  DbExercise,
  ExerciseType,
  Metric,
  Ptr,
  SessionExercise,
  SessionState,
  SetEntry,
  Settings,
} from './types'

/** Logging type of a session exercise (legacy/cardio rows default to weight). */
export function typeOf(ex: { type?: ExerciseType }): ExerciseType {
  return ex.type ?? 'weight'
}

const DUR_STEP = 5
const DUR_MIN = 5
const TIME_DEFAULT_DUR = 30

/** Template for seeding a session (demo now; from routineItems + engine later). */
export interface SessionSeed {
  exercise: Omit<SessionExercise, 'metrics'> & { metrics?: Metric[] | null }
  sets: Array<Partial<SetEntry> & Pick<SetEntry, 'weight' | 'reps' | 'rir'>>
}

export function createSession(seeds: SessionSeed[], now: number): SessionState {
  return {
    exercises: seeds.map((t) => ({ ...t.exercise, metrics: t.exercise.metrics ?? null })),
    sets: seeds.map((t) =>
      t.sets.map((s) => ({
        isWarmup: s.isWarmup ?? false,
        logged: false,
        weight: s.weight,
        reps: s.reps,
        rir: s.rir,
        values: s.values ?? null,
      })),
    ),
    ptr: { e: 0, s: 0 },
    resting: null,
    startedAt: now,
    finishedAt: null,
    finished: false,
  }
}

export function nextUnlogged(sets: SetEntry[][]): Ptr | null {
  for (let e = 0; e < sets.length; e++) {
    for (let s = 0; s < sets[e].length; s++) {
      if (!sets[e][s].logged) return { e, s }
    }
  }
  return null
}

export function nextUnloggedAfter(sets: SetEntry[][], e0: number, s0: number): Ptr | null {
  for (let e = e0; e < sets.length; e++) {
    for (let s = e === e0 ? s0 + 1 : 0; s < sets[e].length; s++) {
      if (!sets[e][s].logged) return { e, s }
    }
  }
  return null
}

function cloneSets(sets: SetEntry[][]): SetEntry[][] {
  return sets.map((arr) => arr.map((x) => ({ ...x, values: x.values ? { ...x.values } : null })))
}

function mutPointed(state: SessionState, fn: (x: SetEntry) => void): SessionState {
  const sets = cloneSets(state.sets)
  fn(sets[state.ptr.e][state.ptr.s])
  return { ...state, sets }
}

export type Action =
  | { type: 'activate'; e: number; s: number }
  | { type: 'stepWeight'; dir: 1 | -1; step: number }
  | { type: 'typeWeight'; value: number }
  | { type: 'stepReps'; dir: 1 | -1 }
  | { type: 'typeReps'; value: number }
  | { type: 'selectRir'; value: number }
  | { type: 'stepDur'; dir: 1 | -1 }
  | { type: 'stepMetric'; key: string; dir: 1 | -1 }
  | { type: 'setSessionRest'; sec: number }
  | { type: 'log'; now: number; settings: Settings; logId?: string; durSec?: number }
  | { type: 'move'; index: number; dir: 1 | -1 }
  | { type: 'swap'; exIdx: number; item: DbExercise }
  | { type: 'add'; item: DbExercise }
  | { type: 'dismissPlateau'; exIdx: number }
  | { type: 'restAdjust'; deltaMs: number }
  | { type: 'restEnd' }
  | { type: 'finish'; now: number }

export function reduce(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'activate':
      return { ...state, ptr: { e: action.e, s: action.s } }

    case 'stepWeight':
      return mutPointed(state, (x) => {
        x.weight = Math.max(0, (x.weight ?? 0) + action.dir * action.step)
      })

    case 'typeWeight':
      return mutPointed(state, (x) => {
        x.weight = Math.max(0, action.value)
      })

    case 'stepReps':
      return mutPointed(state, (x) => {
        x.reps = Math.max(1, x.reps + action.dir)
      })

    case 'typeReps':
      return mutPointed(state, (x) => {
        x.reps = Math.max(1, Math.round(action.value))
      })

    case 'selectRir':
      return mutPointed(state, (x) => {
        x.rir = action.value
      })

    case 'stepDur':
      return mutPointed(state, (x) => {
        x.durSec = Math.max(DUR_MIN, (x.durSec ?? TIME_DEFAULT_DUR) + action.dir * DUR_STEP)
      })

    case 'setSessionRest':
      return { ...state, sessionRest: action.sec }

    case 'stepMetric': {
      const def = state.exercises[state.ptr.e].metrics?.find((d) => d.key === action.key)
      if (!def) return state
      return mutPointed(state, (x) => {
        if (!x.values) return
        const next = x.values[action.key] + action.dir * def.step
        x.values[action.key] = Math.min(def.max ?? Infinity, Math.max(def.min ?? 0, next))
      })
    }

    case 'log':
      return logSet(state, action.now, action.settings, action.logId, action.durSec)

    case 'move':
      return moveExercise(state, action.index, action.dir)

    case 'swap':
      return applySwap(state, action.exIdx, action.item)

    case 'add':
      return applyAdd(state, action.item)

    case 'dismissPlateau': {
      const exercises = state.exercises.map((m, i) =>
        i === action.exIdx ? { ...m, plateauText: null } : m,
      )
      return { ...state, exercises }
    }

    case 'restAdjust':
      if (!state.resting) return state
      return { ...state, resting: { ...state.resting, endsAt: state.resting.endsAt + action.deltaMs } }

    case 'restEnd':
      return { ...state, resting: null }

    case 'finish':
      return { ...state, finished: true, finishedAt: action.now, resting: null }
  }
}

/**
 * Log the pointed set: mark it, carry its weight forward to the exercise's
 * remaining unlogged sets, advance the pointer, and start rest for working
 * strength sets. Only `weight`-type sets require a weight (the keypad flow
 * guarantees it); `reps`/`time` sets log without one. `durSec`, when passed,
 * is the actual held seconds recorded on a timed set.
 *
 * Rest length resolves per CHANGE_REQUEST §3.4:
 *   exercise override (`ex.restSec`) → session default (`state.sessionRest`)
 *   → Settings default.
 */
export function logSet(
  state: SessionState,
  now: number,
  settings: Settings,
  logId?: string,
  durSec?: number,
): SessionState {
  const p = state.ptr
  const cur = state.sets[p.e][p.s]
  const ex = state.exercises[p.e]
  if (ex.kind === 'strength' && typeOf(ex) === 'weight' && cur.weight === null) return state

  const sets = cloneSets(state.sets)
  const logged = sets[p.e][p.s]
  logged.logged = true
  if (logId !== undefined) logged.logId = logId
  if (durSec !== undefined) logged.durSec = durSec

  // Carry the just-logged weight to later unlogged working sets so the weight
  // you settled on this session sticks (CHANGE_REQUEST item 4; weight-type only).
  if (typeOf(ex) === 'weight' && logged.weight !== null) {
    const seedW = logged.weight
    for (let s = p.s + 1; s < sets[p.e].length; s++) {
      const nx = sets[p.e][s]
      if (!nx.logged && !nx.isWarmup) nx.weight = seedW
    }
  }

  const nxt = nextUnloggedAfter(sets, p.e, p.s) ?? nextUnlogged(sets)
  const next: SessionState = { ...state, sets }
  if (nxt) {
    next.ptr = nxt
    if (!cur.isWarmup && ex.kind !== 'cardio') {
      const restSec = ex.restSec ?? state.sessionRest ?? settings.defaultRestSec
      next.resting = {
        endsAt: now + restSec * 1000,
        exName: state.exercises[nxt.e].name,
        nextE: nxt.e,
        nextS: nxt.s,
      }
    }
  }
  return next
}

/** Reorder this session only; the routine template is untouched. */
export function moveExercise(state: SessionState, i: number, dir: 1 | -1): SessionState {
  const j = i + dir
  if (j < 0 || j >= state.exercises.length) return state
  const exercises = state.exercises.slice()
  ;[exercises[i], exercises[j]] = [exercises[j], exercises[i]]
  const sets = state.sets.slice()
  ;[sets[i], sets[j]] = [sets[j], sets[i]]

  const next: SessionState = { ...state, exercises, sets }
  const nxt = nextUnlogged(sets)
  if (nxt) {
    next.ptr = nxt
    if (state.resting) {
      next.resting = {
        ...state.resting,
        nextE: nxt.e,
        nextS: nxt.s,
        exName: exercises[nxt.e].name,
      }
    }
  }
  return next
}

function cardioSet(metrics: Metric[]): SetEntry {
  const values: Record<string, number> = {}
  for (const d of metrics) values[d.key] = d.dflt
  return { isWarmup: false, logged: false, weight: null, reps: 0, rir: null, values }
}

/** One unlogged set with the given type's defaults (CHANGE_REQUEST §1.3). */
function freshSetOf(type: ExerciseType): SetEntry {
  if (type === 'time') {
    return { isWarmup: false, logged: false, weight: null, reps: 0, rir: null, durSec: TIME_DEFAULT_DUR, values: null }
  }
  const reps = type === 'reps' ? 12 : 10
  return { isWarmup: false, logged: false, weight: null, reps, rir: 2, values: null }
}

/** Three fresh sets of the given strength type. */
function freshStrengthSets(type: ExerciseType): SetEntry[] {
  return [0, 1, 2].map(() => freshSetOf(type))
}

/** Default one-exercise scheme label for a strength type. */
function schemeFor(type: ExerciseType): string {
  if (type === 'time') return `3 × ${fmtDur(TIME_DEFAULT_DUR)}`
  return type === 'reps' ? '3×12 @ RIR 2' : '3×10 @ RIR 2'
}

function sessionExerciseFrom(item: DbExercise): SessionExercise {
  const cardio = item.kind === 'cardio'
  const type: ExerciseType = item.type ?? 'weight'
  const timed = !cardio && type === 'time'
  return {
    exerciseId: item.id ?? null,
    routineItemId: null,
    name: item.name,
    kind: cardio ? 'cardio' : 'strength',
    type: cardio ? undefined : type,
    scheme: cardio ? 'cardio' : schemeFor(type),
    targetReps: cardio || timed ? null : type === 'reps' ? 12 : 10,
    targetRir: cardio || timed ? null : 2,
    restSec: null,
    muscle: item.muscle,
    group: item.group,
    metrics: item.metrics ?? null,
    reco: null,
    target: null,
    plateauText: null,
  }
}

/**
 * Swap an exercise in place (session-scoped). New exercise starts with no
 * recommendation ("first time — enter weight"); logged sets are kept.
 */
export function applySwap(state: SessionState, exIdx: number, item: DbExercise): SessionState {
  const prev = state.exercises[exIdx]
  const wasCardio = prev.kind === 'cardio'
  const nextEx = sessionExerciseFrom(item)
  // Keep the template link so "also update routine" keeps working after swaps.
  nextEx.routineItemId = prev.routineItemId ?? null
  const exercises = state.exercises.map((m, i) => (i === exIdx ? nextEx : m))
  const sets = cloneSets(state.sets)
  const newType = item.type ?? 'weight'

  if (item.kind === 'cardio') {
    sets[exIdx] = [cardioSet(item.metrics ?? [])]
  } else if (wasCardio) {
    sets[exIdx] = freshStrengthSets(newType)
  } else if (newType === typeOf(prev)) {
    // same type: keep the scheme; clear prescriptions on sets not yet performed
    nextEx.scheme = prev.scheme
    nextEx.targetReps = prev.targetReps
    nextEx.targetRir = prev.targetRir
    nextEx.restSec = prev.restSec
    sets[exIdx] = sets[exIdx].map((x) => (x.logged ? x : { ...x, weight: null }))
  } else {
    // different type: rebuild unlogged sets with the new type's defaults
    // (CHANGE_REQUEST §5), keeping any logged sets and the rest override.
    nextEx.restSec = prev.restSec
    sets[exIdx] = sets[exIdx].map((x) => (x.logged ? x : freshSetOf(newType)))
  }

  const next: SessionState = { ...state, exercises, sets }
  if (state.ptr.e === exIdx && state.ptr.s >= sets[exIdx].length) {
    const nxt = nextUnlogged(sets)
    if (nxt) next.ptr = nxt
  }
  return next
}

/** Append an exercise to this session only (routine template untouched). */
export function applyAdd(state: SessionState, item: DbExercise): SessionState {
  const ex = sessionExerciseFrom(item)
  const newSets =
    item.kind === 'cardio' ? [cardioSet(item.metrics ?? [])] : freshStrengthSets(item.type ?? 'weight')
  return {
    ...state,
    exercises: [...state.exercises, ex],
    sets: [...state.sets, newSets],
  }
}

/** Logged working sets, flat (summary + finish confirm). */
export function loggedWorkingSets(state: SessionState): SetEntry[] {
  const out: SetEntry[] = []
  for (let e = 0; e < state.sets.length; e++) {
    if (state.exercises[e].kind === 'cardio') continue
    for (const x of state.sets[e]) if (x.logged && !x.isWarmup) out.push(x)
  }
  return out
}

export function totalVolumeKg(state: SessionState): number {
  return loggedWorkingSets(state).reduce((a, x) => a + (x.weight ?? 0) * x.reps, 0)
}

/** Per-exercise improvement notes for the summary screen. */
export function summaryChanges(state: SessionState): string[] {
  const out: string[] = []
  state.exercises.forEach((m, i) => {
    if (m.kind === 'cardio' || typeOf(m) !== 'weight') return
    const logged = state.sets[i].filter((x) => x.logged && !x.isWarmup)
    if (!logged.length) return
    if (!m.reco) {
      out.push(`${m.name} · first log`)
      return
    }
    const maxW = Math.max(...logged.map((x) => x.weight ?? 0))
    if (maxW > m.reco.lastW) {
      const d = Math.round((maxW - m.reco.lastW) * 10) / 10
      out.push(`${m.name} ↑ +${d} kg`)
    }
  })
  return out
}

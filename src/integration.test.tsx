import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import App from './App'
import {
  addSetLog,
  discardSession,
  finishSession,
  startSession,
  updateSettings,
} from './data/mutations'
import {
  activeSession,
  activeTargetFor,
  itemsForRoutine,
  lastCompletedSession,
  nextInRotation,
  routineById,
  sessionsForLog,
} from './data/queries'
import { ensureCatalog } from './data/seed'
import { getDb, resetDb, update } from './data/store'
import { newId, type SetLog } from './data/types'
import { suggestedAdjustments } from './engine/insights'
import { restoreState, seedsForRoutine } from './runner/fromStore'
import { nextUnlogged, reduce } from './runner/session'
import type { SessionState } from './runner/types'
import { addItem, setItemRest, setRotation, stepSets } from './screens/RoutineEditor'
import { buildInsightTarget, targetNote } from './screens/insights/helpers'
import { createRoutine, lastSessionLine } from './screens/routineOps'

/**
 * Cross-screen END-TO-END flow. Node env, no DOM: drives the store + the same
 * exported helpers the screens call, and uses renderToString for the few
 * render assertions. Simulates the whole journey a user takes through the four
 * independently-built screens (Sign In → Home/Routines → Editor → Runner →
 * History/Insights → Settings) against a single shared store.
 */

const T0 = 1_750_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN
const WEEK = 7 * 24 * HOUR

/** A well-formed exercise id for a routine item. */
function addRoutineItem(routineId: string, exerciseId: string): string {
  const id = newId('ri')
  update((d) => addItem(d, routineId, exerciseId, id))
  return id
}

/**
 * Replicates Runner.tsx's log path faithfully: for the currently-pointed set
 * it (1) fills a missing strength weight the way the keypad does, (2) computes
 * the same 1-based setNumber Runner computes, (3) writes the SetLog to the
 * store immediately (addSetLog), then (4) advances the in-memory reducer state
 * with the 'log' action carrying that logId. The store setLogs and the reducer
 * state are kept in lock-step exactly as the component keeps them.
 *
 * NOTE: the setNumber computation + SetLog-row assembly live ONLY inside
 * Runner.logActive — there is no extracted helper — so this mirrors them.
 */
function logCurrentSet(
  state: SessionState,
  sessionId: string,
  weightFor: Record<string, number>,
  now: number,
): SessionState {
  const { e, s } = state.ptr
  const ex = state.exercises[e]
  let next = state
  if (ex.kind === 'strength' && next.sets[e][s].weight === null) {
    next = reduce(next, { type: 'typeWeight', value: weightFor[ex.exerciseId ?? ''] ?? 20 })
  }
  const arr = next.sets[e]
  const cur = arr[s]
  const setNumber = arr.slice(0, s + 1).filter((x) => x.isWarmup === cur.isWarmup).length
  const logId = newId('l')
  addSetLog({
    id: logId,
    sessionId,
    exerciseId: ex.exerciseId ?? '',
    exerciseName: ex.name,
    setNumber,
    isWarmup: cur.isWarmup,
    weightKg: cur.weight ?? 0,
    reps: cur.reps,
    rir: cur.rir,
    values: cur.values ? { ...cur.values } : null,
    completedAt: now,
  })
  return reduce(next, { type: 'log', now, settings: getDb().settings, logId })
}

/** Log every remaining set of a restored session, Runner-style. */
function logWholeSession(
  initial: SessionState,
  sessionId: string,
  weightFor: Record<string, number>,
  now: number,
): SessionState {
  let state = initial
  for (let guard = 0; guard < 200 && nextUnlogged(state.sets) !== null; guard++) {
    state = logCurrentSet(state, sessionId, weightFor, now + guard * 1000)
  }
  expect(nextUnlogged(state.sets)).toBeNull()
  return state
}

/** Insert a completed session with plain working-set logs (history fodder). */
function seedCompletedSession(
  routineId: string,
  routineName: string,
  exerciseId: string,
  exerciseName: string,
  sets: Array<{ w: number; reps: number; rir: number | null }>,
  startedAt: number,
): void {
  const sessionId = newId('s')
  update((d) => ({
    ...d,
    sessions: [
      ...d.sessions,
      {
        id: sessionId,
        routineId,
        routineName,
        status: 'completed' as const,
        startedAt,
        finishedAt: startedAt + HOUR,
      },
    ],
    setLogs: [
      ...d.setLogs,
      ...sets.map((s, i) => ({
        id: newId('l'),
        sessionId,
        exerciseId,
        exerciseName,
        setNumber: i + 1,
        isWarmup: false,
        weightKg: s.w,
        reps: s.reps,
        rir: s.rir,
        values: null,
        completedAt: startedAt + i * MIN,
      })),
    ],
  }))
}

function signIn(): void {
  updateSettings({ email: 'lifter@example.com' })
}

beforeEach(() => {
  resetDb()
  ensureCatalog()
})

// ───────────────────────────────────────────────────────────────────────────
// a. No gate: fresh app boots straight to Home (signed out, offline)
// ───────────────────────────────────────────────────────────────────────────

describe('a. no auth gate — signed-out boot lands on Home', () => {
  it('renders the empty Home when signed out (offline, no account)', () => {
    // Signed out on the local backend: the app is fully usable, no gate.
    expect(getDb().settings.email).toBeNull()
    const home = renderToString(<App />)
    // Catalog seeded but no routines → Home first-run empty state (not Sign In).
    expect(home).toContain('No routines yet')
    expect(home).toContain('Create first routine')
    expect(home).not.toContain('Magic code')

    // Signing in later is purely additive — Home still renders.
    signIn()
    expect(getDb().settings.email).toBe('lifter@example.com')
    expect(renderToString(<App />)).toContain('No routines yet')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// b–d, f. Build a routine → run it → History → rotation → discard/double-start
// ───────────────────────────────────────────────────────────────────────────

describe('b-d,f. build → run → history → rotation', () => {
  it('drives the whole workout journey against the shared store', () => {
    signIn()

    // b. Create two routines the way Home/Routines do, populate + rotate them.
    const push = createRoutine('Test Push')
    const pull = createRoutine('Test Pull')
    // createRoutine seeds rest from the app default (90) — b's precondition.
    expect(push.defaultRestSec).toBe(90)

    const benchItem = addRoutineItem(push.id, 'bench-press') // 2 strength…
    addRoutineItem(push.id, 'incline-db-press')
    addRoutineItem(push.id, 'row-erg') // …+ 1 cardio, all from the catalog
    update((d) => stepSets(d, benchItem, 1)) // 3 → 4 sets (edit the scheme)
    update((d) => setItemRest(d, benchItem, 60)) // per-item rest override

    addRoutineItem(pull.id, 'lat-pulldown')

    update((d) => setRotation(d, push.id, true))
    update((d) => setRotation(d, pull.id, true))

    expect(itemsForRoutine(getDb(), push.id)).toHaveLength(3)
    expect(nextInRotation(getDb())?.id).toBe(push.id) // nothing done yet → first

    // c. Start the session (double-start returns the same active session).
    const s1 = startSession(routineById(getDb(), push.id)!, T0)
    expect(startSession(routineById(getDb(), push.id)!, T0).id).toBe(s1.id)
    expect(activeSession(getDb())?.id).toBe(s1.id)

    // First-time exercises: null prescription, no warm-ups, no reco.
    const seeds1 = seedsForRoutine(getDb(), push.id, T0, s1.id)
    expect(seeds1[0].exercise.reco).toBeNull()
    expect(seeds1[0].sets.every((x) => !x.isWarmup)).toBe(true)
    expect(seeds1[0].sets[0].weight).toBeNull()

    // Build the runner state exactly as Runner does (restoreState), log every
    // set with store writes, then finish (Runner.finishNow).
    const initial1 = restoreState(getDb(), s1, T0)
    logWholeSession(initial1, s1.id, { 'bench-press': 60, 'incline-db-press': 22 }, T0 + MIN)
    finishSession(s1.id, T0 + HOUR)

    expect(activeSession(getDb())).toBeNull()
    expect(lastCompletedSession(getDb())?.id).toBe(s1.id)
    expect(lastSessionLine(lastCompletedSession(getDb()))).toContain('Test Push')

    // d. History Log shows the session; bench has its 4 working sets.
    const log1 = sessionsForLog(getDb(), null)
    expect(log1).toHaveLength(1)
    const benchInLog = log1[0].exercises.find((x) => x.exerciseId === 'bench-press')!
    expect(benchInLog.logs).toHaveLength(4)
    expect(benchInLog.logs.every((l) => !l.isWarmup)).toBe(true)

    // f. Rotation advanced past the completed routine.
    expect(nextInRotation(getDb())?.id).toBe(pull.id)

    // d. Second session for the same routine gets a real engine prescription
    // from session-1's logs, with warm-ups now generated and a non-null reason.
    const s2 = startSession(routineById(getDb(), push.id)!, T0 + 2 * HOUR)
    const seeds2 = seedsForRoutine(getDb(), push.id, T0 + 2 * HOUR, s2.id)
    const bench2 = seeds2[0]
    expect(bench2.exercise.reco?.lastW).toBe(60)
    expect(bench2.exercise.reco?.reason).toBeTruthy()
    expect(bench2.exercise.reco?.reason).toContain('Repeat 60')
    const warmups2 = bench2.sets.filter((x) => x.isWarmup)
    expect(warmups2).toHaveLength(2) // 50%×8 + 70%×5 of 60 kg
    expect(warmups2.map((w) => w.weight)).toEqual([30, 42.5])

    // Log session 2 (warm-ups + working) and confirm History excludes warm-ups.
    const initial2 = restoreState(getDb(), s2, T0 + 2 * HOUR)
    logWholeSession(initial2, s2.id, { 'bench-press': 60, 'incline-db-press': 22 }, T0 + 2 * HOUR)
    finishSession(s2.id, T0 + 3 * HOUR)

    const s2View = sessionsForLog(getDb(), null).find((v) => v.session.id === s2.id)!
    const bench2View = s2View.exercises.find((x) => x.exerciseId === 'bench-press')!
    // 2 warm-ups were logged to the store but the History Log excludes them.
    expect(getDb().setLogs.filter((l) => l.sessionId === s2.id && l.isWarmup)).toHaveLength(2)
    expect(bench2View.logs).toHaveLength(4)

    // f. Discard keeps setLogs but frees the active session.
    const s3 = startSession(routineById(getDb(), push.id)!, T0 + 4 * HOUR)
    addSetLog({
      id: 'discard-log',
      sessionId: s3.id,
      exerciseId: 'bench-press',
      exerciseName: 'Bench Press',
      setNumber: 1,
      isWarmup: false,
      weightKg: 62.5,
      reps: 8,
      rir: 2,
      values: null,
      completedAt: T0 + 4 * HOUR,
    })
    discardSession(s3.id, T0 + 4 * HOUR + MIN)
    expect(activeSession(getDb())).toBeNull()
    expect(getDb().setLogs.find((l) => l.id === 'discard-log')).toBeTruthy()
    expect(getDb().sessions.find((s) => s.id === s3.id)?.status).toBe('discarded')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// e. Insights → accept target → surfaces in Runner seed → expiry → filter
// ───────────────────────────────────────────────────────────────────────────

describe('e. insights targets round-trip into the runner', () => {
  it('accepts a suggestion, surfaces it on the seed, then expires it out', () => {
    signIn()

    const routine = createRoutine('Insight Routine')
    // bench target reps 10 (default add), lat target rir 2.
    addRoutineItem(routine.id, 'bench-press')
    const latItem = addRoutineItem(routine.id, 'lat-pulldown')
    // lat default targetRIR is 2 already; leave it.
    void latItem
    update((d) => setRotation(d, routine.id, true))

    // Craft logs (in-window) that trip exactly one lower + one raise.
    const day = 24 * HOUR
    const mk = (
      exerciseId: string,
      exerciseName: string,
      rows: Array<{ w: number; reps: number; rir: number | null }>,
    ): SetLog[] =>
      rows.map((r, i) => ({
        id: newId('l'),
        sessionId: `sess-${exerciseId}`,
        exerciseId,
        exerciseName,
        setNumber: i + 1,
        isWarmup: false,
        weightKg: r.w,
        reps: r.reps,
        rir: r.rir,
        values: null,
        completedAt: T0 - 3 * day,
      }))
    update((d) => ({
      ...d,
      setLogs: [
        // bench: 2/5 sets at RIR 0 (=40%), avg reps 8.6 < 10 → LOWER, −10% → 45
        ...mk('bench-press', 'Bench Press', [
          { w: 50, reps: 8, rir: 0 },
          { w: 50, reps: 8, rir: 0 },
          { w: 50, reps: 9, rir: 1 },
          { w: 50, reps: 9, rir: 1 },
          { w: 50, reps: 9, rir: 2 },
        ]),
        // lat: avg RIR 3 ≥ target(2)+1 → RAISE, +2.5 → 62.5
        ...mk('lat-pulldown', 'Lat Pulldown', [
          { w: 60, reps: 10, rir: 3 },
          { w: 60, reps: 10, rir: 3 },
          { w: 60, reps: 10, rir: 3 },
        ]),
      ],
    }))

    const suggestions = suggestedAdjustments(getDb(), 4, T0)
    expect(suggestions.map((a) => a.kind)).toEqual(['lower', 'raise'])
    const lower = suggestions[0]
    expect(lower).toMatchObject({ exerciseId: 'bench-press', suggestedWeightKg: 45 })
    expect(suggestions[1]).toMatchObject({ exerciseId: 'lat-pulldown', suggestedWeightKg: 62.5 })

    // Accept the lower suggestion the way History.InsightsTab.accept() does.
    const target = buildInsightTarget(
      lower.exerciseId,
      lower.suggestedWeightKg,
      T0,
      targetNote(getDb(), lower.exerciseId),
    )
    update((d) => ({ ...d, targets: [...d.targets, target] }))
    expect(activeTargetFor(getDb(), 'bench-press', T0)?.weightKg).toBe(45)

    // It now surfaces on the runner seed for that exercise.
    const seed = seedsForRoutine(getDb(), routine.id, T0).find(
      (s) => s.exercise.exerciseId === 'bench-press',
    )!
    expect(seed.exercise.target).toMatchObject({ w: 45, weeksLeft: 4 })

    // History filters targeted exercises out of the suggestion list.
    const filtered = suggestedAdjustments(getDb(), 4, T0).filter(
      (a) => !activeTargetFor(getDb(), a.exerciseId, T0),
    )
    expect(filtered.find((a) => a.exerciseId === 'bench-press')).toBeUndefined()
    expect(filtered.map((a) => a.exerciseId)).toEqual(['lat-pulldown'])

    // Expiry: 4 weeks + ε later the target is gone everywhere.
    const later = T0 + 4 * WEEK + 1
    expect(activeTargetFor(getDb(), 'bench-press', later)).toBeNull()
    const seedLater = seedsForRoutine(getDb(), routine.id, later).find(
      (s) => s.exercise.exerciseId === 'bench-press',
    )!
    expect(seedLater.exercise.target).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// g. Settings changes take effect on a fresh seed / runner state
// ───────────────────────────────────────────────────────────────────────────

describe('g. settings reach fresh sessions', () => {
  it('a new routine + seed respect weightIncrementKg and defaultRestSec', () => {
    signIn()
    updateSettings({ weightIncrementKg: 5, defaultRestSec: 120 })

    // createRoutine picks up the app default rest (120), not a hardcoded 90.
    const routine = createRoutine('Heavy Day')
    expect(routineById(getDb(), routine.id)!.defaultRestSec).toBe(120)

    addRoutineItem(routine.id, 'bench-press')
    // Give bench a working history so the seed prescribes a weight → warm-ups.
    seedCompletedSession(
      routine.id,
      'Heavy Day',
      'bench-press',
      'Bench Press',
      [
        { w: 60, reps: 8, rir: 2 },
        { w: 60, reps: 8, rir: 2 },
        { w: 60, reps: 8, rir: 2 },
      ],
      T0 - 3 * 24 * HOUR,
    )

    const seed = seedsForRoutine(getDb(), routine.id, T0)[0]
    // Rest is now override-only on the seed (null = no per-item override); the
    // routine/session/settings default is resolved at log time (§3.4), asserted
    // via the logged-rest endsAt below.
    expect(seed.exercise.restSec).toBeNull()
    // Warm-up rounding respects the 5 kg increment (30 / 40, both multiples of 5).
    const warmups = seed.sets.filter((x) => x.isWarmup)
    expect(warmups.length).toBeGreaterThan(0)
    for (const w of warmups) expect((w.weight ?? 0) % 5).toBe(0)

    // Runner rest actually uses that 120 s fallback when a working set is logged.
    const state: SessionState = {
      exercises: [{ ...seed.exercise, metrics: seed.exercise.metrics ?? null }],
      sets: [
        seed.sets.map((x) => ({
          isWarmup: x.isWarmup ?? false,
          logged: false,
          weight: x.weight,
          reps: x.reps,
          rir: x.rir,
          values: x.values ?? null,
        })),
      ],
      ptr: { e: 0, s: seed.sets.findIndex((x) => !x.isWarmup) },
      resting: null,
      startedAt: T0,
      finishedAt: null,
      finished: false,
    }
    const after = reduce(state, { type: 'log', now: T0, settings: getDb().settings })
    expect(after.resting?.endsAt).toBe(T0 + 120 * 1000)
  })
})

import { describe, expect, it } from 'vitest'
import { fmtClock, fmtMetric, fmtW } from '../lib/format'
import { DEMO_ROUTINE, EXERCISE_DB } from './demo'
import { filterDb } from './components/ExercisePicker'
import {
  applyAdd,
  applySwap,
  createSession,
  logSet,
  moveExercise,
  nextUnlogged,
  nextUnloggedAfter,
  reduce,
  summaryChanges,
  totalVolumeKg,
} from './session'
import { DEFAULT_SETTINGS, type SessionState } from './types'

const T0 = 1_700_000_000_000

function fresh(): SessionState {
  return createSession(DEMO_ROUTINE, T0)
}

describe('createSession', () => {
  it('seeds sets from the routine with warm-up flags and preselected RIR', () => {
    const s = fresh()
    expect(s.sets[0]).toHaveLength(5)
    expect(s.sets[0][0].isWarmup).toBe(true)
    expect(s.sets[0][0].rir).toBeNull()
    expect(s.sets[0][1]).toMatchObject({ weight: 62.5, reps: 8, rir: 2, logged: false })
    expect(s.sets[1][0].weight).toBeNull() // first-time exercise
    expect(s.sets[3][0].values).toEqual({ time: 600, res: 5, pace: 125 })
    expect(s.ptr).toEqual({ e: 0, s: 0 })
  })
})

describe('logSet', () => {
  it('marks the set, advances the pointer, and starts rest for working sets', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = logSet(s, T0, DEFAULT_SETTINGS)
    expect(s.sets[0][1].logged).toBe(true)
    expect(s.ptr).toEqual({ e: 0, s: 2 })
    expect(s.resting).not.toBeNull()
    expect(s.resting!.endsAt).toBe(T0 + 90_000) // bench restSec 90
    expect(s.resting!.nextE).toBe(0)
    expect(s.resting!.nextS).toBe(2)
    expect(s.resting!.exName).toBe('Bench Press')
  })

  it('does not start rest after a warm-up set', () => {
    const s = logSet(fresh(), T0, DEFAULT_SETTINGS) // ptr at warm-up
    expect(s.sets[0][0].logged).toBe(true)
    expect(s.resting).toBeNull()
    expect(s.ptr).toEqual({ e: 0, s: 1 })
  })

  it('does not start rest after a cardio set', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 3, s: 0 } }
    s = logSet(s, T0, DEFAULT_SETTINGS)
    expect(s.sets[3][0].logged).toBe(true)
    expect(s.resting).toBeNull()
  })

  it('seeds remaining empty weights of the same exercise with the logged weight', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 1, s: 0 } }
    s = reduce(s, { type: 'typeWeight', value: 40 })
    s = logSet(s, T0, DEFAULT_SETTINGS)
    expect(s.sets[1][1].weight).toBe(40)
    expect(s.sets[1][2].weight).toBe(40)
    expect(s.sets[1][1].logged).toBe(false)
  })

  it('refuses to log a strength set without a weight', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 1, s: 0 } }
    const after = logSet(s, T0, DEFAULT_SETTINGS)
    expect(after).toBe(s)
  })

  it('uses the routine-default rest when the exercise has none', () => {
    let s = fresh()
    s.exercises[0] = { ...s.exercises[0], restSec: null }
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = logSet(s, T0, DEFAULT_SETTINGS)
    expect(s.resting!.endsAt).toBe(T0 + DEFAULT_SETTINGS.defaultRestSec * 1000)
  })

  it('wraps to the earliest unlogged set when logging the last row', () => {
    let s = fresh()
    // log everything except bench set 1 (index 1), then log the cardio row
    const order: Array<[number, number]> = [
      [0, 0], [0, 2], [0, 3], [0, 4],
      [2, 0], [2, 1], [2, 2],
    ]
    for (const [e, si] of order) {
      s = { ...s, ptr: { e, s: si }, resting: null }
      s = logSet(s, T0, DEFAULT_SETTINGS)
    }
    // incline needs weights
    for (let i = 0; i < 3; i++) {
      s = { ...s, ptr: { e: 1, s: i }, resting: null }
      s = reduce(s, { type: 'typeWeight', value: 20 })
      s = logSet(s, T0, DEFAULT_SETTINGS)
    }
    s = { ...s, ptr: { e: 3, s: 0 }, resting: null }
    s = logSet(s, T0, DEFAULT_SETTINGS)
    expect(s.ptr).toEqual({ e: 0, s: 1 }) // the only remaining unlogged set
  })
})

describe('pointer scanning', () => {
  it('nextUnloggedAfter scans forward only from the given position', () => {
    const s = fresh()
    expect(nextUnloggedAfter(s.sets, 0, 4)).toEqual({ e: 1, s: 0 })
    expect(nextUnloggedAfter(s.sets, 3, 0)).toBeNull()
    expect(nextUnlogged(s.sets)).toEqual({ e: 0, s: 0 })
  })
})

describe('reduce set edits', () => {
  it('steps weight by the given step and clamps at 0', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = reduce(s, { type: 'stepWeight', dir: 1, step: 2.5 })
    expect(s.sets[0][1].weight).toBe(65)
    s = reduce(s, { type: 'typeWeight', value: 1 })
    s = reduce(s, { type: 'stepWeight', dir: -1, step: 2.5 })
    expect(s.sets[0][1].weight).toBe(0)
  })

  it('treats a null weight as 0 when stepping (first-time exercise)', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 1, s: 0 } }
    s = reduce(s, { type: 'stepWeight', dir: 1, step: 2.5 })
    expect(s.sets[1][0].weight).toBe(2.5)
  })

  it('clamps reps at 1 and rounds typed values', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = reduce(s, { type: 'typeReps', value: 0.4 })
    expect(s.sets[0][1].reps).toBe(1)
    s = reduce(s, { type: 'stepReps', dir: -1 })
    expect(s.sets[0][1].reps).toBe(1)
  })

  it('clamps cardio metrics to their min/max', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 3, s: 0 } }
    for (let i = 0; i < 10; i++) s = reduce(s, { type: 'stepMetric', key: 'res', dir: 1 })
    expect(s.sets[3][0].values!.res).toBe(10) // max
    for (let i = 0; i < 20; i++) s = reduce(s, { type: 'stepMetric', key: 'res', dir: -1 })
    expect(s.sets[3][0].values!.res).toBe(1) // min
  })
})

describe('moveExercise', () => {
  it('swaps adjacent exercises with their sets and recomputes the pointer', () => {
    let s = fresh()
    s = moveExercise(s, 0, 1)
    expect(s.exercises[0].name).toBe('Incline DB Press')
    expect(s.exercises[1].name).toBe('Bench Press')
    expect(s.sets[1][0].isWarmup).toBe(true)
    expect(s.ptr).toEqual({ e: 0, s: 0 })
  })

  it('is a no-op at the edges', () => {
    const s = fresh()
    expect(moveExercise(s, 0, -1)).toBe(s)
    expect(moveExercise(s, 3, 1)).toBe(s)
  })

  it('retargets an active rest to the new next set', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = logSet(s, T0, DEFAULT_SETTINGS)
    expect(s.resting).not.toBeNull()
    s = moveExercise(s, 0, 1)
    expect(s.resting!.nextE).toBe(0) // first unlogged is now Incline at index 0
    expect(s.resting!.exName).toBe('Incline DB Press')
  })
})

describe('applySwap', () => {
  const machinePress = EXERCISE_DB.find((d) => d.name === 'Machine Chest Press')!
  const treadmill = EXERCISE_DB.find((d) => d.name === 'Running (Treadmill)')!

  it('keeps logged sets, clears unlogged prescriptions, resets reco', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = logSet(s, T0, DEFAULT_SETTINGS)
    s = applySwap(s, 0, machinePress)
    expect(s.exercises[0].name).toBe('Machine Chest Press')
    expect(s.exercises[0].reco).toBeNull()
    expect(s.exercises[0].scheme).toBe('4×8 @ RIR 2') // scheme kept
    expect(s.sets[0][1].logged).toBe(true)
    expect(s.sets[0][1].weight).toBe(62.5) // performed set untouched
    expect(s.sets[0][2].weight).toBeNull() // unlogged cleared
  })

  it('strength → cardio replaces sets with one metric row', () => {
    let s = fresh()
    s = applySwap(s, 0, treadmill)
    expect(s.exercises[0].kind).toBe('cardio')
    expect(s.sets[0]).toHaveLength(1)
    expect(s.sets[0][0].values).toEqual({ time: 1200, pace: 330, incline: 1 })
  })

  it('cardio → strength creates a fresh 3×10 @ RIR 2', () => {
    let s = fresh()
    s = applySwap(s, 3, machinePress)
    expect(s.exercises[3].kind).toBe('strength')
    expect(s.sets[3]).toHaveLength(3)
    expect(s.sets[3][0]).toMatchObject({ weight: null, reps: 10, rir: 2 })
  })

  it('repoints when the pointer is past the new set count', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 4 } }
    s = applySwap(s, 0, treadmill) // 5 sets -> 1 set
    expect(s.ptr).toEqual({ e: 0, s: 0 })
  })
})

describe('applyAdd', () => {
  it('appends a 3×10 strength exercise to this session', () => {
    const s = applyAdd(fresh(), EXERCISE_DB.find((d) => d.name === 'Lateral Raise')!)
    expect(s.exercises).toHaveLength(5)
    expect(s.exercises[4]).toMatchObject({ name: 'Lateral Raise', kind: 'strength', reco: null })
    expect(s.sets[4]).toHaveLength(3)
  })

  it('appends a cardio exercise with one metric row', () => {
    const s = applyAdd(fresh(), EXERCISE_DB.find((d) => d.name === 'Bike Erg')!)
    expect(s.exercises[4].kind).toBe('cardio')
    expect(s.sets[4][0].values).toEqual({ time: 1200, res: 6, pace: 95 })
  })
})

describe('summary', () => {
  function completed(): SessionState {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = reduce(s, { type: 'typeWeight', value: 65 }) // beat last time's 60
    s = logSet(s, T0, DEFAULT_SETTINGS)
    s = { ...s, ptr: { e: 1, s: 0 }, resting: null }
    s = reduce(s, { type: 'typeWeight', value: 20 })
    s = logSet(s, T0, DEFAULT_SETTINGS)
    return s
  }

  it('computes working volume excluding warm-ups and cardio', () => {
    const s = completed()
    expect(totalVolumeKg(s)).toBe(65 * 8 + 20 * 10)
  })

  it('reports improvements and first logs', () => {
    expect(summaryChanges(completed())).toEqual([
      'Bench Press ↑ +5 kg',
      'Incline DB Press · first log',
    ])
  })
})

describe('rest adjustments', () => {
  it('adjusts endsAt and clears on restEnd', () => {
    let s = fresh()
    s = { ...s, ptr: { e: 0, s: 1 } }
    s = logSet(s, T0, DEFAULT_SETTINGS)
    s = reduce(s, { type: 'restAdjust', deltaMs: 15000 })
    expect(s.resting!.endsAt).toBe(T0 + 105_000)
    s = reduce(s, { type: 'restEnd' })
    expect(s.resting).toBeNull()
  })
})

describe('picker filtering', () => {
  it('excludes in-session exercises and sorts same-muscle first in swap mode', () => {
    const s = fresh()
    const items = filterDb(
      EXERCISE_DB,
      { mode: 'swap', exIdx: 0, query: '', group: 'all', equip: 'all' },
      s.exercises.map((m) => m.name),
      'chest',
    )
    expect(items.some((d) => d.name === 'Bench Press')).toBe(false)
    expect(items[0].muscle).toBe('chest')
    expect(items[0].match).toBe(true)
    const firstNonChest = items.findIndex((d) => d.muscle !== 'chest')
    expect(items.slice(0, firstNonChest).every((d) => d.muscle === 'chest')).toBe(true)
  })

  it('applies query, group, and equipment filters', () => {
    const items = filterDb(
      EXERCISE_DB,
      { mode: 'add', exIdx: null, query: 'press', group: 'all', equip: 'machine' },
      [],
      '',
    )
    expect(items.map((d) => d.name)).toEqual(['Machine Chest Press', 'Smith Machine Press', 'Leg Press'])
  })
})

describe('formatting', () => {
  it('formats clock, weight, and metrics', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(65_000)).toBe('1:05')
    expect(fmtClock(-500)).toBe('0:00')
    expect(fmtW(null)).toBe('—')
    expect(fmtW(62.5)).toBe('62.5')
    expect(fmtW(62.4999)).toBe('62.5')
    expect(
      fmtMetric({ key: 'pace', label: '', step: 5, fmt: 'clock', post: ' /500m', dflt: 0 }, 125),
    ).toBe('2:05 /500m')
    expect(
      fmtMetric({ key: 'res', label: '', step: 1, fmt: 'num', pre: 'lvl ', dflt: 0 }, 5),
    ).toBe('lvl 5')
  })
})

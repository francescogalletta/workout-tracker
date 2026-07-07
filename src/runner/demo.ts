import type { SessionSeed } from './session'
import type { DbExercise } from './types'

/**
 * TEST FIXTURES ONLY. The app builds sessions from the store + engine
 * (src/runner/fromStore.ts); these frozen seeds mirror the handoff prototype
 * and keep the session-logic unit tests independent of the seed catalog.
 */
export const DEMO_ROUTINE: SessionSeed[] = [
  {
    exercise: {
      name: 'Bench Press',
      kind: 'strength',
      scheme: '4×8 @ RIR 2',
      targetReps: 8,
      targetRir: 2,
      restSec: 90,
      muscle: 'chest',
      group: 'chest',
      reco: { lastW: 60, lastMain: '60 kg', lastSub: '4×10 @ RIR 3' },
      target: { w: 62.5, sub: '8 reps @ RIR 2', weeksLeft: 3 },
      plateauText: null,
    },
    sets: [
      { isWarmup: true, weight: 30, reps: 8, rir: null },
      { weight: 62.5, reps: 8, rir: 2 },
      { weight: 62.5, reps: 8, rir: 2 },
      { weight: 62.5, reps: 8, rir: 2 },
      { weight: 62.5, reps: 8, rir: 2 },
    ],
  },
  {
    exercise: {
      name: 'Incline DB Press',
      kind: 'strength',
      scheme: '3×10 @ RIR 2',
      targetReps: 10,
      targetRir: 2,
      restSec: 90,
      muscle: 'chest',
      group: 'chest',
      reco: null,
      target: null,
      plateauText: null,
    },
    sets: [
      { weight: null, reps: 10, rir: 2 },
      { weight: null, reps: 10, rir: 2 },
      { weight: null, reps: 10, rir: 2 },
    ],
  },
  {
    exercise: {
      name: 'Cable Fly',
      kind: 'strength',
      scheme: '3×12 @ RIR 1',
      targetReps: 12,
      targetRir: 1,
      restSec: 60,
      muscle: 'chest',
      group: 'chest',
      reco: { lastW: 25, lastMain: '25 kg', lastSub: '3×12 @ RIR 1' },
      target: null,
      plateauText: 'Plateau — 3rd session at 25 kg. Consider a deload: ~−10% = 22.5 kg.',
    },
    sets: [
      { weight: 25, reps: 12, rir: 1 },
      { weight: 25, reps: 12, rir: 1 },
      { weight: 25, reps: 12, rir: 1 },
    ],
  },
  {
    exercise: {
      name: 'Row Erg',
      kind: 'cardio',
      scheme: '10 min steady',
      targetReps: null,
      targetRir: null,
      restSec: null,
      muscle: 'cardio',
      group: 'cardio',
      metrics: [
        { key: 'time', label: 'Time', step: 60, min: 60, fmt: 'clock', dflt: 600 },
        { key: 'res', label: 'Resistance · level', step: 1, min: 1, max: 10, fmt: 'num', pre: 'lvl ', dflt: 5 },
        { key: 'pace', label: 'Pace · /500m', step: 5, min: 60, fmt: 'clock', post: ' /500m', dflt: 125 },
      ],
      reco: null,
      target: null,
      plateauText: null,
    },
    sets: [{ weight: null, reps: 0, rir: null, values: { time: 600, res: 5, pace: 125 } }],
  },
]

/** Picker database (demo subset; seeded from free-exercise-db later, SPEC §6). */
export const EXERCISE_DB: DbExercise[] = [
  { name: 'Machine Chest Press', muscle: 'chest', group: 'chest', equipment: 'machine' },
  { name: 'Dumbbell Bench Press', muscle: 'chest', group: 'chest', equipment: 'dumbbell' },
  { name: 'Smith Machine Press', muscle: 'chest', group: 'chest', equipment: 'machine' },
  { name: 'Weighted Dip', muscle: 'chest', group: 'chest', equipment: 'body' },
  { name: 'Push-Up', muscle: 'chest', group: 'chest', equipment: 'body' },
  { name: 'Pec Deck', muscle: 'chest', group: 'chest', equipment: 'machine' },
  { name: 'Cable Crossover', muscle: 'chest', group: 'chest', equipment: 'cable' },
  { name: 'Overhead Press', muscle: 'front delts', group: 'shoulders', equipment: 'barbell' },
  { name: 'Lateral Raise', muscle: 'side delts', group: 'shoulders', equipment: 'dumbbell' },
  { name: 'Cable Lateral Raise', muscle: 'side delts', group: 'shoulders', equipment: 'cable' },
  { name: 'Lat Pulldown', muscle: 'lats', group: 'back', equipment: 'cable' },
  { name: 'Seated Cable Row', muscle: 'lats', group: 'back', equipment: 'cable' },
  { name: 'Pull-Up', muscle: 'lats', group: 'back', equipment: 'body' },
  { name: 'Triceps Pushdown', muscle: 'triceps', group: 'arms', equipment: 'cable' },
  { name: 'Biceps Curl', muscle: 'biceps', group: 'arms', equipment: 'dumbbell' },
  { name: 'Skullcrusher', muscle: 'triceps', group: 'arms', equipment: 'barbell' },
  { name: 'Back Squat', muscle: 'quads', group: 'legs', equipment: 'barbell' },
  { name: 'Leg Press', muscle: 'quads', group: 'legs', equipment: 'machine' },
  { name: 'Leg Curl', muscle: 'hamstrings', group: 'legs', equipment: 'machine' },
  {
    name: 'Running (Treadmill)',
    muscle: 'cardio',
    group: 'cardio',
    equipment: 'machine',
    kind: 'cardio',
    metrics: [
      { key: 'time', label: 'Time', step: 60, min: 60, fmt: 'clock', dflt: 1200 },
      { key: 'pace', label: 'Pace · /km', step: 5, min: 120, fmt: 'clock', post: ' /km', dflt: 330 },
      { key: 'incline', label: 'Incline · %', step: 0.5, min: 0, max: 15, fmt: 'num', post: '%', dflt: 1 },
    ],
  },
  {
    name: 'Elliptical',
    muscle: 'cardio',
    group: 'cardio',
    equipment: 'machine',
    kind: 'cardio',
    metrics: [
      { key: 'time', label: 'Time', step: 60, min: 60, fmt: 'clock', dflt: 1200 },
      { key: 'res', label: 'Resistance · level', step: 1, min: 1, max: 20, fmt: 'num', pre: 'lvl ', dflt: 8 },
      { key: 'incline', label: 'Incline · %', step: 0.5, min: 0, max: 20, fmt: 'num', post: '%', dflt: 2 },
    ],
  },
  {
    name: 'Bike Erg',
    muscle: 'cardio',
    group: 'cardio',
    equipment: 'machine',
    kind: 'cardio',
    metrics: [
      { key: 'time', label: 'Time', step: 60, min: 60, fmt: 'clock', dflt: 1200 },
      { key: 'res', label: 'Resistance · level', step: 1, min: 1, max: 10, fmt: 'num', pre: 'lvl ', dflt: 6 },
      { key: 'pace', label: 'Pace · /km', step: 5, min: 60, fmt: 'clock', post: ' /km', dflt: 95 },
    ],
  },
]

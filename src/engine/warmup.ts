import { roundToIncrement } from './round'

/**
 * Auto-suggested warm-up sets (SPEC §5.3).
 * Default scheme: 50% × 8 reps + 70% × 5 reps, each rounded to the weight
 * increment. Very light working weights (< 20 kg) get a single 50% × 8.
 * No working weight (first-time exercise) → no warm-ups.
 */
export interface WarmupSet {
  weightKg: number
  reps: number
}

export function warmupSets(
  workingWeightKg: number | null,
  incrementKg: number,
): WarmupSet[] {
  if (workingWeightKg === null || workingWeightKg <= 0) return []
  const w50 = roundToIncrement(workingWeightKg * 0.5, incrementKg)
  if (workingWeightKg < 20) return [{ weightKg: w50, reps: 8 }]
  return [
    { weightKg: w50, reps: 8 },
    { weightKg: roundToIncrement(workingWeightKg * 0.7, incrementKg), reps: 5 },
  ]
}

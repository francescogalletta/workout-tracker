import { fmtKg, roundToIncrement } from './round'

/**
 * Rule-based weight recommendation (SPEC §5.5). Pure functions over the
 * exercise's working-set history: sessions most-recent-first, warm-ups
 * already excluded.
 *
 * Weights are canonical kg. Assisted exercises store negative weights, so
 * "+1 increment" (toward 0 = less assistance) is progression there too —
 * the arithmetic below intentionally does not special-case them.
 */

export interface WorkingSet {
  weightKg: number
  reps: number
  rir: number | null
}

/** Sessions of working sets for one exercise, most recent first. */
export type WorkingHistory = WorkingSet[][]

export type RecoAction = 'first' | 'increase2' | 'increase1' | 'repeat' | 'decrease'

export interface LastSessionStats {
  /** Representative working weight: most frequent, ties → heavier. */
  weightKg: number
  sets: number
  avgReps: number
  /** Average over sets that recorded RIR; null when none did. */
  avgRir: number | null
  /** e.g. "4×10 @ RIR 3" — the runner's "Last" box sub-line. */
  line: string
}

export interface Prescription {
  action: RecoAction
  /** Prescribed weight; null = first time (empty input, placeholder). */
  weightKg: number | null
  /** One-line reason under the prescription; null for first-time. */
  reason: string | null
  last: LastSessionStats | null
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export function lastSessionStats(sets: WorkingSet[]): LastSessionStats | null {
  if (sets.length === 0) return null
  const counts = new Map<number, number>()
  for (const s of sets) counts.set(s.weightKg, (counts.get(s.weightKg) ?? 0) + 1)
  let weightKg = sets[0].weightKg
  let best = 0
  for (const [w, c] of counts) {
    if (c > best || (c === best && w > weightKg)) {
      best = c
      weightKg = w
    }
  }
  const avgReps = round1(avg(sets.map((s) => s.reps)))
  const rirs = sets.filter((s) => s.rir !== null).map((s) => s.rir as number)
  const avgRir = rirs.length ? round1(avg(rirs)) : null
  const line = `${sets.length}×${fmtKg(avgReps)} @ RIR ${avgRir === null ? '—' : fmtKg(avgRir)}`
  return { weightKg, sets: sets.length, avgReps, avgRir, line }
}

/** surplus = (avg reps − target reps) + (avg RIR − target RIR); no-RIR → 0 RIR term. */
function surplusOf(sets: WorkingSet[], targetReps: number, targetRir: number): number {
  const st = lastSessionStats(sets)
  if (!st) return 0
  const rirTerm = st.avgRir === null ? 0 : st.avgRir - targetRir
  return st.avgReps - targetReps + rirTerm
}

export function prescribe(
  history: WorkingHistory,
  targetReps: number,
  targetRir: number,
  incrementKg: number,
): Prescription {
  const lastSets = history.find((s) => s.length > 0)
  if (!lastSets) return { action: 'first', weightKg: null, reason: null, last: null }

  const last = lastSessionStats(lastSets)!
  const surplus = surplusOf(lastSets, targetReps, targetRir)
  const w = last.weightKg
  const target = `target ${targetReps} @ RIR ${targetRir}`

  if (surplus >= 3) {
    const next = w + 2 * incrementKg
    return {
      action: 'increase2',
      weightKg: next,
      reason: `↑ +${fmtKg(2 * incrementKg)} kg — last time ${last.line} vs ${target}`,
      last,
    }
  }
  if (surplus >= 1) {
    const next = w + incrementKg
    return {
      action: 'increase1',
      weightKg: next,
      reason: `↑ +${fmtKg(incrementKg)} kg — last time ${last.line} vs ${target}`,
      last,
    }
  }
  if (surplus > -1) {
    return {
      action: 'repeat',
      weightKg: w,
      reason: `Repeat ${fmtKg(w)} kg — last time ${last.line} vs ${target}`,
      last,
    }
  }
  // surplus ≤ −1: repeat, unless target reps were missed by ≥2 on multiple sets.
  const badSets = lastSets.filter((s) => s.reps <= targetReps - 2).length
  if (badSets >= 2) {
    const next = w >= 0 ? Math.max(0, w - incrementKg) : w - incrementKg
    return {
      action: 'decrease',
      weightKg: next,
      reason: `↓ −${fmtKg(incrementKg)} kg — missed ${targetReps} reps by 2+ on ${badSets} sets`,
      last,
    }
  }
  return {
    action: 'repeat',
    weightKg: w,
    reason: `Repeat ${fmtKg(w)} kg — last time ${last.line} vs ${target}`,
    last,
  }
}

function ordinal(n: number): string {
  const rem10 = n % 10
  const rem100 = n % 100
  if (rem10 === 1 && rem100 !== 11) return `${n}st`
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`
  return `${n}th`
}

/**
 * Plateau detection: 3+ consecutive sessions at the same weight, each earning
 * "repeat or worse" (surplus < 1). Returns the non-blocking banner text with
 * a ~−10% deload rounded to the increment, or null. Never auto-applies.
 */
export function detectPlateau(
  history: WorkingHistory,
  targetReps: number,
  targetRir: number,
  incrementKg: number,
): string | null {
  const sessions = history.filter((s) => s.length > 0)
  if (sessions.length < 3) return null
  const w = lastSessionStats(sessions[0])!.weightKg
  let streak = 0
  for (const sets of sessions) {
    const st = lastSessionStats(sets)!
    if (Math.abs(st.weightKg - w) > 1e-9) break
    if (surplusOf(sets, targetReps, targetRir) >= 1) break
    streak += 1
  }
  if (streak < 3) return null
  const deload = roundToIncrement(w * 0.9, incrementKg)
  return `Plateau — ${ordinal(streak)} session at ${fmtKg(w)} kg. Consider a deload: ~−10% = ${fmtKg(deload)} kg.`
}

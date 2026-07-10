import type { Db, SetLog } from '../data/types'
import { effectiveRIR } from '../data/types'
import { GROUP_ORDER, WEEK_MS } from '../lib/constants'
import { fmtKg, roundToIncrement } from './round'

/**
 * History › Insights · Plan rules (HANDOFF §4). Pure over the Db snapshot.
 *
 * Over the averaging window (weeks):
 * - LOWER weight when ≥40% of working sets are at RIR 0 AND avg reps < target
 *   → suggest −10%, rounded to 1.25 kg.
 * - ADD weight when avg RIR ≥ target RIR + 1 → suggest +1 increment.
 * Sorted by severity, lower-weight suggestions first.
 *
 * Muscle balance: working sets per week per muscle group vs the 10–20 band.
 */

export interface Adjustment {
  exerciseId: string
  exerciseName: string
  kind: 'lower' | 'raise'
  /** Representative weight of the most recent session in the window. */
  currentWeightKg: number
  suggestedWeightKg: number
  /** e.g. "67% of sets at RIR 0 · avg 9.3 reps vs target 12" */
  detail: string
  /** Higher = more urgent (used for the sort; lower-kind already wins). */
  severity: number
}

export const BALANCE_BAND = { min: 10, max: 20 }

export interface BalanceRow {
  muscleGroup: string
  setsPerWeek: number
  status: 'ok' | 'low'
}

function windowLogs(db: Db, weeks: number, now: number): SetLog[] {
  const from = now - weeks * WEEK_MS
  const strength = new Set(db.exercises.filter((e) => e.kind === 'strength').map((e) => e.id))
  return db.setLogs.filter(
    (l) => !l.isWarmup && l.completedAt >= from && l.completedAt <= now && strength.has(l.exerciseId),
  )
}

/** Most frequent weight of the exercise's most recent session in the window. */
function currentWeight(logs: SetLog[]): number {
  let lastSession = logs[0].sessionId
  let lastT = -Infinity
  for (const l of logs) {
    if (l.completedAt > lastT) {
      lastT = l.completedAt
      lastSession = l.sessionId
    }
  }
  const recent = logs.filter((l) => l.sessionId === lastSession)
  const counts = new Map<number, number>()
  for (const l of recent) counts.set(l.weightKg, (counts.get(l.weightKg) ?? 0) + 1)
  let w = recent[0].weightKg
  let best = 0
  for (const [k, c] of counts) {
    if (c > best || (c === best && k > w)) {
      best = c
      w = k
    }
  }
  return w
}

export function suggestedAdjustments(db: Db, weeks: number, now: number): Adjustment[] {
  const logs = windowLogs(db, weeks, now)
  const byExercise = new Map<string, SetLog[]>()
  for (const l of logs) {
    const arr = byExercise.get(l.exerciseId)
    if (arr) arr.push(l)
    else byExercise.set(l.exerciseId, [l])
  }

  const activeRoutines = new Set(db.routines.filter((r) => !r.archived).map((r) => r.id))
  const out: Adjustment[] = []

  for (const [exerciseId, sets] of byExercise) {
    const item = db.routineItems.find(
      (it) => it.exerciseId === exerciseId && activeRoutines.has(it.routineId),
    )
    if (!item) continue // no prescription to compare against

    const name = db.exercises.find((e) => e.id === exerciseId)?.name ?? sets[0].exerciseName
    const n = sets.length
    const rir0 = sets.filter((s) => s.rir === 0).length
    const frac0 = rir0 / n
    const avgReps = Math.round((sets.reduce((a, s) => a + s.reps, 0) / n) * 10) / 10
    const rirs = sets.filter((s) => s.rir !== null).map((s) => s.rir as number)
    const avgRir = rirs.length ? Math.round((rirs.reduce((a, b) => a + b, 0) / rirs.length) * 10) / 10 : null
    const current = currentWeight(sets)

    const routine = db.routines.find((r) => r.id === item.routineId)
    const targetRir = effectiveRIR(item, routine ?? {})

    if (frac0 >= 0.4 - 1e-9 && avgReps < item.repsPerSet) {
      out.push({
        exerciseId,
        exerciseName: name,
        kind: 'lower',
        currentWeightKg: current,
        suggestedWeightKg: roundToIncrement(current * 0.9, 1.25),
        detail: `${Math.round(frac0 * 100)}% of sets at RIR 0 · avg ${fmtKg(avgReps)} reps vs target ${item.repsPerSet}`,
        severity: frac0,
      })
    } else if (avgRir !== null && avgRir >= targetRir + 1 - 1e-9) {
      out.push({
        exerciseId,
        exerciseName: name,
        kind: 'raise',
        currentWeightKg: current,
        suggestedWeightKg: current + db.settings.weightIncrementKg,
        detail: `avg RIR ${fmtKg(avgRir)} vs target ${targetRir} — room to add weight`,
        severity: avgRir - targetRir,
      })
    }
  }

  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'lower' ? -1 : 1
    return b.severity - a.severity
  })
}

export function muscleBalance(db: Db, weeks: number, now: number): BalanceRow[] {
  const logs = windowLogs(db, weeks, now)
  const groupOf = new Map(db.exercises.map((e) => [e.id, e.muscleGroup]))
  const counts = new Map<string, number>()
  for (const g of db.exercises.map((e) => e.muscleGroup)) {
    if (g !== 'cardio') counts.set(g, 0)
  }
  for (const l of logs) {
    const g = groupOf.get(l.exerciseId)
    if (!g || g === 'cardio') continue
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  const rows: BalanceRow[] = [...counts.entries()].map(([muscleGroup, total]) => {
    const setsPerWeek = Math.round((total / weeks) * 10) / 10
    return {
      muscleGroup,
      setsPerWeek,
      status: setsPerWeek >= BALANCE_BAND.min ? 'ok' : 'low',
    }
  })
  return rows.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.muscleGroup)
    const ib = GROUP_ORDER.indexOf(b.muscleGroup)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.muscleGroup.localeCompare(b.muscleGroup)
  })
}

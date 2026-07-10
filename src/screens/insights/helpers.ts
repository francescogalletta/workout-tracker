import { exerciseById, historyFor, type LogFilter } from '../../data/queries'
import type { Db, Exercise, InsightTarget, Session, SetLog } from '../../data/types'
import { effectiveRIR, newId } from '../../data/types'
import { fmtKg } from '../../engine/round'

/**
 * Pure helpers for the Insights screen (exported for unit tests). All rules
 * live in src/engine/insights.ts + src/data/queries.ts — the screen only
 * presents them and writes the accepted/removed target rows.
 */

const WEEK_MS = 7 * 24 * 3600 * 1000
/** Accepted targets live 4 weeks (HANDOFF §4). */
export const TARGET_WEEKS = 4
/** Canonical muscle-group display order (mirrors the engine's). */
const GROUP_ORDER = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri Jul 4" — weekday + month + day, matching the prototype. */
export function fmtSessionDate(ts: number): string {
  const d = new Date(ts)
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`
}

/** "58 min" for a finished session; "in progress" while still active. */
export function fmtDuration(session: Session): string {
  if (session.finishedAt === null) return 'in progress'
  const mins = Math.max(0, Math.round((session.finishedAt - session.startedAt) / 60000))
  return `${mins} min`
}

/**
 * "m:ss" / "h:mm:ss" from whole seconds. NOT the `lib/format` fmtClock — that
 * one takes milliseconds and has no hours.
 */
function fmtHms(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

/** One-line cardio summary from a set's `values` + the exercise metric defs. */
export function fmtCardio(exercise: Exercise | null, values: Record<string, number> | null): string {
  if (!exercise || !exercise.metrics || !values) return ''
  const parts: string[] = []
  for (const m of exercise.metrics) {
    const v = values[m.key]
    if (v === undefined) continue
    if (m.fmt === 'clock') parts.push(`${m.pre ?? ''}${fmtHms(v)}${m.post ?? ''}`)
    else parts.push(`${m.pre ?? ''}${fmtKg(v)}${m.post ?? ''}`)
  }
  return parts.join(' · ')
}

/** Toggle a candidate filter against the current one (re-picking clears it). */
export function toggleFilter(current: LogFilter, candidate: LogFilter): LogFilter {
  if (!candidate) return null
  if (current && current.type === candidate.type && current.value === candidate.value) return null
  return candidate
}

/** Label for the filter control ("All exercises" / group / exercise name). */
export function filterDisplayLabel(db: Db, filter: LogFilter): string {
  if (!filter) return 'All exercises'
  if (filter.type === 'group') return filter.value
  return exerciseById(db, filter.value)?.name ?? filter.value
}

/** Strength exercises that appear in the log, with group + session count. */
export function logExercises(
  db: Db,
): Array<{ id: string; name: string; group: string; sessions: number }> {
  const out = new Map<string, { id: string; name: string; group: string; sessions: number }>()
  const counted = new Set<string>()
  for (const l of db.setLogs) {
    if (l.isWarmup) continue
    const ex = exerciseById(db, l.exerciseId)
    if (!ex || ex.kind !== 'strength') continue
    let entry = out.get(l.exerciseId)
    if (!entry) {
      entry = { id: l.exerciseId, name: ex.name, group: ex.muscleGroup, sessions: 0 }
      out.set(l.exerciseId, entry)
    }
    const key = `${l.exerciseId}|${l.sessionId}`
    if (!counted.has(key)) {
      counted.add(key)
      entry.sessions += 1
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Muscle groups present in the log, in canonical order. */
export function logGroups(db: Db): string[] {
  const present = new Set<string>()
  for (const e of logExercises(db)) present.add(e.group)
  return [...present].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })
}

/**
 * Exercise-filter summary: "5 sessions · 55 → 62.5 kg" — session count and
 * first→latest max working weight. Null when the exercise has no log.
 */
export function exerciseSummaryLine(db: Db, exerciseId: string): string | null {
  const hist = historyFor(db, exerciseId) // most recent first
  if (hist.length === 0) return null
  const maxW = (logs: SetLog[]) => logs.reduce((m, l) => Math.max(m, l.weightKg), -Infinity)
  const latest = maxW(hist[0].logs)
  const first = maxW(hist[hist.length - 1].logs)
  const n = hist.length
  const noun = n === 1 ? 'session' : 'sessions'
  return `${n} ${noun} · ${fmtKg(first)} → ${fmtKg(latest)} kg`
}

/** "N @ RIR M" from the exercise's active routine item, for the target note. */
export function targetNote(db: Db, exerciseId: string): string {
  const active = new Set(db.routines.filter((r) => !r.archived).map((r) => r.id))
  const item = db.routineItems.find((it) => it.exerciseId === exerciseId && active.has(it.routineId))
  if (!item) return ''
  const routine = db.routines.find((r) => r.id === item.routineId)
  return `${item.repsPerSet} @ RIR ${effectiveRIR(item, routine ?? {})}`
}

/** Build the InsightTarget row an Accept writes (expires 4 weeks out). */
export function buildInsightTarget(
  exerciseId: string,
  weightKg: number,
  now: number,
  note = '',
): InsightTarget {
  return {
    id: newId('t'),
    exerciseId,
    weightKg,
    note,
    createdAt: now,
    expiresAt: now + TARGET_WEEKS * WEEK_MS,
  }
}

/** Whole weeks until a target expires (0 once past). */
export function targetWeeksLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / WEEK_MS))
}

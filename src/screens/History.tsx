import { useState, type UIEvent } from 'react'
import { suggestedAdjustments, muscleBalance, BALANCE_BAND, type Adjustment } from '../engine/insights'
import { fmtKg } from '../engine/round'
import {
  activeTargetFor,
  exerciseById,
  historyFor,
  sessionsForLog,
  type LogFilter,
} from '../data/queries'
import { update, useDb } from '../data/store'
import type { Db, Exercise, InsightTarget, Session, SetLog } from '../data/types'
import { newId } from '../data/types'

/**
 * History (agent D) — recreated from design/prototypes/History.dc.html +
 * HANDOFF §4. Two tabs:
 *  - Log: per-session cards, horizontally-scrollable set tables (kg/reps/RIR),
 *    a filter bottom sheet (muscle group / single exercise), summary line.
 *  - Insights · Plan: 2/4/6/8 wk window chips, suggested adjustments from the
 *    engine, accept → InsightTarget (expires 4 wk), active-target list with
 *    remove, and the muscle-balance list (10–20 band).
 *
 * All rules live in src/engine/insights.ts + src/data/queries.ts — this file
 * only presents them and writes the accepted/removed target rows.
 */

const WEEK_MS = 7 * 24 * 3600 * 1000
/** Accepted targets live 4 weeks (HANDOFF §4). */
export const TARGET_WEEKS = 4
const WINDOWS = [2, 4, 6, 8] as const
/** Canonical muscle-group display order (mirrors the engine's). */
const GROUP_ORDER = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

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

function fmtClock(totalSec: number): string {
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
    if (m.fmt === 'clock') parts.push(`${m.pre ?? ''}${fmtClock(v)}${m.post ?? ''}`)
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
  return item ? `${item.repsPerSet} @ RIR ${item.targetRIR}` : ''
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

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface ScrollState {
  scrolled: boolean
  atEnd: boolean
}

export function History({
  now: nowProp,
  initialView = 'log',
}: { now?: number; initialView?: 'log' | 'insights' } = {}) {
  const db = useDb()
  const [now] = useState(() => nowProp ?? Date.now())
  const [view, setView] = useState<'log' | 'insights'>(initialView)
  const [filter, setFilter] = useState<LogFilter>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [weeks, setWeeks] = useState<number>(4)
  const [scroll, setScroll] = useState<Record<string, ScrollState>>({})

  const isLog = view === 'log'

  return (
    <div className="flex min-h-screen justify-center bg-bg font-mono">
      <div className="box-border flex min-h-screen w-full max-w-[430px] flex-col px-[18px] pt-5 pb-7">
        {/* header */}
        <div className="flex items-baseline pb-[14px]">
          <div className="tt-label text-[17px] font-bold tracking-[0.05em] text-tx">History</div>
        </div>

        {/* view switch */}
        <div className="grid grid-cols-2 gap-[6px] pb-4">
          <TabButton label="Log" active={isLog} onClick={() => setView('log')} />
          <TabButton label="Insights · Plan" active={!isLog} onClick={() => setView('insights')} />
        </div>

        {isLog ? (
          <LogTab
            db={db}
            filter={filter}
            onOpenFilter={() => setFilterOpen(true)}
            onClearFilter={() => setFilter(null)}
            scroll={scroll}
            setScroll={setScroll}
          />
        ) : (
          <InsightsTab db={db} now={now} weeks={weeks} onWeeks={setWeeks} />
        )}
      </div>

      {filterOpen && (
        <FilterSheet
          db={db}
          filter={filter}
          onClose={() => setFilterOpen(false)}
          onPick={(f) => {
            setFilter((cur) => toggleFilter(cur, f))
            setFilterOpen(false)
          }}
        />
      )}
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tt-label flex h-12 cursor-pointer items-center justify-center rounded-rs border font-mono text-[12px] font-bold tracking-[0.06em] ${
        active ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Log tab
// ---------------------------------------------------------------------------

function LogTab({
  db,
  filter,
  onOpenFilter,
  onClearFilter,
  scroll,
  setScroll,
}: {
  db: Db
  filter: LogFilter
  onOpenFilter: () => void
  onClearFilter: () => void
  scroll: Record<string, ScrollState>
  setScroll: (fn: (s: Record<string, ScrollState>) => Record<string, ScrollState>) => void
}) {
  const hasAny = sessionsForLog(db, null).length > 0
  if (!hasAny) {
    return (
      <EmptyState
        title="No workouts yet"
        body="Finish your first workout and every set lands here — weight × reps @ RIR, most recent first."
      />
    )
  }

  const sessions = sessionsForLog(db, filter)
  const summary = filter && filter.type === 'exercise' ? exerciseSummaryLine(db, filter.value) : null

  return (
    <div className="flex flex-col gap-3">
      {/* filter row */}
      <div className="flex items-center gap-[6px]">
        <button
          onClick={onOpenFilter}
          className={`flex h-11 cursor-pointer items-center rounded-full border px-4 font-mono text-[11px] font-bold tracking-[0.08em] whitespace-nowrap uppercase ${
            filter ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
          }`}
        >
          {filterDisplayLabel(db, filter)} ▾
        </button>
        {filter && (
          <button
            onClick={onClearFilter}
            aria-label="Clear filter"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-stepbd bg-stepbg text-[15px] text-mut"
          >
            ×
          </button>
        )}
        <div className="flex-1" />
        {summary && (
          <div className="text-right text-[10px] tracking-[0.04em] text-sec tabular-nums">{summary}</div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="py-6 text-center text-[12px] text-dim">No sets match this filter</div>
      ) : (
        sessions.map((sv) => (
          <SessionCard key={sv.session.id} db={db} view={sv} scroll={scroll} setScroll={setScroll} />
        ))
      )}

      <div className="pt-1 text-center text-[10px] tracking-[0.06em] text-dim uppercase">
        Working sets only · warm-ups excluded · most recent first
      </div>
    </div>
  )
}

function SessionCard({
  db,
  view,
  scroll,
  setScroll,
}: {
  db: Db
  view: { session: Session; exercises: Array<{ exerciseId: string; exerciseName: string; logs: SetLog[] }> }
  scroll: Record<string, ScrollState>
  setScroll: (fn: (s: Record<string, ScrollState>) => Record<string, ScrollState>) => void
}) {
  const { session, exercises } = view
  return (
    <div className="flex flex-col gap-[14px] rounded-rl border border-rowbd bg-rowbg p-[14px]">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-[10px]">
          <div className="tt-label text-[13px] font-bold tracking-[0.04em] text-tx">
            {fmtSessionDate(session.startedAt)}
          </div>
          <div className="tt-label text-[11px] tracking-[0.04em] text-sec">{session.routineName}</div>
        </div>
        <div className="text-[10px] tracking-[0.06em] text-dim uppercase tabular-nums">
          {fmtDuration(session)}
        </div>
      </div>

      {exercises.map((ex) => {
        const exercise = exerciseById(db, ex.exerciseId)
        return (
          <div key={ex.exerciseId} className="flex flex-col gap-2">
            <div className="tt-label text-[11px] font-bold tracking-[0.06em] text-sec">
              {ex.exerciseName}
            </div>
            {exercise?.kind === 'cardio' ? (
              <div className="text-[12px] tracking-[0.02em] text-sec tabular-nums">
                {fmtCardio(exercise, ex.logs[0]?.values ?? null) || '—'}
              </div>
            ) : (
              <SetTable
                logs={ex.logs}
                scrollKey={`${session.id}|${ex.exerciseId}`}
                scroll={scroll}
                setScroll={setScroll}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function SetTable({
  logs,
  scrollKey,
  scroll,
  setScroll,
}: {
  logs: SetLog[]
  scrollKey: string
  scroll: Record<string, ScrollState>
  setScroll: (fn: (s: Record<string, ScrollState>) => Record<string, ScrollState>) => void
}) {
  const st = scroll[scrollKey]
  // Initial guess: >5 columns overflow (56 px + gap ≈ 62 px, ~5.7 visible).
  const moreRight = st ? !st.atEnd : logs.length > 5
  const moreLeft = st ? st.scrolled : false

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8
    const scrolled = el.scrollLeft > 8
    const cur = scroll[scrollKey]
    if (!cur || cur.atEnd !== atEnd || cur.scrolled !== scrolled) {
      setScroll((s) => ({ ...s, [scrollKey]: { atEnd, scrolled } }))
    }
  }

  return (
    <div className="relative flex gap-2">
      {/* row-label gutter */}
      <div className="flex w-[38px] shrink-0 flex-col">
        <div className="h-[18px]" />
        <div className="flex h-[22px] items-center text-[9px] tracking-[0.12em] text-dim uppercase">
          kg
        </div>
        <div className="flex h-[18px] items-center text-[9px] tracking-[0.12em] text-dim uppercase">
          reps
        </div>
        <div className="flex h-[18px] items-center text-[9px] tracking-[0.12em] text-dim uppercase">
          rir
        </div>
      </div>
      <div onScroll={onScroll} className="flex-1 overflow-x-auto">
        <div className="flex min-w-max gap-[6px] pb-1">
          {logs.map((l, i) => (
            <div key={l.id} className="flex w-[56px] shrink-0 flex-col border-l border-bd px-2">
              <div className="flex h-[18px] items-center text-[9px] tracking-[0.1em] text-dim uppercase">
                S{i + 1}
              </div>
              <div className="flex h-[22px] items-center text-[13px] font-bold text-tx tabular-nums">
                {fmtKg(l.weightKg)}
              </div>
              <div className="flex h-[18px] items-center text-[12px] text-sec tabular-nums">{l.reps}</div>
              <div className="flex h-[18px] items-center text-[12px] text-mut tabular-nums">
                {l.rir ?? '–'}
              </div>
            </div>
          ))}
        </div>
      </div>
      {moreLeft && (
        <div
          className="pointer-events-none absolute top-0 bottom-1 left-[46px] flex w-11 items-center justify-start"
          style={{ background: 'linear-gradient(90deg, var(--fadebg, #000), transparent)' }}
        >
          <div className="text-[13px] font-bold text-sec">‹</div>
        </div>
      )}
      {moreRight && (
        <div
          className="pointer-events-none absolute top-0 right-0 bottom-1 flex w-11 items-center justify-end"
          style={{ background: 'linear-gradient(90deg, transparent, var(--fadebg, #000))' }}
        >
          <div className="text-[13px] font-bold text-sec">›</div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter sheet
// ---------------------------------------------------------------------------

function FilterSheet({
  db,
  filter,
  onClose,
  onPick,
}: {
  db: Db
  filter: LogFilter
  onClose: () => void
  onPick: (f: LogFilter) => void
}) {
  const groups = logGroups(db)
  const exercises = logExercises(db)
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-end justify-center bg-black/55">
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up box-border flex max-h-[80vh] w-full max-w-[430px] flex-col gap-3 overflow-y-auto rounded-t-rl border border-cardbd bg-cardbg px-[18px] pt-5 pb-[26px]"
      >
        <div className="text-[11px] tracking-[0.16em] text-mut uppercase">Filter log</div>

        <SheetRule label="Muscle group" />
        <div className="flex flex-wrap gap-[6px]">
          {groups.map((g) => {
            const sel = !!filter && filter.type === 'group' && filter.value === g
            return (
              <button
                key={g}
                onClick={() => onPick({ type: 'group', value: g })}
                className={`flex h-10 cursor-pointer items-center rounded-full border px-[14px] text-[11px] tracking-[0.06em] uppercase ${
                  sel ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
                }`}
              >
                {g}
              </button>
            )
          })}
        </div>

        <SheetRule label="Exercise" />
        <div className="flex flex-col gap-2">
          {exercises.map((e) => {
            const sel = !!filter && filter.type === 'exercise' && filter.value === e.id
            const noun = e.sessions === 1 ? 'session' : 'sessions'
            return (
              <button
                key={e.id}
                onClick={() => onPick({ type: 'exercise', value: e.id })}
                className={`flex cursor-pointer items-center justify-between gap-[10px] rounded-rs border px-[14px] py-[13px] text-left ${
                  sel ? 'border-acc bg-acc' : 'border-rowbd bg-rowbg'
                }`}
              >
                <div
                  className={`tt-label text-[13px] font-bold tracking-[0.03em] ${sel ? 'text-onacc' : 'text-tx'}`}
                >
                  {e.name}
                </div>
                <div
                  className={`text-[10px] tracking-[0.08em] uppercase tabular-nums ${sel ? 'text-onacc' : 'text-dim'}`}
                >
                  {e.group} · {e.sessions} {noun}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SheetRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[10px] pt-[2px]">
      <div className="text-[9px] tracking-[0.2em] whitespace-nowrap text-mut uppercase">{label}</div>
      <div className="h-px flex-1 bg-bd" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Insights · Plan tab
// ---------------------------------------------------------------------------

function InsightsTab({
  db,
  now,
  weeks,
  onWeeks,
}: {
  db: Db
  now: number
  weeks: number
  onWeeks: (w: number) => void
}) {
  const hasAny = db.setLogs.some((l) => !l.isWarmup)
  if (!hasAny) {
    return (
      <EmptyState
        title="Nothing to plan yet"
        body="Suggestions and muscle balance appear after a few logged workouts."
      />
    )
  }

  // Suggestions minus exercises that already have an active target.
  const suggestions = suggestedAdjustments(db, weeks, now).filter(
    (a) => !activeTargetFor(db, a.exerciseId, now),
  )
  const targets = db.targets.filter((t) => t.expiresAt > now)
  const balance = muscleBalance(db, weeks, now)

  const accept = (a: Adjustment) => {
    const target = buildInsightTarget(a.exerciseId, a.suggestedWeightKg, now, targetNote(db, a.exerciseId))
    update((d) => ({ ...d, targets: [...d.targets, target] }))
  }
  const remove = (id: string) => {
    update((d) => ({ ...d, targets: d.targets.filter((t) => t.id !== id) }))
  }

  return (
    <div className="flex flex-col gap-3">
      {/* plan header */}
      <div className="flex flex-col gap-[10px] rounded-rl border border-rowbd bg-rowbg p-[14px]">
        <div className="tt-label text-[13px] font-bold tracking-[0.04em] text-tx">Plan · Build strength</div>
        <div className="text-[11px] leading-relaxed text-mut">
          Suggestions are computed from your log. Accepting one sets a weight target the workout screen
          will show — targets expire after 4 weeks so the plan keeps adjusting.
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] tracking-[0.14em] text-mut uppercase">Averaged over</div>
          <div className="flex gap-[6px]">
            {WINDOWS.map((w) => {
              const sel = weeks === w
              return (
                <button
                  key={w}
                  onClick={() => onWeeks(w)}
                  className={`flex h-11 cursor-pointer items-center rounded-rs border px-3 text-[12px] font-bold tabular-nums ${
                    sel ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
                  }`}
                >
                  {w}wk
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* active targets */}
      <SheetRule label="Active targets" />
      {targets.length === 0 ? (
        <div className="py-2 text-center text-[11px] text-dim">
          No active targets — accept a suggestion below
        </div>
      ) : (
        targets.map((t) => {
          const ex = exerciseById(db, t.exerciseId)
          const left = targetWeeksLeft(t.expiresAt, now)
          const sub = `${t.note ? `${t.note} · ` : ''}${left} wk left`
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-rs border border-rowbd bg-rowbg px-[14px] py-3"
            >
              <div className="flex flex-1 flex-col gap-[3px]">
                <div className="tt-label text-[12px] font-bold tracking-[0.03em] text-tx">
                  {ex?.name ?? t.exerciseId}
                </div>
                <div className="text-[10px] tracking-[0.04em] text-mut tabular-nums">{sub}</div>
              </div>
              <div className="text-[15px] font-extrabold whitespace-nowrap text-numc tabular-nums">
                {fmtKg(t.weightKg)} kg
              </div>
              <button
                onClick={() => remove(t.id)}
                aria-label="Remove target"
                className="flex h-11 w-11 items-center justify-center rounded-rs border border-stepbd bg-stepbg text-[15px] text-mut"
              >
                ×
              </button>
            </div>
          )
        })
      )}

      {/* suggestions */}
      <SheetRule label="Suggested adjustments" />
      {suggestions.length === 0 ? (
        <div className="py-6 text-center text-[12px] text-dim">
          No adjustments suggested — current targets look right
        </div>
      ) : (
        suggestions.map((a) => <SuggestionCard key={a.exerciseId} adj={a} onAccept={() => accept(a)} />)
      )}

      {/* muscle balance */}
      <SheetRule label="Muscle balance · sets per week" />
      <div className="flex flex-col gap-[6px]">
        {balance.map((b) => {
          const low = b.status === 'low'
          return (
            <div
              key={b.muscleGroup}
              className="flex items-center gap-3 rounded-rs border border-rowbd bg-rowbg px-[14px] py-[11px]"
            >
              <div className="w-[84px] text-[11px] font-bold tracking-[0.06em] text-sec uppercase">
                {b.muscleGroup}
              </div>
              <div className="w-[30px] text-[13px] font-extrabold text-numc tabular-nums">
                {fmtKg(b.setsPerWeek)}
              </div>
              <div className="flex-1 text-[10px] tracking-[0.04em] text-dim uppercase tabular-nums">
                band {BALANCE_BAND.min}–{BALANCE_BAND.max}
              </div>
              <div className={`text-[10px] font-bold tracking-[0.08em] uppercase ${low ? 'text-tx' : 'text-dim'}`}>
                {low ? 'Low' : 'OK'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="pt-1 text-center text-[10px] leading-relaxed tracking-[0.04em] text-dim uppercase">
        Lower first: ≥40% of sets at RIR 0 and reps below target
        <br />
        Then add: average RIR ≥ target + 1
      </div>
    </div>
  )
}

function SuggestionCard({ adj, onAccept }: { adj: Adjustment; onAccept: () => void }) {
  const lower = adj.kind === 'lower'
  const action = lower ? '↓ Lower weight' : '↑ Add weight'
  const sugg = `${fmtKg(adj.currentWeightKg)} → ${fmtKg(adj.suggestedWeightKg)} kg`
  return (
    <div className="flex flex-col gap-[10px] rounded-rl border border-cardbd bg-cardbg p-[14px]">
      <div className="flex items-center justify-between gap-[10px]">
        <div className="tt-label text-[13px] font-bold tracking-[0.04em] text-tx">{adj.exerciseName}</div>
        <div
          className={`rounded-full border border-bds px-[9px] py-[6px] text-[9px] font-bold tracking-[0.12em] whitespace-nowrap uppercase ${
            lower ? 'text-tx' : 'text-sec'
          }`}
        >
          {action}
        </div>
      </div>
      <div className="text-[11px] leading-relaxed tracking-[0.02em] text-mut tabular-nums">{adj.detail}</div>
      <button
        onClick={onAccept}
        className="tt-label flex h-[52px] cursor-pointer items-center justify-center rounded-rs border-0 bg-acc text-[13px] font-extrabold tracking-[0.04em] text-onacc tabular-nums"
      >
        Set target · {sugg}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-[10px] px-6 py-[90px] text-center">
      <div className="tt-label text-[13px] font-bold tracking-[0.06em] text-sec">{title}</div>
      <div className="text-[11px] leading-[1.8] text-mut">{body}</div>
    </div>
  )
}

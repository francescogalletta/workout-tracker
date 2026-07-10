import type { UIEvent } from 'react'
import { exerciseById, sessionsForLog, type LogFilter } from '../../data/queries'
import type { Db, Session, SetLog } from '../../data/types'
import { exerciseType } from '../../data/types'
import { fmtKg } from '../../engine/round'
import { fmtDur } from '../../lib/format'
import { EmptyState, SheetRule } from './bits'
import {
  exerciseSummaryLine,
  filterDisplayLabel,
  fmtCardio,
  fmtDuration,
  fmtSessionDate,
  logExercises,
  logGroups,
} from './helpers'

/**
 * The History tab (the workout log): per-session cards, horizontally-scrollable
 * set tables (kg/reps/RIR), a filter bottom sheet (muscle group / single
 * exercise), summary line.
 */

export interface ScrollState {
  scrolled: boolean
  atEnd: boolean
}

export function HistoryTab({
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
        const type = exercise ? exerciseType(exercise) : 'weight'
        return (
          <div key={ex.exerciseId} className="flex flex-col gap-2">
            <div className="tt-label text-[11px] font-bold tracking-[0.06em] text-sec">
              {ex.exerciseName}
              {exercise?.kind !== 'cardio' && type !== 'weight' && (
                <span className="text-dim"> · {type === 'time' ? 'timed' : 'bodyweight'}</span>
              )}
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
                variant={type}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

type SetTableVariant = 'weight' | 'reps' | 'time'

interface SetTableRow {
  label: string
  heightClass: string
  valueClass: string
  value: (l: SetLog) => number | string
}

/** Row-label gutter + per-set value rows, keyed by how the exercise is logged. */
const SET_TABLE_ROWS: Record<SetTableVariant, SetTableRow[]> = {
  weight: [
    {
      label: 'kg',
      heightClass: 'h-[22px]',
      valueClass: 'text-[13px] font-bold text-tx tabular-nums',
      value: (l) => fmtKg(l.weightKg),
    },
    {
      label: 'reps',
      heightClass: 'h-[18px]',
      valueClass: 'text-[12px] text-sec tabular-nums',
      value: (l) => l.reps,
    },
    {
      label: 'rir',
      heightClass: 'h-[18px]',
      valueClass: 'text-[12px] text-mut tabular-nums',
      value: (l) => l.rir ?? '–',
    },
  ],
  reps: [
    {
      label: 'reps',
      heightClass: 'h-[22px]',
      valueClass: 'text-[13px] font-bold text-tx tabular-nums',
      value: (l) => l.reps,
    },
    {
      label: 'rir',
      heightClass: 'h-[18px]',
      valueClass: 'text-[12px] text-mut tabular-nums',
      value: (l) => l.rir ?? '–',
    },
  ],
  time: [
    {
      label: 'time',
      heightClass: 'h-[22px]',
      valueClass: 'text-[13px] font-bold text-tx tabular-nums',
      value: (l) => fmtDur(l.durSec ?? 0),
    },
  ],
}

function SetTable({
  logs,
  scrollKey,
  scroll,
  setScroll,
  variant = 'weight',
}: {
  logs: SetLog[]
  scrollKey: string
  scroll: Record<string, ScrollState>
  setScroll: (fn: (s: Record<string, ScrollState>) => Record<string, ScrollState>) => void
  variant?: SetTableVariant
}) {
  const st = scroll[scrollKey]
  // Initial guess: >5 columns overflow (56 px + gap ≈ 62 px, ~5.7 visible).
  const moreRight = st ? !st.atEnd : logs.length > 5
  const moreLeft = st ? st.scrolled : false
  const rows = SET_TABLE_ROWS[variant]

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
        {rows.map((r) => (
          <div
            key={r.label}
            className={`flex ${r.heightClass} items-center text-[9px] tracking-[0.12em] text-dim uppercase`}
          >
            {r.label}
          </div>
        ))}
      </div>
      <div onScroll={onScroll} className="flex-1 overflow-x-auto">
        <div className="flex min-w-max gap-[6px] pb-1">
          {logs.map((l, i) => (
            <div key={l.id} className="flex w-[56px] shrink-0 flex-col border-l border-bd px-2">
              <div className="flex h-[18px] items-center text-[9px] tracking-[0.1em] text-dim uppercase">
                S{i + 1}
              </div>
              {rows.map((r) => (
                <div key={r.label} className={`flex ${r.heightClass} items-center ${r.valueClass}`}>
                  {r.value(l)}
                </div>
              ))}
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

export function FilterSheet({
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
        className="animate-sheet-up box-border flex max-h-[80vh] w-full max-w-[430px] flex-col gap-3 overflow-y-auto rounded-t-rl border border-cardbd bg-cardbg px-[18px] pt-5 pb-[calc(var(--safe-bottom)+26px)]"
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

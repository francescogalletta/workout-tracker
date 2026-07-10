import { activeTargetFor, exerciseById } from '../../data/queries'
import { update } from '../../data/store'
import type { Db } from '../../data/types'
import { BALANCE_BAND, muscleBalance, suggestedAdjustments, type Adjustment } from '../../engine/insights'
import { fmtKg } from '../../engine/round'
import { EmptyState, SheetRule } from './bits'
import { buildInsightTarget, targetNote, targetWeeksLeft } from './helpers'

const WINDOWS = [2, 4, 6, 8] as const

/**
 * The Plan tab: 2/4/6/8 wk window chips, suggested adjustments from the
 * engine, accept → InsightTarget (expires 4 wk), active-target list with
 * remove, and the muscle-balance list (10–20 band).
 */
export function PlanTab({
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

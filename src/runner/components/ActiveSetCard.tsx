import { fmtMetric, fmtStep, fmtW } from '../../lib/format'
import type { SessionExercise, SetEntry } from '../types'
import { StepButton } from './ui'

export interface ActiveSetCardProps {
  exercise: SessionExercise
  exIdx: number
  entry: SetEntry
  setLabel: string
  step: number
  cardRef: (el: HTMLDivElement | null) => void
  onStepWeight: (dir: 1 | -1) => void
  onHoldStart: () => void
  onHoldEnd: () => void
  onWeightTap: () => void
  onStepReps: (dir: 1 | -1) => void
  onRepsTap: () => void
  onSelectRir: (v: number) => void
  onStepMetric: (key: string, dir: 1 | -1) => void
  onDismissPlateau: () => void
}

/** The current set, expanded inline into the logging card. */
export function ActiveSetCard(p: ActiveSetCardProps) {
  const { exercise: ex, entry } = p
  const isCardio = ex.kind === 'cardio'
  const hasReco = !entry.isWarmup && !isCardio && entry.weight !== null && !!ex.reco

  return (
    <div
      ref={p.cardRef}
      className="flex flex-col gap-[14px] rounded-rl border border-cardbd bg-cardbg p-[16px_14px]"
    >
      <div className="text-[11px] font-bold tracking-[0.16em] text-sec uppercase">{p.setLabel}</div>

      {!isCardio && (
        <div className="flex flex-col gap-[14px]">
          {/* weight */}
          <div className="flex items-center justify-between gap-[10px]">
            <StepButton
              label={`−${fmtStep(p.step)}`}
              onClick={() => p.onStepWeight(-1)}
              onPointerDown={p.onHoldStart}
              onPointerUp={p.onHoldEnd}
              onPointerLeave={p.onHoldEnd}
            />
            <button
              onClick={p.onWeightTap}
              className="flex cursor-pointer flex-col items-center border-0 bg-transparent p-0 font-mono"
            >
              <div
                className="border-b-2 border-dotted border-dim pb-1 text-[52px] leading-none font-extrabold tabular-nums"
                style={{ color: entry.weight === null ? 'var(--dim)' : 'var(--numc)' }}
              >
                {fmtW(entry.weight)}
              </div>
              <div className="mt-[5px] text-[10px] tracking-[0.14em] text-mut uppercase">kg</div>
            </button>
            <StepButton
              label={`+${fmtStep(p.step)}`}
              onClick={() => p.onStepWeight(1)}
              onPointerDown={p.onHoldStart}
              onPointerUp={p.onHoldEnd}
              onPointerLeave={p.onHoldEnd}
            />
          </div>

          {/* recommendation panel */}
          {hasReco && ex.reco ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
              <div className="flex flex-col justify-center gap-[3px] rounded-rs border border-rowbd bg-rowbg p-[10px_12px]">
                <div className="text-[9px] tracking-[0.16em] text-dim uppercase">Last</div>
                <div className="text-[14px] font-bold text-sec tabular-nums">{ex.reco.lastMain}</div>
                <div className="text-[10px] tracking-[0.03em] text-mut tabular-nums">
                  {ex.reco.lastSub}
                </div>
              </div>
              <div className="flex flex-col items-center justify-center gap-[3px] px-[6px]">
                <div className="text-[13px] font-extrabold whitespace-nowrap text-tx tabular-nums">
                  {recoDelta(entry.weight, ex.reco.lastW)}
                </div>
                <div className="text-[11px] text-mut tabular-nums">
                  {recoPct(entry.weight, ex.reco.lastW)}
                </div>
                <div className="text-[8px] tracking-[0.12em] text-dim uppercase">vs last</div>
              </div>
              <div
                className="flex flex-col justify-center gap-[3px] rounded-rs border-bds bg-stepbg p-[10px_12px]"
                style={{ borderWidth: 1, borderStyle: ex.target ? 'solid' : 'dashed' }}
              >
                <div
                  className="text-[9px] tracking-[0.16em] uppercase"
                  style={{ color: ex.target ? 'var(--acc)' : 'var(--dim)' }}
                >
                  {ex.target ? 'Target' : 'No target'}
                </div>
                <div className="text-[14px] font-bold text-tx tabular-nums">
                  {ex.target ? `${fmtW(ex.target.w)} kg` : '—'}
                </div>
                <div className="text-[10px] tracking-[0.03em] text-sec tabular-nums">
                  {ex.target ? `${ex.target.sub} · ${ex.target.weeksLeft} wk left` : 'set in Insights'}
                </div>
              </div>
            </div>
          ) : (
            !entry.isWarmup && (
              <div className="text-center text-[11px] tracking-[0.02em] text-rzn">
                {entry.weight === null
                  ? 'first time — enter weight (tap the number)'
                  : 'first time — enter weight'}
              </div>
            )
          )}

          {/* plateau banner */}
          {!entry.isWarmup && ex.plateauText && (
            <div className="flex items-center justify-between gap-[10px] rounded-rs border border-dashed border-bds p-[10px_12px]">
              <div className="text-[11px] leading-normal text-sec">{ex.plateauText}</div>
              <button
                onClick={p.onDismissPlateau}
                className="cursor-pointer border-0 bg-transparent font-mono text-[10px] tracking-[0.08em] whitespace-nowrap text-dim uppercase underline underline-offset-[3px]"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* reps */}
          <div className="flex items-center justify-between gap-[10px]">
            <StepButton label="−" fontSize={22} onClick={() => p.onStepReps(-1)} />
            <button
              onClick={p.onRepsTap}
              className="flex cursor-pointer flex-col items-center border-0 bg-transparent p-0 font-mono"
            >
              <div className="border-b-2 border-dotted border-dim pb-1 text-[38px] leading-none font-extrabold text-numc tabular-nums">
                {entry.reps}
              </div>
              <div className="mt-[5px] text-[10px] tracking-[0.14em] text-mut uppercase">reps</div>
            </button>
            <StepButton label="+" fontSize={22} onClick={() => p.onStepReps(1)} />
          </div>

          {/* RIR */}
          {!entry.isWarmup && (
            <div className="flex flex-col gap-[6px]">
              <div className="text-[10px] tracking-[0.16em] text-mut uppercase">
                RIR · reps in reserve
              </div>
              <div className="grid grid-cols-5 gap-[6px]">
                {[0, 1, 2, 3, 4].map((v) => {
                  const sel = entry.rir === v
                  return (
                    <button
                      key={v}
                      onClick={() => p.onSelectRir(v)}
                      className={`flex h-12 cursor-pointer items-center justify-center rounded-rs border font-mono text-[15px] ${
                        sel
                          ? 'border-acc bg-acc font-extrabold text-onacc'
                          : 'border-stepbd bg-stepbg font-normal text-sec'
                      }`}
                    >
                      {v === 4 ? '4+' : v}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {isCardio && entry.values && (
        <div className="flex flex-col gap-[14px]">
          {(ex.metrics ?? []).map((d) => (
            <div key={d.key} className="flex items-center justify-between gap-[10px]">
              <StepButton label="−" fontSize={22} onClick={() => p.onStepMetric(d.key, -1)} />
              <div className="flex flex-col items-center">
                <div className="text-[30px] leading-none font-extrabold text-numc tabular-nums">
                  {fmtMetric(d, entry.values![d.key], true)}
                </div>
                <div className="mt-[5px] text-[10px] tracking-[0.14em] text-mut uppercase">
                  {d.label}
                </div>
              </div>
              <StepButton label="+" fontSize={22} onClick={() => p.onStepMetric(d.key, 1)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function recoDelta(weight: number | null, lastW: number): string {
  if (weight === null) return '—'
  const dw = Math.round((weight - lastW) * 100) / 100
  if (dw === 0) return '± 0 kg'
  return `${dw > 0 ? '↑ +' : '↓ −'}${fmtW(Math.abs(dw))} kg`
}

function recoPct(weight: number | null, lastW: number): string {
  if (!lastW || weight === null) return ''
  const pp = Math.round(((weight - lastW) / lastW) * 1000) / 10
  return `${pp > 0 ? '+' : pp < 0 ? '−' : '±'}${Math.abs(pp)}%`
}

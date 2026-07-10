import { useEffect, useRef, useState, type Ref } from 'react'
import { fmtDur, fmtMetric, fmtStep, fmtW } from '../../lib/format'
import { typeOf } from '../session'
import type { SessionExercise, SetEntry } from '../types'
import { RirScale } from './RirScale'
import { StepButton } from './ui'

export interface ActiveSetCardProps {
  exercise: SessionExercise
  exIdx: number
  entry: SetEntry
  setLabel: string
  step: number
  cardRef: Ref<HTMLDivElement>
  onStepWeight: (dir: 1 | -1) => void
  onHoldStart: () => void
  onHoldEnd: () => void
  onTypeWeight: (value: number) => void
  onStepReps: (dir: 1 | -1) => void
  onTypeReps: (value: number) => void
  /** True while a native numeric input is focused — Runner hides the log bar. */
  onEditingChange?: (editing: boolean) => void
  /** Increment to focus the weight field (log-without-weight flow). */
  weightFocusNonce?: number
  onSelectRir: (v: number) => void
  onStepMetric: (key: string, dir: 1 | -1) => void
  onDismissPlateau: () => void
  /** Timed sets (CHANGE_REQUEST §3.3) — the hold/rest timer is owned by Runner. */
  onStepDur: (dir: 1 | -1) => void
  onToggleTimer: () => void
  timerElapsed: number
  timerRunning: boolean
  timerStarted: boolean
}

/** The current set, expanded inline into the logging card. */
export function ActiveSetCard(p: ActiveSetCardProps) {
  const { exercise: ex, entry } = p
  const isCardio = ex.kind === 'cardio'
  const type = typeOf(ex)
  const hasReco = !entry.isWarmup && !isCardio && type === 'weight' && entry.weight !== null && !!ex.reco

  return (
    <div
      ref={p.cardRef}
      className="flex flex-col gap-[14px] rounded-rl border border-cardbd bg-cardbg p-[16px_14px]"
    >
      <div className="text-[11px] font-bold tracking-[0.16em] text-sec uppercase">{p.setLabel}</div>

      {!isCardio && (
        <div className="flex flex-col gap-[14px]">
          {type === 'weight' && (
            <>
              {/* weight */}
              <div className="flex items-center justify-between gap-[10px]">
                <StepButton
                  label={`−${fmtStep(p.step)}`}
                  onClick={() => p.onStepWeight(-1)}
                  onPointerDown={p.onHoldStart}
                  onPointerUp={p.onHoldEnd}
                  onPointerLeave={p.onHoldEnd}
                />
                <NumberField
                  value={entry.weight}
                  display={fmtW(entry.weight)}
                  unit="kg"
                  fontSize={52}
                  inputMode="decimal"
                  dimmed={entry.weight === null}
                  focusNonce={p.weightFocusNonce}
                  onCommit={p.onTypeWeight}
                  onEditingChange={p.onEditingChange}
                />
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
                <NumberField
                  value={entry.reps}
                  display={String(entry.reps)}
                  unit="reps"
                  fontSize={38}
                  inputMode="numeric"
                  onCommit={p.onTypeReps}
                  onEditingChange={p.onEditingChange}
                />
                <StepButton label="+" fontSize={22} onClick={() => p.onStepReps(1)} />
              </div>
            </>
          )}

          {type === 'reps' && (
            /* big reps numeral — no weight stepper, no reco panel, no plateau hint */
            <div className="flex items-center justify-between gap-[10px]">
              <StepButton label="−" fontSize={22} onClick={() => p.onStepReps(-1)} />
              <NumberField
                value={entry.reps}
                display={String(entry.reps)}
                unit="reps"
                fontSize={52}
                inputMode="numeric"
                onCommit={p.onTypeReps}
                onEditingChange={p.onEditingChange}
              />
              <StepButton label="+" fontSize={22} onClick={() => p.onStepReps(1)} />
            </div>
          )}

          {type === 'time' && (
            <TimeBox
              target={entry.durSec ?? 30}
              elapsed={p.timerElapsed}
              running={p.timerRunning}
              started={p.timerStarted}
              onToggle={p.onToggleTimer}
              onStepDur={p.onStepDur}
            />
          )}

          {/* RIR */}
          {type !== 'time' && !entry.isWarmup && (
            <div className="flex flex-col gap-[6px]">
              <div className="text-[10px] tracking-[0.16em] text-mut uppercase">
                RIR · reps in reserve
              </div>
              <RirScale value={entry.rir} onSelect={p.onSelectRir} />
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

/**
 * The big tappable numeral. Idle it renders the styled display value; tapping
 * swaps in a native input styled identically (`inputMode` picks the phone's
 * decimal/number pad; the font is far past iOS's 16px zoom floor). Selects all
 * on focus, commits on blur/Done, reverts on unparsable input — the reducer
 * clamps ranges. `focusNonce` lets Runner focus the weight field when Log is
 * hit without a weight.
 */
function NumberField({
  value,
  display,
  unit,
  fontSize,
  inputMode,
  dimmed = false,
  focusNonce = 0,
  onCommit,
  onEditingChange,
}: {
  value: number | null
  display: string
  unit: string
  fontSize: number
  inputMode: 'decimal' | 'numeric'
  dimmed?: boolean
  focusNonce?: number
  onCommit: (v: number) => void
  onEditingChange?: (editing: boolean) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const seenNonce = useRef(focusNonce)

  // Latest values for the unmount cleanup so it never captures stale closures.
  const textRef = useRef(text)
  const onCommitRef = useRef(onCommit)
  const onEditingChangeRef = useRef(onEditingChange)
  textRef.current = text
  onCommitRef.current = onCommit
  onEditingChangeRef.current = onEditingChange

  const begin = () => {
    setText(value === null ? '' : String(value))
    onEditingChange?.(true)
  }

  useEffect(() => {
    if (focusNonce !== seenNonce.current) {
      seenNonce.current = focusNonce
      begin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  // Unmounting while editing (e.g. tapping another set row keys a remount)
  // fires no blur — commit the in-flight text and release the Runner's Log bar
  // here so the typed value isn't lost and editing state can't strand. The
  // null guard means a normal blur (which nulls textRef) never double-commits.
  useEffect(() => {
    return () => {
      if (textRef.current !== null) {
        const num = parseFloat(textRef.current.replace(',', '.'))
        if (Number.isFinite(num)) onCommitRef.current(num)
        onEditingChangeRef.current?.(false)
        textRef.current = null
      }
    }
  }, [])

  const commit = () => {
    if (textRef.current !== null) {
      const num = parseFloat(textRef.current.replace(',', '.'))
      if (Number.isFinite(num)) onCommit(num)
    }
    textRef.current = null
    setText(null)
    onEditingChange?.(false)
  }

  if (text === null) {
    return (
      <button
        onClick={begin}
        className="flex cursor-pointer flex-col items-center border-0 bg-transparent p-0 font-mono"
      >
        <div
          className="border-b-2 border-dotted border-dim pb-1 leading-none font-extrabold tabular-nums"
          style={{ fontSize, color: dimmed ? 'var(--dim)' : 'var(--numc)' }}
        >
          {display}
        </div>
        <div className="mt-[5px] text-[10px] tracking-[0.14em] text-mut uppercase">{unit}</div>
      </button>
    )
  }
  return (
    <div className="flex flex-col items-center font-mono">
      <input
        autoFocus
        type="text"
        inputMode={inputMode}
        enterKeyHint="done"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          e.target.select()
          const el = e.target
          // After the keyboard animates in, keep the field visible above it.
          requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="w-[4ch] border-0 border-b-2 border-dotted border-acc bg-transparent p-0 pb-1 text-center leading-none font-extrabold text-numc tabular-nums outline-none"
        style={{ fontSize }}
      />
      <div className="mt-[5px] text-[10px] tracking-[0.14em] text-mut uppercase">{unit}</div>
    </div>
  )
}

/**
 * Full-width hold timer for `time`-type sets (CHANGE_REQUEST §3.3). Purely
 * driven by props — Runner owns the running/paused/accumulated-seconds state
 * and re-renders this on its 250ms tick.
 */
function TimeBox({
  target,
  elapsed,
  running,
  started,
  onToggle,
  onStepDur,
}: {
  target: number
  elapsed: number
  running: boolean
  started: boolean
  onToggle: () => void
  onStepDur: (dir: 1 | -1) => void
}) {
  const overtime = started && elapsed >= target
  const overSec = Math.max(0, elapsed - target)
  const fillPct = target > 0 ? Math.min(1, elapsed / target) * 100 : 0
  const overPct = target > 0 ? Math.min(1, overSec / target) * 100 : 0

  let caption = ''
  if (overtime) caption = `+${fmtDur(overSec)} over · keep going`
  else if (started) caption = running ? 'Tap to pause' : 'Paused · tap to resume'

  return (
    <div className="flex flex-col gap-[10px]">
      <button
        onClick={onToggle}
        className="relative flex h-[112px] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[6px] border-0 bg-transparent p-0 font-mono"
        style={{
          border: `1px solid ${overtime ? '#FF6A2B' : 'var(--bds)'}`,
          background: overtime ? 'color-mix(in srgb, var(--acc) 7%, transparent)' : 'transparent',
        }}
      >
        {!overtime && fillPct > 0 && (
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: `${fillPct}%`,
              background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
              borderRight: '2px solid var(--acc)',
            }}
          />
        )}
        {overtime && overPct > 0 && (
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: `${overPct}%`,
              background: 'rgba(255,106,43,0.16)',
              borderRight: '2px solid #FF6A2B',
            }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center gap-[8px]">
          <div
            className="text-[40px] leading-none font-extrabold tabular-nums"
            style={{ color: overtime ? '#FF6A2B' : 'var(--numc)' }}
          >
            {overtime ? `+${fmtDur(overSec)}` : fmtDur(started ? Math.max(0, target - elapsed) : target)}
          </div>
          {!started && (
            <span
              className="rounded-full px-4 py-[6px] text-[11px] font-extrabold tracking-[0.04em] text-acc"
              style={{ border: '1px solid var(--acc)' }}
            >
              ▶ Start
            </span>
          )}
          {caption && (
            <div
              className="text-[11px] tracking-[0.03em]"
              style={{ color: overtime ? '#FF6A2B' : 'var(--mut)' }}
            >
              {caption}
            </div>
          )}
        </div>
      </button>

      <div className="flex gap-[10px]">
        <button
          onClick={() => onStepDur(-1)}
          className="flex h-12 flex-1 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono text-[14px] font-bold text-tx"
        >
          −5s
        </button>
        <button
          onClick={() => onStepDur(1)}
          className="flex h-12 flex-1 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono text-[14px] font-bold text-tx"
        >
          +5s
        </button>
      </div>
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

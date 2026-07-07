import { fmtStep } from '../../lib/format'
import type { SessionState } from '../types'
import { AccentButton, OutlineButton, Sheet } from './ui'

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const

export function KeypadSheet({
  title,
  display,
  dimmed,
  onKey,
  onDone,
  onCancel,
}: {
  title: string
  display: string
  dimmed: boolean
  onKey: (k: string) => void
  onDone: () => void
  onCancel: () => void
}) {
  return (
    <Sheet onClose={onCancel} z={50}>
      <div className="flex items-baseline justify-between pb-[14px]">
        <div className="text-[11px] tracking-[0.16em] text-mut uppercase">{title}</div>
        <div
          className="text-[40px] leading-none font-extrabold tabular-nums"
          style={{ color: dimmed ? 'var(--dim)' : 'var(--acc)' }}
        >
          {display}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYPAD_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => onKey(k)}
            className="flex h-[54px] cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono text-[20px] font-bold text-tx"
          >
            {k}
          </button>
        ))}
      </div>
      <AccentButton label="Done" onClick={onDone} className="mt-[10px] text-[15px]" />
    </Sheet>
  )
}

const STEP_OPTIONS = [0.5, 1, 1.25, 2.5, 5]

export function StepChooserSheet({
  current,
  onPick,
  onClose,
}: {
  current: number
  onPick: (v: number) => void
  onClose: () => void
}) {
  return (
    <Sheet onClose={onClose} z={55}>
      <div className="pb-[14px] text-[11px] tracking-[0.16em] text-mut uppercase">
        Weight step · kg
      </div>
      <div className="grid grid-cols-5 gap-2">
        {STEP_OPTIONS.map((v) => (
          <button
            key={v}
            onClick={() => onPick(v)}
            className={`flex h-[52px] cursor-pointer items-center justify-center rounded-rs border font-mono text-[16px] font-bold tabular-nums ${
              current === v ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-tx'
            }`}
          >
            {fmtStep(v)}
          </button>
        ))}
      </div>
      <div className="pt-[14px] text-center text-[10px] tracking-[0.06em] text-dim uppercase">
        Applies to the ± buttons · hold any ± to reopen
      </div>
    </Sheet>
  )
}

export function ReorderSheet({
  state,
  onMove,
  onClose,
}: {
  state: SessionState
  onMove: (index: number, dir: 1 | -1) => void
  onClose: () => void
}) {
  return (
    <Sheet onClose={onClose} z={46}>
      <div className="flex flex-col gap-2">
        <div className="pb-[6px] text-[11px] tracking-[0.16em] text-mut uppercase">
          Exercise order · today's session
        </div>
        {state.exercises.map((m, i) => {
          const arr = state.sets[i]
          const done = arr.filter((x) => x.logged).length
          return (
            <div key={`${m.name}-${i}`} className="flex items-center gap-2">
              <div className="flex flex-1 flex-col gap-[3px] rounded-rs border border-rowbd bg-rowbg p-[10px_14px]">
                <div className="text-[13px] font-bold tracking-[0.03em] text-tx uppercase">
                  {m.name}
                </div>
                <div className="text-[10px] tracking-[0.06em] text-mut uppercase tabular-nums">
                  {done}/{arr.length} sets done
                </div>
              </div>
              <button
                onClick={() => onMove(i, -1)}
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono text-[15px]"
                style={{ color: i === 0 ? 'var(--dim)' : 'var(--tx)' }}
              >
                ↑
              </button>
              <button
                onClick={() => onMove(i, 1)}
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono text-[15px]"
                style={{ color: i === state.exercises.length - 1 ? 'var(--dim)' : 'var(--tx)' }}
              >
                ↓
              </button>
            </div>
          )
        })}
        <AccentButton label="Done" onClick={onClose} className="mt-2" />
        <div className="text-center text-[10px] tracking-[0.06em] text-dim uppercase">
          Reorders this session only — routine unchanged
        </div>
      </div>
    </Sheet>
  )
}

export function SwapConfirmSheet({
  name,
  onSession,
  onRoutine,
  onCancel,
}: {
  name: string
  onSession: () => void
  onRoutine: () => void
  onCancel: () => void
}) {
  return (
    <Sheet onClose={onCancel} z={48}>
      <div className="flex flex-col gap-[10px]">
        <div className="pb-[6px] text-[13px] font-extrabold tracking-[0.04em] text-tx uppercase">
          Swap to {name}
        </div>
        <AccentButton label="This session only" onClick={onSession} />
        <OutlineButton label="Also update routine" onClick={onRoutine} />
        <button
          onClick={onCancel}
          className="cursor-pointer border-0 bg-transparent p-[10px_0_2px] text-center font-mono text-[12px] tracking-[0.08em] text-mut uppercase"
        >
          Cancel
        </button>
      </div>
    </Sheet>
  )
}

const REST_SESSION_OPTIONS = [60, 90, 120, 150]

/** Session-scoped rest default picker (CHANGE_REQUEST §3.4). */
export function RestSessionSheet({
  current,
  onPick,
  onClose,
}: {
  current: number
  onPick: (sec: number) => void
  onClose: () => void
}) {
  return (
    <Sheet onClose={onClose} z={52}>
      <div className="flex flex-col gap-2">
        <div className="pb-[6px] text-[11px] tracking-[0.16em] text-mut uppercase">
          Rest · this session
        </div>
        <div className="grid grid-cols-4 gap-2">
          {REST_SESSION_OPTIONS.map((v) => (
            <button
              key={v}
              onClick={() => onPick(v)}
              className={`flex h-[52px] cursor-pointer items-center justify-center rounded-rs border font-mono text-[16px] font-bold tabular-nums ${
                current === v ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
              }`}
            >
              {v}s
            </button>
          ))}
        </div>
        <div className="pt-[10px] text-center text-[10px] tracking-[0.06em] text-dim uppercase">
          Applies to all remaining rests today. Exercises with their own rest keep it. Your saved
          default stays unchanged.
        </div>
      </div>
    </Sheet>
  )
}

export function FinishConfirmSheet({
  workingSets,
  onFinish,
  onKeepGoing,
}: {
  workingSets: number
  onFinish: () => void
  onKeepGoing: () => void
}) {
  return (
    <Sheet onClose={onKeepGoing} z={65}>
      <div className="flex flex-col gap-[10px]">
        <div className="text-[13px] font-extrabold tracking-[0.04em] text-tx uppercase">
          Finish workout?
        </div>
        <div className="pb-1 text-[12px] text-mut">{workingSets} working sets logged so far</div>
        <AccentButton label="Finish workout" onClick={onFinish} />
        <OutlineButton label="Keep going" onClick={onKeepGoing} />
      </div>
    </Sheet>
  )
}

import { fmtClock, fmtDur, fmtW } from '../../lib/format'
import { typeOf } from '../session'
import type { RestState, SessionState } from '../types'

export function RestOverlay({
  state,
  rest,
  now,
  onAdjust,
  onSkip,
}: {
  state: SessionState
  rest: RestState
  now: number
  onAdjust: (deltaMs: number) => void
  onSkip: () => void
}) {
  const ns = state.sets[rest.nextE][rest.nextS]
  const nEx = state.exercises[rest.nextE]
  const arr = state.sets[rest.nextE]
  const wIdx = arr.slice(0, rest.nextS + 1).filter((x) => !x.isWarmup).length
  const wTot = arr.filter((x) => !x.isWarmup).length

  let nextTop: string
  let nextMain: string
  let nextLast = ''
  const nType = typeOf(nEx)
  if (nEx.kind === 'cardio') {
    nextTop = 'Next · Cardio'
    nextMain = nEx.name
  } else {
    nextTop = ns.isWarmup ? 'Next · Warm-up' : `Next · Set ${wIdx} of ${wTot}`
    if (nType === 'reps') {
      nextMain = `${ns.reps} reps${ns.isWarmup ? '' : ` @ RIR ${nEx.targetRir}`}`
    } else if (nType === 'time') {
      nextMain = ns.isWarmup ? fmtDur(ns.durSec ?? null) : `${fmtDur(ns.durSec ?? null)} target`
    } else {
      nextMain = `${fmtW(ns.weight)} kg × ${ns.reps}${ns.isWarmup ? '' : ` @ RIR ${nEx.targetRir}`}`
    }
    if (!ns.isWarmup && nType === 'weight' && nEx.reco) {
      nextLast = `Last · ${nEx.reco.lastMain} · ${nEx.reco.lastSub}`
    }
  }

  return (
    <div className="animate-ovl-up fixed inset-0 z-40 flex justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col pt-[calc(var(--safe-top)+28px)] pr-[max(20px,var(--safe-right))] pb-[calc(var(--safe-bottom)+28px)] pl-[max(20px,var(--safe-left))]">
        <div className="flex justify-between">
          <div className="text-[11px] tracking-[0.18em] text-mut uppercase">Rest</div>
          <div className="text-[11px] tracking-[0.08em] text-dim uppercase">{rest.exName}</div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-[30px]">
          <div className="text-[104px] leading-none font-extrabold text-acc tabular-nums">
            {fmtClock(rest.endsAt - now)}
          </div>
          <div className="flex flex-col items-center gap-[7px] rounded-rl border border-cardbd bg-cardbg p-[16px_26px]">
            <div className="text-[10px] tracking-[0.16em] text-mut uppercase">{nextTop}</div>
            <div className="text-[20px] font-bold text-tx tabular-nums">{nextMain}</div>
            {nextLast && (
              <div className="text-[11px] tracking-[0.03em] text-mut tabular-nums">{nextLast}</div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <button
            onClick={() => onAdjust(-15000)}
            className="flex h-[60px] cursor-pointer items-center justify-center rounded-rl border border-stepbd bg-stepbg font-mono text-[15px] font-bold text-tx"
          >
            −15s
          </button>
          <button
            onClick={() => onAdjust(15000)}
            className="flex h-[60px] cursor-pointer items-center justify-center rounded-rl border border-stepbd bg-stepbg font-mono text-[15px] font-bold text-tx"
          >
            +15s
          </button>
          <button
            onClick={onSkip}
            className="flex h-[60px] cursor-pointer items-center justify-center rounded-rl border-0 bg-[#1A1A1A] font-mono text-[15px] font-bold text-sec uppercase"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

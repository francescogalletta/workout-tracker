import { fmtClock } from '../../lib/format'
import { loggedWorkingSets, summaryChanges, totalVolumeKg } from '../session'
import type { SessionState } from '../types'
import { AccentButton } from './ui'

export function SummaryScreen({
  state,
  routineName,
  onDone,
}: {
  state: SessionState
  routineName: string
  onDone: () => void
}) {
  const sets = loggedWorkingSets(state).length
  const vol = Math.round(totalVolumeKg(state)).toLocaleString('en-US')
  const changes = summaryChanges(state)
  const elapsed = (state.finishedAt ?? state.startedAt) - state.startedAt

  return (
    <div className="animate-ovl-up fixed inset-0 z-60 flex justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col items-center justify-center gap-[14px] p-[28px_20px]">
        <div className="text-[11px] tracking-[0.2em] text-mut uppercase">
          {routineName} · Complete
        </div>
        <div className="text-[64px] leading-none font-extrabold text-acc tabular-nums">
          {fmtClock(elapsed)}
        </div>
        <div className="text-[14px] tracking-[0.03em] text-sec tabular-nums">
          {sets} working sets · {vol} kg total volume
        </div>
        {changes.length > 0 && (
          <div className="text-center text-[12px] tracking-[0.03em] text-mut tabular-nums">
            {changes.join(' · ')}
          </div>
        )}
        <div className="mt-[26px] w-full max-w-[320px]">
          <AccentButton label="Done" onClick={onDone} className="text-[15px]" />
        </div>
      </div>
    </div>
  )
}

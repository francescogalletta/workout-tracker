import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  REST_COARSE_STEP,
  REST_FINE_STEP,
  REST_MAX,
  REST_MIN,
  REST_TICKS,
  clampRest,
  isFineDrag,
  posToSec,
  secToFrac,
  snapRest,
} from './restSliderMath'

/**
 * Shared horizontal rest slider (30s–3min). Coarse 30s detents; slide slowly
 * or press-hold before moving for 5s increments. Live value while dragging,
 * committed on release only — commits can be destructive upstream
 * (setDefaultRest resets per-item overrides) and each one is a persist/sync
 * write. Keyboard: ←/→ ±5s, PageUp/Down ±30s, Home/End.
 *
 * `onUseDefault` (with `defaultSec`/`isDefault`) renders the per-item
 * "Use default" escape hatch that reverts the override to null.
 */
export function RestSlider({
  sec,
  onCommit,
  isDefault = false,
  defaultSec,
  onUseDefault,
}: {
  /** Committed (effective) seconds shown when not dragging. */
  sec: number
  onCommit: (sec: number) => void
  isDefault?: boolean
  defaultSec?: number
  onUseDefault?: () => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{
    downAt: number
    movedAt: number
    lastX: number
    moved: boolean
    fine: boolean
  } | null>(null)
  const [dragSec, setDragSec] = useState<number | null>(null)

  const shown = dragSec ?? clampRest(sec)
  const frac = secToFrac(shown)

  const secFromEvent = (e: ReactPointerEvent, fine: boolean): number => {
    const el = trackRef.current
    if (!el) return shown
    const rect = el.getBoundingClientRect()
    return snapRest(posToSec(e.clientX - rect.left, rect.width), fine)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { downAt: e.timeStamp, movedAt: e.timeStamp, lastX: e.clientX, moved: false, fine: false }
    setDragSec(secFromEvent(e, false))
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dt = e.timeStamp - d.movedAt
    const velocity = dt > 0 ? (e.clientX - d.lastX) / dt : 0
    if (!d.moved && Math.abs(e.clientX - d.lastX) < 3) {
      // Still holding in place; a long enough hold arms fine mode.
      d.fine = isFineDrag(Infinity, e.timeStamp - d.downAt)
    } else {
      d.moved = true
      d.fine = isFineDrag(velocity, d.moved ? 0 : e.timeStamp - d.downAt) || d.fine
      // Speeding back up leaves fine mode so long coarse sweeps stay coarse.
      if (Math.abs(velocity) > 1) d.fine = false
    }
    d.movedAt = e.timeStamp
    d.lastX = e.clientX
    setDragSec(secFromEvent(e, d.fine))
  }

  const endDrag = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    const v = secFromEvent(e, d.fine)
    setDragSec(null)
    onCommit(v)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowLeft: -REST_FINE_STEP,
      ArrowRight: REST_FINE_STEP,
      ArrowDown: -REST_FINE_STEP,
      ArrowUp: REST_FINE_STEP,
      PageDown: -REST_COARSE_STEP,
      PageUp: REST_COARSE_STEP,
    }
    let next: number | null = null
    if (e.key in steps) next = clampRest(shown + steps[e.key])
    else if (e.key === 'Home') next = REST_MIN
    else if (e.key === 'End') next = REST_MAX
    if (next !== null && next !== shown) {
      e.preventDefault()
      onCommit(next)
    }
  }

  return (
    <div className="flex w-full flex-col gap-[6px]">
      <div className="flex items-center gap-3">
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative h-10 flex-1 cursor-pointer select-none"
          style={{ touchAction: 'none' }}
        >
          {/* rail */}
          <div className="absolute top-1/2 right-0 left-0 h-[6px] -translate-y-1/2 rounded-full border border-stepbd bg-stepbg" />
          {/* fill */}
          <div
            className="absolute top-1/2 left-0 h-[6px] -translate-y-1/2 rounded-full bg-acc"
            style={{ width: `${frac * 100}%` }}
          />
          {/* coarse detent ticks */}
          {REST_TICKS.map((t) => (
            <div
              key={t}
              className="absolute top-1/2 h-[12px] w-px -translate-y-1/2 bg-bds"
              style={{ left: `${secToFrac(t) * 100}%` }}
            />
          ))}
          {/* thumb */}
          <div
            role="slider"
            tabIndex={0}
            aria-valuemin={REST_MIN}
            aria-valuemax={REST_MAX}
            aria-valuenow={shown}
            aria-valuetext={`${shown} seconds`}
            aria-label="Rest seconds"
            onKeyDown={onKeyDown}
            className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-acc bg-acc outline-offset-2"
            style={{ left: `${frac * 100}%` }}
          />
        </div>
        <div
          className="w-[52px] text-right text-[18px] font-extrabold tabular-nums"
          style={{ color: dragSec !== null ? 'var(--acc)' : 'var(--tx)' }}
        >
          {shown}s
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[9px] tracking-[0.06em] text-dim uppercase">
          Slide slow or hold for 5s steps
        </div>
        {onUseDefault && (
          <button
            onClick={onUseDefault}
            className={`flex h-[30px] cursor-pointer items-center rounded-rs border px-[10px] font-mono text-[11px] font-bold tabular-nums ${
              isDefault ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
            }`}
          >
            Default · {defaultSec}s
          </button>
        )}
      </div>
    </div>
  )
}

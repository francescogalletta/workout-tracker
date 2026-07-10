import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  FINE_HOLD_MS,
  FINE_RESET_PX_MS,
  FINE_SLOW_SUSTAIN_MS,
  REST_COARSE_STEP,
  REST_FINE_STEP,
  REST_MAX,
  REST_MIN,
  REST_TICKS,
  clampRest,
  posToSec,
  secToFrac,
  slowStreak,
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
    slowMs: number
    rect: DOMRect
  } | null>(null)
  const [dragSec, setDragSec] = useState<number | null>(null)

  const committed = clampRest(sec)
  const shown = dragSec ?? committed
  const frac = secToFrac(shown)

  const secFromPos = (clientX: number, rect: DOMRect, fine: boolean): number =>
    snapRest(posToSec(clientX - rect.left, rect.width), fine)

  const onPointerDown = (e: ReactPointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // Measure the track rect once per gesture, not per pointermove.
    drag.current = {
      downAt: e.timeStamp,
      movedAt: e.timeStamp,
      lastX: e.clientX,
      moved: false,
      fine: false,
      slowMs: 0,
      rect,
    }
    setDragSec(secFromPos(e.clientX, rect, false))
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dt = e.timeStamp - d.movedAt
    const velocity = dt > 0 ? (e.clientX - d.lastX) / dt : 0
    if (!d.moved && Math.abs(e.clientX - d.lastX) < 3) {
      // Still holding in place; a long enough press-hold arms fine mode.
      if (e.timeStamp - d.downAt >= FINE_HOLD_MS) d.fine = true
    } else {
      d.moved = true
      // Fine mode arms only from *sustained* slow movement, never a single slow
      // sample at end-of-sweep deceleration.
      d.slowMs = slowStreak(d.slowMs, dt, velocity)
      if (d.slowMs >= FINE_SLOW_SUSTAIN_MS) d.fine = true
      // A clear fast flick leaves fine mode so long coarse sweeps stay coarse.
      if (Math.abs(velocity) > FINE_RESET_PX_MS) d.fine = false
    }
    d.movedAt = e.timeStamp
    d.lastX = e.clientX
    setDragSec(secFromPos(e.clientX, d.rect, d.fine))
  }

  const endDrag = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    const v = secFromPos(e.clientX, d.rect, d.fine)
    setDragSec(null)
    // Idle taps / no-movement releases at the current value must not commit —
    // upstream a commit resets every per-exercise override.
    if (v !== committed) onCommit(v)
  }

  // An OS-cancelled gesture (system swipe, incoming call, a scroll that started
  // on the track) discards the in-flight value instead of persisting it.
  const cancelDrag = () => {
    drag.current = null
    setDragSec(null)
  }

  // Keyboard stepping accumulates into `dragSec` and commits once — on keyup of
  // the stepping key or on blur — so autorepeat isn't a per-press commit storm.
  const stepFor = (key: string): number | null => {
    switch (key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        return -REST_FINE_STEP
      case 'ArrowRight':
      case 'ArrowUp':
        return REST_FINE_STEP
      case 'PageDown':
        return -REST_COARSE_STEP
      case 'PageUp':
        return REST_COARSE_STEP
      default:
        return null
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = stepFor(e.key)
    let next: number | null = null
    if (delta !== null) next = clampRest(shown + delta)
    else if (e.key === 'Home') next = REST_MIN
    else if (e.key === 'End') next = REST_MAX
    if (next !== null) {
      e.preventDefault()
      if (next !== shown) setDragSec(next)
    }
  }

  const commitKeyboard = () => {
    const pending = dragSec
    setDragSec(null)
    if (pending !== null && pending !== committed) onCommit(pending)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (stepFor(e.key) !== null || e.key === 'Home' || e.key === 'End') commitKeyboard()
  }

  return (
    <div className="flex w-full flex-col gap-[6px]">
      <div className="flex items-center gap-3">
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          className="relative h-10 flex-1 cursor-pointer select-none"
          // pan-y: a vertical scroll that starts on the track becomes a browser
          // scroll (firing pointercancel, which discards) instead of a drag.
          style={{ touchAction: 'pan-y' }}
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
            onKeyUp={onKeyUp}
            onBlur={commitKeyboard}
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

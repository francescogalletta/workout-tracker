import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** True once the pointer has wandered more than `slopPx` from where it went down. */
export function exceedsSlop(dx: number, dy: number, slopPx: number): boolean {
  return dx * dx + dy * dy > slopPx * slopPx
}

export interface LongPressOptions {
  ms?: number
  slopPx?: number
}

/**
 * Pointer-based long-press. Movement beyond the slop radius cancels the press,
 * so starting a scroll on the element never fires it. `firedRef` stays true
 * from the moment the press fires until the next pointerdown — the element's
 * `onClick` should bail when it is set, because the browser still delivers a
 * click after pointerup.
 */
export function useLongPress(
  onLongPress: () => void,
  { ms = 500, slopPx = 8 }: LongPressOptions = {},
) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    origin.current = null
  }

  return {
    firedRef,
    handlers: {
      onPointerDown: (e: ReactPointerEvent) => {
        firedRef.current = false
        origin.current = { x: e.clientX, y: e.clientY }
        timer.current = window.setTimeout(() => {
          timer.current = null
          firedRef.current = true
          onLongPress()
        }, ms)
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (
          origin.current &&
          exceedsSlop(e.clientX - origin.current.x, e.clientY - origin.current.y, slopPx)
        ) {
          cancel()
        }
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
  }
}

import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

/**
 * Which list index a row dragged by `dy` px should land on. Rows are assumed
 * uniform `rowHeight` px (the routine editor collapses any expanded card when
 * a drag starts, so this holds).
 */
export function dragTargetIndex(
  startIdx: number,
  dy: number,
  rowHeight: number,
  count: number,
): number {
  if (rowHeight <= 0 || count <= 0) return startIdx
  const shift = Math.round(dy / rowHeight)
  return Math.max(0, Math.min(count - 1, startIdx + shift))
}

export interface DragState {
  from: number
  to: number
  dy: number
}

/**
 * Handle-based vertical drag-to-reorder for a uniform-row list. Attach
 * `handleProps(i)` to each row's drag handle only (NOT the row body — rows
 * must keep scrolling and tapping normally); style rows with `rowStyle(i)`.
 * The handle needs `touch-action: none` (included in the returned style) so
 * dragging never scrolls the page; pointer capture keeps the gesture alive
 * outside the handle. Commit fires on release with (from, to).
 */
export function useDragReorder(
  count: number,
  onCommit: (from: number, to: number) => void,
  onDragStart?: () => void,
) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const info = useRef<{ from: number; startY: number; rowH: number; lastDy: number } | null>(null)

  const end = () => {
    const i = info.current
    info.current = null
    setDrag(null)
    if (!i) return
    const to = dragTargetIndex(i.from, i.lastDy, i.rowH, count)
    if (to !== i.from) onCommit(i.from, to)
  }

  const handleProps = (index: number) => ({
    style: { touchAction: 'none' } as CSSProperties,
    onPointerDown: (e: ReactPointerEvent) => {
      const row = (e.currentTarget as HTMLElement).closest('[data-drag-row]')
      const gap = 8 // list gap-2
      const rowH = row ? row.getBoundingClientRect().height + gap : 74
      e.currentTarget.setPointerCapture(e.pointerId)
      info.current = { from: index, startY: e.clientY, rowH, lastDy: 0 }
      onDragStart?.()
      setDrag({ from: index, to: index, dy: 0 })
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const i = info.current
      if (!i) return
      i.lastDy = e.clientY - i.startY
      setDrag({ from: i.from, to: dragTargetIndex(i.from, i.lastDy, i.rowH, count), dy: i.lastDy })
    },
    onPointerUp: end,
    onPointerCancel: end,
  })

  /** Row transform: dragged row follows the pointer, neighbors slide aside. */
  const rowStyle = (index: number): CSSProperties => {
    if (!drag) return {}
    const i = info.current
    const rowH = i?.rowH ?? 74
    if (index === drag.from) {
      return {
        transform: `translateY(${drag.dy}px) scale(1.02)`,
        zIndex: 10,
        position: 'relative',
      }
    }
    let shift = 0
    if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -rowH
    if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = rowH
    return { transform: `translateY(${shift}px)`, transition: 'transform 150ms ease' }
  }

  return { dragging: drag !== null, handleProps, rowStyle }
}

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
  const info = useRef<{
    from: number
    to: number
    startY: number
    rowH: number
    lastDy: number
    el: HTMLElement | null
  } | null>(null)

  const clearRow = () => {
    const el = info.current?.el
    if (el) el.style.transform = ''
  }

  const finish = (commit: boolean) => {
    const i = info.current
    clearRow()
    info.current = null
    setDrag(null)
    if (!i) return
    if (!commit) return
    const to = dragTargetIndex(i.from, i.lastDy, i.rowH, count)
    if (to !== i.from) onCommit(i.from, to)
  }

  const handleProps = (index: number) => ({
    style: { touchAction: 'none' } as CSSProperties,
    onPointerDown: (e: ReactPointerEvent) => {
      const row = (e.currentTarget as HTMLElement).closest('[data-drag-row]') as HTMLElement | null
      const gap = 8 // list gap-2
      const rowH = row ? row.getBoundingClientRect().height + gap : 74
      e.currentTarget.setPointerCapture(e.pointerId)
      info.current = { from: index, to: index, startY: e.clientY, rowH, lastDy: 0, el: row }
      onDragStart?.()
      setDrag({ from: index, to: index, dy: 0 })
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const i = info.current
      if (!i) return
      i.lastDy = e.clientY - i.startY
      // Dragged row follows the pointer imperatively — no re-render per pixel.
      if (i.el) i.el.style.transform = `translateY(${i.lastDy}px) scale(1.02)`
      const to = dragTargetIndex(i.from, i.lastDy, i.rowH, count)
      // Neighbors only shift when the target row changes (a boundary crossing),
      // so the whole editor re-renders a handful of times, not per event.
      if (to !== i.to) {
        i.to = to
        setDrag({ from: i.from, to, dy: i.lastDy })
      }
    },
    onPointerUp: () => finish(true),
    // An OS-cancelled gesture (notification shade, app switch, palm rejection)
    // discards the in-flight reorder instead of committing it.
    onPointerCancel: () => finish(false),
  })

  /**
   * Row transform for the *neighbors* (they slide aside on boundary crossings).
   * The dragged row's transform is written imperatively during the drag, so its
   * style here carries only stacking — never a transform React would clobber.
   */
  const rowStyle = (index: number): CSSProperties => {
    if (!drag) return {}
    const i = info.current
    const rowH = i?.rowH ?? 74
    if (index === drag.from) {
      return { zIndex: 10, position: 'relative' }
    }
    let shift = 0
    if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -rowH
    if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = rowH
    return { transform: `translateY(${shift}px)`, transition: 'transform 150ms ease' }
  }

  return { dragging: drag !== null, handleProps, rowStyle }
}

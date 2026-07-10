import type { ReactNode } from 'react'
import { AccentButton, OutlineButton, Sheet } from '../runner/components/ui'

/**
 * Shared confirm bottom sheet: title, optional body, accent confirm + outline
 * cancel. Tap-outside dismisses (treated as cancel). Backs the finish-workout,
 * delete-routine, delete-exercise and add-set confirmations.
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  z = 50,
}: {
  title: string
  body?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  z?: number
}) {
  return (
    <Sheet onClose={onCancel} z={z}>
      <div className="flex flex-col gap-[10px]">
        <div className="tt-label text-[13px] font-extrabold tracking-[0.04em] text-tx uppercase">
          {title}
        </div>
        {body != null && <div className="pb-1 text-[12px] leading-[1.6] text-mut">{body}</div>}
        <AccentButton label={confirmLabel} onClick={onConfirm} />
        <OutlineButton label={cancelLabel} onClick={onCancel} />
      </div>
    </Sheet>
  )
}

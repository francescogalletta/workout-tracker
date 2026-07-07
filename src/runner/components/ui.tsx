import type { PointerEventHandler, ReactNode } from 'react'

/** Dimmed-backdrop bottom sheet; tap outside dismisses. */
export function Sheet({
  onClose,
  z,
  children,
}: {
  onClose: () => void
  z: number
  children: ReactNode
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 flex items-end justify-center bg-black/55"
      style={{ zIndex: z }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up box-border w-full max-w-[430px] rounded-t-rl border border-cardbd bg-cardbg px-[18px] pt-5 pb-[calc(var(--safe-bottom)+26px)]"
      >
        {children}
      </div>
    </div>
  )
}

/** Quiet underlined text action with an extended hit area. */
export function QuietLink({
  label,
  onClick,
  className = '',
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`m-[-14px_-10px] cursor-pointer border-0 bg-transparent p-[14px_10px] font-mono tracking-[0.08em] uppercase underline underline-offset-[3px] ${className}`}
    >
      {label}
    </button>
  )
}

export function AccentButton({
  label,
  onClick,
  h = 56,
  className = '',
}: {
  label: string
  onClick: () => void
  h?: number
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{ height: h }}
      className={`flex w-full cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[14px] font-extrabold tracking-[0.06em] text-onacc uppercase ${className}`}
    >
      {label}
    </button>
  )
}

export function OutlineButton({
  label,
  onClick,
  h = 52,
  className = '',
}: {
  label: string
  onClick: () => void
  h?: number
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{ height: h }}
      className={`flex w-full cursor-pointer items-center justify-center rounded-rl border border-stepbd bg-stepbg font-mono text-[14px] font-bold tracking-[0.06em] text-tx uppercase ${className}`}
    >
      {label}
    </button>
  )
}

/** 72×56 stepper button used for weight/reps/metric ±. */
export function StepButton({
  label,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  fontSize = 15,
}: {
  label: string
  onClick: () => void
  onPointerDown?: PointerEventHandler
  onPointerUp?: PointerEventHandler
  onPointerLeave?: PointerEventHandler
  fontSize?: number
}) {
  return (
    <button
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={{ fontSize }}
      className="flex h-14 w-[72px] shrink-0 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono font-bold text-tx tabular-nums select-none"
    >
      {label}
    </button>
  )
}

/** Full-round filter chip (picker groups/equipment). */
export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-[34px] cursor-pointer items-center rounded-full border px-3 font-mono text-[11px] tracking-[0.06em] uppercase ${
        selected ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
      }`}
    >
      {label}
    </button>
  )
}

/** Hairline section rule: micro label + 1px line. */
export function HairlineLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[10px] pt-[2px]">
      <div className="text-[9px] tracking-[0.2em] whitespace-nowrap text-mut uppercase">
        {label}
      </div>
      <div className="h-px flex-1 bg-bd" />
    </div>
  )
}

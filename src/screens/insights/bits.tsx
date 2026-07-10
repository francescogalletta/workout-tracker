/** Small presentational pieces shared by the Insights screen's tabs. */

export function TabButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`tt-label flex h-12 cursor-pointer items-center justify-center rounded-rs border font-mono text-[12px] font-bold tracking-[0.06em] ${
        active ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
      }`}
    >
      {label}
    </button>
  )
}

export function SheetRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[10px] pt-[2px]">
      <div className="text-[9px] tracking-[0.2em] whitespace-nowrap text-mut uppercase">{label}</div>
      <div className="h-px flex-1 bg-bd" />
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-[10px] px-6 py-[90px] text-center">
      <div className="tt-label text-[13px] font-bold tracking-[0.06em] text-sec">{title}</div>
      <div className="text-[11px] leading-[1.8] text-mut">{body}</div>
    </div>
  )
}

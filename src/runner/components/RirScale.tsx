/**
 * Color-coded sliding RIR scale (CHANGE_REQUEST §4). One connected horizontal
 * track shared by the runner card and the routine editor. The ramp is semantic
 * (hard red → easy accent-green) and intentionally IDENTICAL in Volt and Ember,
 * so the hexes are literal rather than theme tokens.
 */

/** Ramp for RIR 0…4+ (hard → easy). Literal in both themes. */
export const RIR_RAMP = ['#FF3B30', '#FF6A2B', '#FFB020', '#DCE22E', '#C8FF2E'] as const

export function RirScale({
  value,
  onSelect,
  height = 52,
}: {
  value: number | null
  onSelect: (v: number) => void
  /** Cell height — 52 in the runner card, 48 in the tighter editor. */
  height?: number
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex overflow-hidden rounded-[4px] border border-bds">
        {RIR_RAMP.map((color, v) => {
          const sel = value === v
          return (
            <button
              key={v}
              onClick={() => onSelect(v)}
              aria-pressed={sel}
              style={{
                height,
                background: sel ? color : 'transparent',
                borderLeft: v === 0 ? undefined : '1px solid var(--bd)',
              }}
              className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-[5px] border-0 font-mono"
            >
              <span
                className="h-[3px] w-4 rounded-full"
                style={{ background: sel ? 'rgba(0,0,0,0.45)' : color }}
              />
              <span
                className="text-[14px] tabular-nums"
                style={{ color: sel ? '#0A0A0A' : 'var(--sec)', fontWeight: sel ? 800 : 400 }}
              >
                {v === 4 ? '4+' : v}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-[9px] tracking-[0.06em] text-dim uppercase">
        <span>← Hard · nothing left</span>
        <span>Easy →</span>
      </div>
    </div>
  )
}

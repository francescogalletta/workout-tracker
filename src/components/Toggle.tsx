/**
 * Shared 52×32 switch track (accent fill + right knob when on, outline + left
 * knob when off). With `onToggle` it renders as a real `role="switch"` button;
 * without it it renders a presentational span for rows that are themselves the
 * tap target (Settings/RoutineEditor row cards, Routines' captioned button).
 */
export function Toggle({ on, onToggle }: { on: boolean; onToggle?: () => void }) {
  const track = (
    <span
      className={`box-border flex h-8 w-[52px] shrink-0 items-center rounded-full border px-[3px] ${
        on ? 'justify-end border-acc bg-acc' : 'justify-start border-stepbd bg-stepbg'
      }`}
    >
      <span className={`h-6 w-6 rounded-full ${on ? 'bg-onacc' : 'bg-mut'}`} />
    </span>
  )
  if (!onToggle) return track
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="cursor-pointer border-0 bg-transparent p-0"
    >
      {track}
    </button>
  )
}

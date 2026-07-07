import type { ExerciseType } from '../types'

/**
 * Small uppercase badge shown next to an exercise name when its logging type
 * is not the default `weight` (CHANGE_REQUEST §2.1/§3.1): `BODYWEIGHT` for
 * `reps`, `TIME` for `time`. Weight exercises render nothing.
 */
export function TypeBadge({
  type,
  className = '',
}: {
  type?: ExerciseType
  className?: string
}) {
  if (!type || type === 'weight') return null
  const label = type === 'reps' ? 'Bodyweight' : 'Time'
  return (
    <span
      className={`inline-flex items-center rounded-[3px] border border-bds px-[5px] py-[2px] text-[9px] leading-none font-normal tracking-[0.14em] text-mut uppercase ${className}`}
    >
      {label}
    </span>
  )
}

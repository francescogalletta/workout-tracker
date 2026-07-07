import type { DbExercise } from '../types'
import { Chip, HairlineLabel, QuietLink } from './ui'

export const PICKER_GROUPS = ['all', 'chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio']
export const PICKER_EQUIPMENT = ['all', 'barbell', 'dumbbell', 'cable', 'machine', 'body']

export interface PickerFilter {
  mode: 'swap' | 'add'
  exIdx: number | null
  query: string
  group: string
  equip: string
}

/** Filter + sort the exercise DB for the picker (pure; exported for tests). */
export function filterDb(
  db: DbExercise[],
  filter: PickerFilter,
  inSessionNames: string[],
  targetMuscle: string,
): Array<DbExercise & { match: boolean }> {
  const inSession = inSessionNames.map((n) => n.toLowerCase())
  const q = filter.query.toLowerCase()
  let list = db.filter((d) => {
    if (inSession.includes(d.name.toLowerCase())) return false
    if (q && !d.name.toLowerCase().includes(q)) return false
    if (filter.group !== 'all' && d.group !== filter.group) return false
    if (filter.equip !== 'all' && d.equipment !== filter.equip) return false
    return true
  })
  if (filter.mode === 'swap') {
    list = list
      .slice()
      .sort((a, b) => (a.muscle === targetMuscle ? 0 : 1) - (b.muscle === targetMuscle ? 0 : 1))
  }
  return list.map((d) => ({ ...d, match: filter.mode === 'swap' && d.muscle === targetMuscle }))
}

export function ExercisePicker({
  filter,
  title,
  items,
  onChange,
  onPick,
  onCancel,
  showEquipment = true,
  footnote,
}: {
  filter: PickerFilter
  title: string
  items: Array<DbExercise & { match: boolean }>
  onChange: (next: PickerFilter) => void
  onPick: (item: DbExercise) => void
  onCancel: () => void
  /** Runner shows the equipment chip row; the editor picker omits it. */
  showEquipment?: boolean
  /**
   * Footnote text under the results. Omit the prop for the mode-derived
   * default (swap/add); pass `null` to render no footnote (editor picker).
   */
  footnote?: string | null
}) {
  const foot =
    footnote === undefined
      ? filter.mode === 'swap'
        ? "Same-muscle alternatives first · not already in today's routine"
        : 'Added to this session only — routine template unchanged'
      : footnote

  return (
    <div className="animate-ovl-up fixed inset-0 z-45 flex justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col gap-3 p-[24px_18px]">
        <div className="flex items-baseline justify-between">
          <div className="text-[15px] font-bold tracking-[0.04em] text-tx uppercase">{title}</div>
          <QuietLink label="Cancel" onClick={onCancel} className="text-[12px] text-mut" />
        </div>
        <input
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder="Search exercises"
          className="box-border h-12 w-full rounded-rs border border-stepbd bg-stepbg px-[14px] font-mono text-[14px] text-tx outline-none"
        />
        <HairlineLabel label="Muscle group" />
        <div className="flex flex-wrap gap-[6px]">
          {PICKER_GROUPS.map((g) => (
            <Chip
              key={g}
              label={g}
              selected={filter.group === g}
              onClick={() => onChange({ ...filter, group: g })}
            />
          ))}
        </div>
        {showEquipment && (
          <>
            <HairlineLabel label="Equipment" />
            <div className="flex flex-wrap gap-[6px]">
              {PICKER_EQUIPMENT.map((q) => (
                <Chip
                  key={q}
                  label={q}
                  selected={filter.equip === q}
                  onClick={() => onChange({ ...filter, equip: q })}
                />
              ))}
            </div>
          </>
        )}
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto pb-2">
          {items.map((it) => (
            <button
              key={it.name}
              onClick={() => onPick(it)}
              className="flex cursor-pointer items-center justify-between gap-[10px] rounded-rs border border-rowbd bg-rowbg p-[13px_14px] text-left font-mono"
            >
              <div className="flex flex-col gap-[3px]">
                <div className="text-[13px] font-bold tracking-[0.03em] text-tx uppercase">
                  {it.name}
                </div>
                <div className="text-[10px] tracking-[0.06em] text-mut uppercase">
                  {it.muscle} · {it.equipment}
                </div>
              </div>
              {it.match && (
                <div className="rounded-full border border-bds px-[7px] py-1 text-[9px] tracking-[0.1em] whitespace-nowrap text-acc uppercase">
                  Same muscle
                </div>
              )}
            </button>
          ))}
          {items.length === 0 && (
            <div className="py-6 text-center text-[12px] text-dim">No matches</div>
          )}
        </div>
        {foot && (
          <div className="text-center text-[10px] tracking-[0.06em] text-dim uppercase">
            {foot}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { createExercise } from '../../data/mutations'
import { fmtDur } from '../../lib/format'
import type { DbExercise, ExerciseType } from '../types'
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

/** Picker row sub-line suffix conveying the logging type (CHANGE_REQUEST §5). */
function typeSuffix(it: DbExercise): string {
  if (it.kind === 'cardio') return ''
  if (it.type === 'reps') return ' · bodyweight'
  if (it.type === 'time') return ' · timed'
  return ''
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
  const [creating, setCreating] = useState(false)

  const foot =
    footnote === undefined
      ? filter.mode === 'swap'
        ? "Same-muscle alternatives first · not already in today's routine"
        : 'Added to this session only — routine template unchanged'
      : footnote

  if (creating) {
    return (
      <CreateExercise
        initialName={filter.query}
        onCancel={() => setCreating(false)}
        onCreate={(name, type) => {
          const ex = createExercise({ name, type })
          setCreating(false)
          onPick({
            id: ex.id,
            name: ex.name,
            muscle: ex.primaryMuscle,
            group: ex.muscleGroup,
            equipment: ex.equipment,
            type: ex.type,
          })
        }}
      />
    )
  }

  return (
    <div className="animate-ovl-up fixed inset-0 z-45 flex justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col gap-3 pt-[calc(var(--safe-top)+24px)] pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+24px)] pl-[max(18px,var(--safe-left))]">
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
                  {typeSuffix(it)}
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

          {/* Create-custom-exercise — the one place an exercise's type is chosen. */}
          <button
            onClick={() => setCreating(true)}
            className="mt-1 flex h-[52px] w-full cursor-pointer items-center justify-center rounded-rs border border-dashed border-bds bg-transparent font-mono text-[12px] tracking-[0.1em] text-sec uppercase"
          >
            + Create custom exercise
          </button>
        </div>
        {foot && (
          <div className="text-center text-[10px] tracking-[0.06em] text-dim uppercase">{foot}</div>
        )}
      </div>
    </div>
  )
}

// ── Create-custom-exercise screen (CHANGE_REQUEST §2.4) ─────────────────────

const TYPE_SEGMENTS: ReadonlyArray<readonly [ExerciseType, string]> = [
  ['weight', 'Weight'],
  ['reps', 'Reps'],
  ['time', 'Time'],
]

/** Live "EXAMPLE SET READS" preview line for the chosen type. */
function exampleSet(type: ExerciseType): string {
  if (type === 'weight') return 'Set 1 · 62.5 kg × 8 · RIR 2'
  if (type === 'reps') return 'Set 1 · 12 reps · RIR 2'
  return `Set 1 · ${fmtDur(45)}`
}

export function CreateExercise({
  initialName,
  onCreate,
  onCancel,
}: {
  initialName: string
  onCreate: (name: string, type: ExerciseType) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [type, setType] = useState<ExerciseType>('weight')
  const canCreate = name.trim().length > 0

  return (
    <div className="animate-ovl-up fixed inset-0 z-45 flex justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col gap-4 pt-[calc(var(--safe-top)+24px)] pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+24px)] pl-[max(18px,var(--safe-left))]">
        <div className="flex items-baseline justify-between">
          <div className="text-[15px] font-bold tracking-[0.04em] text-tx uppercase">
            New exercise
          </div>
          <QuietLink label="Cancel" onClick={onCancel} className="text-[12px] text-mut" />
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Exercise name"
          autoFocus
          className="box-border h-12 w-full rounded-rs border border-stepbd bg-stepbg px-[14px] font-mono text-[15px] text-tx outline-none"
        />

        <div className="flex flex-col gap-[8px]">
          <div className="text-[10px] tracking-[0.16em] text-mut uppercase">Logged as</div>
          <div className="grid grid-cols-3 gap-[6px]">
            {TYPE_SEGMENTS.map(([t, label]) => {
              const sel = type === t
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex h-12 cursor-pointer items-center justify-center rounded-rs border font-mono text-[13px] font-bold tracking-[0.06em] uppercase ${
                    sel ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-[8px]">
          <div className="text-[10px] tracking-[0.16em] text-mut uppercase">Example set reads</div>
          <div className="flex items-center rounded-rs border border-dashed border-bds px-[14px] py-[14px] text-[13px] tracking-[0.03em] text-sec tabular-nums">
            {exampleSet(type)}
          </div>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => canCreate && onCreate(name, type)}
          disabled={!canCreate}
          className="tt-label flex h-[56px] w-full items-center justify-center rounded-rl border-0 bg-acc font-mono text-[15px] font-extrabold tracking-[0.06em] text-onacc uppercase disabled:opacity-40"
          style={{ cursor: canCreate ? 'pointer' : 'not-allowed' }}
        >
          Create + Add
        </button>
      </div>
    </div>
  )
}

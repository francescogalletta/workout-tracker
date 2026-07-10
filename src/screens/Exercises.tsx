import { useState } from 'react'
import { createExercise, deleteExercise, renameExercise } from '../data/mutations'
import { routinesUsingExercise } from '../data/queries'
import { useDb } from '../data/store'
import { exerciseType, MAX_EXERCISE_NAME_LEN, type Exercise } from '../data/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { CreateExercise, PICKER_GROUPS } from '../runner/components/ExercisePicker'
import { TypeBadge } from '../runner/components/TypeBadge'
import { AccentButton, Chip, HairlineLabel, OutlineButton, Sheet } from '../runner/components/ui'

/**
 * Exercises library (owner decision — the one place to manage the exercise
 * catalog outside a routine). Lists every exercise with search + muscle-group
 * filters; each row can be renamed or deleted, and new custom exercises are
 * created here too (shared `CreateExercise` flow). Type is chosen once at
 * creation and never edited (CHANGE_REQUEST §1.1), so there is no type control
 * on rename. Deleting cascades to routine items but keeps logged history.
 */
export function Exercises() {
  const db = useDb()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('all')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Exercise | null>(null)
  const [deleting, setDeleting] = useState<Exercise | null>(null)

  const q = query.trim().toLowerCase()
  const list = db.exercises
    .filter((e) => (group === 'all' || e.muscleGroup === group) && e.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  if (creating) {
    return (
      <CreateExercise
        initialName={query}
        onCancel={() => setCreating(false)}
        onCreate={(name, type) => {
          createExercise({ name, type })
          setCreating(false)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-screen justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col gap-3 pt-5 pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+24px)] pl-[max(18px,var(--safe-left))]">
        <div className="flex items-baseline pb-1">
          <div className="tt-label text-[17px] font-bold tracking-[0.05em] text-tx">Exercises</div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          className="box-border h-12 w-full rounded-rs border border-stepbd bg-stepbg px-[14px] font-mono text-[14px] text-tx outline-none"
        />
        <HairlineLabel label="Muscle group" />
        <div className="flex flex-wrap gap-[6px]">
          {PICKER_GROUPS.map((g) => (
            <Chip key={g} label={g} selected={group === g} onClick={() => setGroup(g)} />
          ))}
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {list.map((ex) => (
            <div
              key={ex.id}
              className="flex items-center justify-between gap-[10px] rounded-rs border border-rowbd bg-rowbg p-[13px_14px]"
            >
              <div className="flex min-w-0 flex-col gap-[3px]">
                <div className="flex items-center gap-[7px]">
                  <span className="truncate text-[13px] font-bold tracking-[0.03em] text-tx uppercase">
                    {ex.name}
                  </span>
                  <TypeBadge type={exerciseType(ex)} />
                </div>
                <div className="text-[10px] tracking-[0.06em] text-mut uppercase">
                  {ex.primaryMuscle} · {ex.equipment}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <IconButton label="Rename" glyph="✎" onClick={() => setRenaming(ex)} />
                <IconButton label="Delete" glyph="🗑" onClick={() => setDeleting(ex)} />
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div className="py-6 text-center text-[12px] text-dim">No matches</div>
          )}

          <button
            onClick={() => setCreating(true)}
            className="mt-1 flex h-[52px] w-full cursor-pointer items-center justify-center rounded-rs border border-dashed border-bds bg-transparent font-mono text-[12px] tracking-[0.1em] text-sec uppercase"
          >
            + Create custom exercise
          </button>
        </div>
      </div>

      {renaming && (
        <RenameSheet exercise={renaming} onClose={() => setRenaming(null)} />
      )}
      {deleting && (
        <DeleteSheet
          exercise={deleting}
          usedIn={routinesUsingExercise(db, deleting.id).length}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

/** 40×40 outline glyph button for the per-row rename/delete actions. */
function IconButton({
  label,
  glyph,
  onClick,
}: {
  label: string
  glyph: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono text-[15px] text-sec"
    >
      {glyph}
    </button>
  )
}

function RenameSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const [name, setName] = useState(exercise.name)
  const canSave = name.trim().length > 0 && name.trim() !== exercise.name
  return (
    <Sheet onClose={onClose} z={50}>
      <div className="flex flex-col gap-[12px]">
        <div className="tt-label text-[13px] font-extrabold tracking-[0.04em] text-tx">
          Rename exercise
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_EXERCISE_NAME_LEN}
          autoFocus
          className="box-border h-12 w-full rounded-rs border border-stepbd bg-stepbg px-[14px] font-mono text-[15px] text-tx outline-none"
        />
        <div className="text-[10px] tracking-[0.04em] text-dim uppercase">
          Type stays {exerciseType(exercise)} · past history keeps its old name
        </div>
        <AccentButton
          label="Save"
          onClick={() => {
            if (canSave) {
              renameExercise(exercise.id, name)
              onClose()
            }
          }}
          className={canSave ? '' : 'opacity-40'}
        />
        <OutlineButton label="Cancel" onClick={onClose} />
      </div>
    </Sheet>
  )
}

function DeleteSheet({
  exercise,
  usedIn,
  onClose,
}: {
  exercise: Exercise
  usedIn: number
  onClose: () => void
}) {
  const usage =
    usedIn === 0
      ? 'Not used in any routine.'
      : `Used in ${usedIn} ${usedIn === 1 ? 'routine' : 'routines'} — those entries will be removed.`
  return (
    <ConfirmSheet
      title={`Delete ${exercise.name}?`}
      body={`${usage} Past workout history is kept.`}
      confirmLabel="Delete exercise"
      cancelLabel="Keep"
      onConfirm={() => {
        deleteExercise(exercise.id)
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

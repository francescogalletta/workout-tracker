import { useState } from 'react'
import { createExercise, deleteExercises, renameExercise } from '../data/mutations'
import { routinesUsingExercise } from '../data/queries'
import { useDb } from '../data/store'
import { exerciseType, MAX_EXERCISE_NAME_LEN, type Exercise } from '../data/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { useLongPress } from '../lib/useLongPress'
import { CreateExercise, PICKER_GROUPS } from '../runner/components/ExercisePicker'
import { TypeBadge } from '../runner/components/TypeBadge'
import { AccentButton, Chip, HairlineLabel, OutlineButton, Sheet } from '../runner/components/ui'

/**
 * Exercises library (owner decision — the one place to manage the exercise
 * catalog outside a routine). Lists every exercise with search + muscle-group
 * filters. Tap a row to rename it; long-press to enter select mode with
 * checkboxes and a group delete. New custom exercises are created here too
 * (shared `CreateExercise` flow). Type is chosen once at creation and never
 * edited (CHANGE_REQUEST §1.1), so there is no type control on rename.
 * Deleting cascades to routine items but keeps logged history.
 */
export function Exercises() {
  const db = useDb()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('all')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Exercise | null>(null)
  // Select mode: non-null = the checked ids (may be empty while still in mode).
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const selecting = selected !== null

  const q = query.trim().toLowerCase()
  const list = db.exercises
    .filter((e) => (group === 'all' || e.muscleGroup === group) && e.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  const toggle = (id: string) => {
    setSelected((s) => {
      if (!s) return s
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const deleteSelected = () => {
    if (selected) deleteExercises([...selected])
    setConfirmDelete(false)
    setSelected(null)
  }

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
        <div className="flex h-8 items-baseline justify-between pb-1">
          {selecting ? (
            <>
              <div className="tt-label text-[17px] font-bold tracking-[0.05em] text-tx tabular-nums">
                {selected.size} selected
              </div>
              <div className="flex items-baseline gap-4">
                <button
                  onClick={() => setSelected(null)}
                  className="tt-label m-[-10px] cursor-pointer border-0 bg-transparent p-[10px] font-mono text-[12px] tracking-[0.08em] text-mut underline underline-offset-[3px]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={selected.size === 0}
                  className={`tt-label m-[-10px] cursor-pointer border-0 bg-transparent p-[10px] font-mono text-[12px] font-bold tracking-[0.08em] underline underline-offset-[3px] ${
                    selected.size === 0 ? 'text-dim' : 'text-acc'
                  }`}
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <div className="tt-label text-[17px] font-bold tracking-[0.05em] text-tx">Exercises</div>
          )}
        </div>

        <input
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          className="box-border h-12 w-full rounded-rs border border-stepbd bg-stepbg px-[14px] font-mono text-[16px] text-tx outline-none"
        />
        <HairlineLabel label="Muscle group" />
        <div className="flex flex-wrap gap-[6px]">
          {PICKER_GROUPS.map((g) => (
            <Chip key={g} label={g} selected={group === g} onClick={() => setGroup(g)} />
          ))}
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {list.map((ex) => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              selecting={selecting}
              checked={selected?.has(ex.id) ?? false}
              onTap={() => (selecting ? toggle(ex.id) : setRenaming(ex))}
              onLongPress={() =>
                setSelected((s) => (s ? new Set(s).add(ex.id) : new Set([ex.id])))
              }
            />
          ))}
          {list.length === 0 && (
            <div className="py-6 text-center text-[12px] text-dim">No matches</div>
          )}
          {list.length > 0 && (
            <div className="pt-1 text-center text-[10px] tracking-[0.06em] text-dim uppercase">
              Tap to rename · hold to select
            </div>
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
      {confirmDelete && selected && (
        <DeleteConfirm selected={selected} onConfirm={deleteSelected} onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  )
}

/**
 * One catalog row. Tap renames (or toggles in select mode); a long-press
 * enters select mode with this row checked. The long-press cancels on movement
 * so list scrolling never triggers it, and the row's click bails when the
 * press already fired.
 */
function ExerciseRow({
  exercise: ex,
  selecting,
  checked,
  onTap,
  onLongPress,
}: {
  exercise: Exercise
  selecting: boolean
  checked: boolean
  onTap: () => void
  onLongPress: () => void
}) {
  const { firedRef, handlers } = useLongPress(onLongPress)
  return (
    <button
      {...handlers}
      onClick={() => {
        if (firedRef.current) return
        onTap()
      }}
      className={`flex w-full cursor-pointer items-center gap-[10px] rounded-rs border bg-rowbg p-[13px_14px] text-left select-none ${
        checked ? 'border-acc' : 'border-rowbd'
      }`}
    >
      {selecting && (
        <span
          aria-hidden
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border text-[13px] font-bold ${
            checked ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-transparent'
          }`}
        >
          ✓
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
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
    </button>
  )
}

/**
 * Delete-confirm sheet. Computing "used in N routines" only here (not every
 * Exercises render) keeps the aggregate off the hot render path — it is read
 * nowhere else.
 */
function DeleteConfirm({
  selected,
  onConfirm,
  onCancel,
}: {
  selected: Set<string>
  onConfirm: () => void
  onCancel: () => void
}) {
  const db = useDb()
  const usedEntries = [...selected].reduce((a, id) => a + routinesUsingExercise(db, id).length, 0)
  return (
    <ConfirmSheet
      title={`Delete ${selected.size} ${selected.size === 1 ? 'exercise' : 'exercises'}?`}
      body={`${
        usedEntries === 0
          ? 'Not used in any routine.'
          : `Used in ${usedEntries} routine ${usedEntries === 1 ? 'entry' : 'entries'} — those will be removed.`
      } Past workout history is kept.`}
      confirmLabel="Delete"
      cancelLabel="Keep"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
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
          enterKeyHint="done"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_EXERCISE_NAME_LEN}
          autoFocus
          className="box-border h-12 w-full rounded-rs border border-stepbd bg-stepbg px-[14px] font-mono text-[16px] text-tx outline-none"
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


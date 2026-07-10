import { useEffect, useState } from 'react'
import { exerciseById, itemsForRoutine, rotationRoutines, routineById } from '../data/queries'
import { update, useDb } from '../data/store'
import type { Db, ExerciseType, RoutineItem } from '../data/types'
import {
  DUR_MIN,
  DUR_STEP,
  MAX_ROUTINE_NAME_LEN,
  TYPE_DEFAULTS,
  effectiveRIR,
  exerciseType,
  newId,
  routineDefaultRIR,
} from '../data/types'
import { fmtDur } from '../lib/format'
import { useDragReorder } from '../lib/useDragReorder'
import { navigate } from '../router'
import {
  ExercisePicker,
  filterDb,
  type PickerFilter,
} from '../runner/components/ExercisePicker'
import { toPickerItem } from '../runner/fromStore'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { RestSlider } from '../components/RestSlider'
import { Toggle } from '../components/Toggle'
import { RirScale } from '../runner/components/RirScale'
import { TypeBadge } from '../runner/components/TypeBadge'
import { addToRotation, removeFromRotation } from './routineOps'

/**
 * Routine Editor (design/prototypes/Routine Editor.dc.html). Every control
 * writes straight to the store — there is no save button; "Done" just
 * navigates back. Logic lives in the exported pure `Db` transforms below so
 * it is unit-testable without a DOM.
 */

// ── Pure store transforms (exported for tests) ─────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function setRoutineName(db: Db, routineId: string, name: string): Db {
  return {
    ...db,
    routines: db.routines.map((r) =>
      r.id === routineId ? { ...r, name: name.slice(0, MAX_ROUTINE_NAME_LEN) } : r,
    ),
  }
}

/**
 * Set the routine default rest AND reset every item's override to null, so a
 * new default really applies to the whole routine (owner decision — before,
 * items with explicit rests silently kept them).
 */
export function setDefaultRest(db: Db, routineId: string, sec: number): Db {
  return {
    ...db,
    routines: db.routines.map((r) => (r.id === routineId ? { ...r, defaultRestSec: sec } : r)),
    routineItems: db.routineItems.map((it) =>
      it.routineId === routineId ? { ...it, restSec: null } : it,
    ),
  }
}

/** Same override-resetting semantics as `setDefaultRest`, for the RIR target. */
export function setDefaultTargetRIR(db: Db, routineId: string, rir: number): Db {
  return {
    ...db,
    routines: db.routines.map((r) => (r.id === routineId ? { ...r, defaultTargetRIR: rir } : r)),
    routineItems: db.routineItems.map((it) =>
      it.routineId === routineId ? { ...it, targetRIR: null } : it,
    ),
  }
}

export function setWarmup(db: Db, routineId: string, warmup: boolean): Db {
  return {
    ...db,
    routines: db.routines.map((r) => (r.id === routineId ? { ...r, warmup } : r)),
  }
}

export function stepSets(db: Db, itemId: string, delta: number): Db {
  return {
    ...db,
    routineItems: db.routineItems.map((it) =>
      it.id === itemId ? { ...it, sets: clamp(it.sets + delta, 1, 10) } : it,
    ),
  }
}

export function stepReps(db: Db, itemId: string, delta: number): Db {
  return {
    ...db,
    routineItems: db.routineItems.map((it) =>
      it.id === itemId ? { ...it, repsPerSet: clamp(it.repsPerSet + delta, 1, 30) } : it,
    ),
  }
}

/** Override one item's RIR target; `null` reverts to the routine default. */
export function setItemRir(db: Db, itemId: string, rir: number | null): Db {
  return {
    ...db,
    routineItems: db.routineItems.map((it) => (it.id === itemId ? { ...it, targetRIR: rir } : it)),
  }
}

/** Step a `time` item's target hold duration by `delta * DUR_STEP` seconds, floored at DUR_MIN. */
export function stepDur(db: Db, itemId: string, delta: number): Db {
  return {
    ...db,
    routineItems: db.routineItems.map((it) =>
      it.id === itemId
        ? { ...it, durSec: Math.max(DUR_MIN, (it.durSec ?? TYPE_DEFAULTS.time.durSec) + delta * DUR_STEP) }
        : it,
    ),
  }
}

/** Override rest for one item; `null` reverts to the routine default. */
export function setItemRest(db: Db, itemId: string, restSec: number | null): Db {
  return {
    ...db,
    routineItems: db.routineItems.map((it) => (it.id === itemId ? { ...it, restSec } : it)),
  }
}

/** Drop an item at `toIndex` (clamped); re-densifies order 0..n-1. */
export function reorderItem(db: Db, routineId: string, itemId: string, toIndex: number): Db {
  const ordered = itemsForRoutine(db, routineId)
  const from = ordered.findIndex((it) => it.id === itemId)
  if (from === -1) return db
  const to = Math.max(0, Math.min(ordered.length - 1, toIndex))
  if (to === from) return db
  const next = ordered.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  const orderById = new Map(next.map((it, i) => [it.id, i]))
  return {
    ...db,
    routineItems: db.routineItems.map((it) =>
      orderById.has(it.id) ? { ...it, order: orderById.get(it.id)! } : it,
    ),
  }
}

/** Move an item up (-1) or down (+1); re-densifies order 0..n-1. No-op at edges. */
export function moveItem(db: Db, routineId: string, itemId: string, dir: -1 | 1): Db {
  const ordered = itemsForRoutine(db, routineId)
  const idx = ordered.findIndex((it) => it.id === itemId)
  const j = idx + dir
  if (idx === -1 || j < 0 || j >= ordered.length) return db
  const swapped = ordered.slice()
  ;[swapped[idx], swapped[j]] = [swapped[j], swapped[idx]]
  const orderById = new Map(swapped.map((it, i) => [it.id, i]))
  return {
    ...db,
    routineItems: db.routineItems.map((it) =>
      orderById.has(it.id) ? { ...it, order: orderById.get(it.id)! } : it,
    ),
  }
}

/** Remove an item; re-densifies the remaining items' order 0..n-1. */
export function removeItem(db: Db, routineId: string, itemId: string): Db {
  const remaining = itemsForRoutine(db, routineId).filter((it) => it.id !== itemId)
  const orderById = new Map(remaining.map((it, i) => [it.id, i]))
  return {
    ...db,
    routineItems: db.routineItems
      .filter((it) => it.id !== itemId)
      .map((it) => (orderById.has(it.id) ? { ...it, order: orderById.get(it.id)! } : it)),
  }
}

/**
 * Append an item with type-aware defaults (CHANGE_REQUEST §1.3): weight 3×10,
 * reps (bodyweight) 3×12, time 3×30s. Rest and RIR both start on the routine
 * defaults (null overrides).
 */
export function addItem(db: Db, routineId: string, exerciseId: string, id: string): Db {
  const order = itemsForRoutine(db, routineId).length
  const type = exerciseType(db.exercises.find((e) => e.id === exerciseId) ?? {})
  const item: RoutineItem = {
    id,
    routineId,
    exerciseId,
    order,
    sets: TYPE_DEFAULTS[type].sets,
    repsPerSet: type === 'time' ? 0 : TYPE_DEFAULTS[type].reps,
    targetRIR: null,
    restSec: null,
    ...(type === 'time' ? { durSec: TYPE_DEFAULTS.time.durSec } : {}),
  }
  return { ...db, routineItems: [...db.routineItems, item] }
}

/**
 * Toggle rotation membership. Enabling appends this routine at the end of the
 * cycle; disabling drops it. Either way the remaining routines stay a dense
 * 0..n-1 sequence.
 *
 * Delegates to the shared rotation helpers in `routineOps` (which Home and
 * Routines also use) so the editor and the list screens can never disagree on
 * cycleOrder semantics — notably both now exclude archived routines from the
 * numbering.
 */
export function setRotation(db: Db, routineId: string, inRotation: boolean): Db {
  return {
    ...db,
    routines: inRotation
      ? addToRotation(db.routines, routineId)
      : removeFromRotation(db.routines, routineId),
  }
}

/**
 * Delete a routine and its items. Past sessions and setLogs are kept — they
 * carry their own routineName snapshot, so history is unaffected (same
 * principle as discarding a session, SPEC §3). The remaining rotation
 * renumbers densely via the shared helper.
 */
export function deleteRoutine(db: Db, routineId: string): Db {
  return {
    ...db,
    routines: removeFromRotation(db.routines, routineId).filter((r) => r.id !== routineId),
    routineItems: db.routineItems.filter((it) => it.routineId !== routineId),
  }
}

export function itemSummary(
  item: RoutineItem,
  routine: { defaultRestSec: number; defaultTargetRIR?: number },
  type: ExerciseType,
): string {
  const rest = item.restSec ?? routine.defaultRestSec
  if (type === 'time') {
    return `${item.sets} × ${fmtDur(item.durSec ?? TYPE_DEFAULTS.time.durSec)} · rest ${rest}s`
  }
  return `${item.sets}×${item.repsPerSet} @ RIR ${effectiveRIR(item, routine)} · rest ${rest}s`
}

// ── Small presentational bits ──────────────────────────────────────────────

function ChoiceChip({
  label,
  selected,
  onClick,
  h = 40,
}: {
  label: string
  selected: boolean
  onClick: () => void
  h?: number
}) {
  return (
    <button
      onClick={onClick}
      style={{ height: h }}
      className={`flex cursor-pointer items-center rounded-rs border px-[13px] font-mono text-[13px] font-bold tabular-nums tt-label ${
        selected ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
      }`}
    >
      {label}
    </button>
  )
}

function StepPad({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono text-[18px] text-tx select-none"
    >
      {label}
    </button>
  )
}

// ── Expanded item card ─────────────────────────────────────────────────────

function ExpandedItem({
  item,
  name,
  type,
  defaultRest,
  defaultRir,
  restOpen,
  onCollapse,
  onRemove,
  onStepSets,
  onStepReps,
  onStepDur,
  onRir,
  onRest,
  onToggleRest,
}: {
  item: RoutineItem
  name: string
  type: ExerciseType
  defaultRest: number
  defaultRir: number
  restOpen: boolean
  onCollapse: () => void
  onRemove: () => void
  onStepSets: (d: number) => void
  onStepReps: (d: number) => void
  onStepDur: (d: number) => void
  onRir: (v: number | null) => void
  onRest: (v: number | null) => void
  onToggleRest: () => void
}) {
  const effectiveRest = item.restSec ?? defaultRest
  const isTime = type === 'time'
  const fields = isTime
    ? ([
        ['Sets', String(item.sets), onStepSets],
        ['Target duration', fmtDur(item.durSec ?? TYPE_DEFAULTS.time.durSec), onStepDur],
      ] as const)
    : ([
        ['Sets', String(item.sets), onStepSets],
        ['Reps', String(item.repsPerSet), onStepReps],
      ] as const)
  return (
    <div className="flex flex-col gap-[14px] rounded-rl border border-cardbd bg-cardbg p-[16px_14px]">
      <div onClick={onCollapse} className="flex cursor-pointer items-baseline justify-between">
        <div className="flex items-center gap-2">
          <div className="text-[14px] font-bold tracking-[0.04em] text-acc tt-label">{name}</div>
          <TypeBadge type={type} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="m-[-14px_-10px] cursor-pointer border-0 bg-transparent p-[14px_10px] font-mono text-[10px] tracking-[0.1em] text-dim uppercase underline underline-offset-[3px]"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-[10px]">
        {fields.map(([lbl, val, step]) => (
          <div key={lbl} className="flex flex-col gap-[6px]">
            <div className="text-[10px] tracking-[0.16em] text-mut uppercase">{lbl}</div>
            <div className="flex items-center gap-2">
              <StepPad label="−" onClick={() => step(-1)} />
              <div className="flex-1 text-center text-[24px] font-extrabold text-numc tabular-nums">
                {val}
              </div>
              <StepPad label="+" onClick={() => step(1)} />
            </div>
          </div>
        ))}
      </div>

      {!isTime && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[10px] tracking-[0.16em] text-mut uppercase">Target RIR</div>
          <RirScale value={item.targetRIR ?? defaultRir} onSelect={onRir} height={48} />
          <ChoiceChip
            label={`Default · RIR ${defaultRir}`}
            selected={item.targetRIR === null}
            onClick={() => onRir(null)}
            h={36}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] tracking-[0.16em] text-mut uppercase">Rest</div>
        <button
          onClick={onToggleRest}
          className="box-border flex min-w-[76px] cursor-pointer flex-col items-center gap-[2px] rounded-rs border border-stepbd bg-stepbg px-[14px] py-2"
        >
          <div className="text-[18px] font-extrabold text-tx tabular-nums">{effectiveRest}s</div>
          {item.restSec === null && (
            <div className="text-[8px] tracking-[0.12em] text-mut uppercase">default</div>
          )}
        </button>
      </div>
      {restOpen && (
        <RestSlider
          sec={effectiveRest}
          isDefault={item.restSec === null}
          defaultSec={defaultRest}
          onUseDefault={() => onRest(null)}
          onCommit={(sec) => onRest(sec)}
        />
      )}
    </div>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────────

export function RoutineEditor({ id }: { id: string }) {
  const db = useDb()
  const routine = routineById(db, id)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [restOpen, setRestOpen] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerFilter | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const itemIds = itemsForRoutine(db, id).map((it) => it.id)
  const reorder = useDragReorder(
    itemIds.length,
    (from, to) => update((d) => reorderItem(d, id, itemIds[from], to)),
    // Collapse open cards when a drag starts so every row is uniform height.
    () => {
      setExpanded(null)
      setRestOpen(null)
    },
  )

  useEffect(() => {
    if (!routine) navigate('/routines')
  }, [routine])

  if (!routine) return null

  const items = itemsForRoutine(db, id)
  const inRotation = routine.cycleOrder !== null
  const subtitle = `${items.length} ${items.length === 1 ? 'exercise' : 'exercises'} · ${
    inRotation ? 'in rotation' : 'not in rotation'
  }`

  const existingNames = items.map((it) => exerciseById(db, it.exerciseId)?.name ?? '')
  const pickerItems = picker
    ? filterDb(db.exercises.map(toPickerItem), picker, existingNames, '')
    : []

  return (
    <div className="flex min-h-screen justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col pt-[20px] pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+28px)] pl-[max(18px,var(--safe-left))]">
        {/* header */}
        <div className="flex items-baseline justify-between pb-1">
          <button
            onClick={() => navigate('/routines')}
            className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[12px] tracking-[0.08em] text-mut tt-label"
          >
            ‹ Routines
          </button>
          <button
            onClick={() => navigate('/routines')}
            className="m-[-14px_-10px] cursor-pointer border-0 bg-transparent p-[14px_10px] font-mono text-[12px] tracking-[0.08em] text-mut underline underline-offset-[3px] tt-label"
          >
            Done
          </button>
        </div>

        <input
          value={routine.name}
          onChange={(e) => update((d) => setRoutineName(d, id, e.target.value))}
          maxLength={MAX_ROUTINE_NAME_LEN}
          className="w-full border-0 bg-transparent p-[6px_0_2px] font-mono text-[30px] font-extrabold tracking-[0.02em] text-tx outline-none tt-label"
        />
        <div className="pb-4 text-[11px] tracking-[0.06em] text-dim uppercase">{subtitle}</div>

        {/* default rest */}
        <div className="mb-4 flex flex-col gap-2 rounded-rs border border-rowbd bg-rowbg p-[12px_14px]">
          <div className="text-[11px] tracking-[0.1em] text-mut uppercase">Default rest</div>
          <RestSlider
            sec={routine.defaultRestSec}
            onCommit={(sec) => update((d) => setDefaultRest(d, id, sec))}
          />
          <div className="text-[10px] tracking-[0.03em] text-dim">
            Sets every exercise's rest — per-exercise tweaks reset
          </div>
        </div>

        {/* default RIR target */}
        <div className="mb-4 flex flex-col gap-2 rounded-rs border border-rowbd bg-rowbg p-[12px_14px]">
          <div className="text-[11px] tracking-[0.1em] text-mut uppercase">Default RIR target</div>
          <RirScale
            value={routineDefaultRIR(routine)}
            onSelect={(v) => update((d) => setDefaultTargetRIR(d, id, v))}
            height={44}
          />
          <div className="text-[10px] tracking-[0.03em] text-dim">
            Sets every exercise's target — per-exercise tweaks reset
          </div>
        </div>

        {/* warm-up */}
        <div
          onClick={() => update((d) => setWarmup(d, id, !routine.warmup))}
          className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded-rs border border-rowbd bg-rowbg p-[12px_14px]"
        >
          <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">Warm-up</div>
          <Toggle on={routine.warmup} />
        </div>

        {/* items */}
        {items.length > 1 && (
          <div className="pb-2 text-[10px] tracking-[0.06em] text-dim uppercase">
            Drag ≡ to reorder
          </div>
        )}
        <div className="flex flex-col gap-2">
          {items.map((item, i) => {
            const ex = exerciseById(db, item.exerciseId)
            const name = ex?.name ?? 'Exercise'
            const type = exerciseType(ex ?? {})
            if (expanded === item.id) {
              return (
                <ExpandedItem
                  key={item.id}
                  item={item}
                  name={name}
                  type={type}
                  defaultRest={routine.defaultRestSec}
                  defaultRir={routineDefaultRIR(routine)}
                  restOpen={restOpen === item.id}
                  onCollapse={() => setExpanded(null)}
                  onRemove={() => {
                    update((d) => removeItem(d, id, item.id))
                    setExpanded(null)
                    setRestOpen(null)
                  }}
                  onStepSets={(delta) => update((d) => stepSets(d, item.id, delta))}
                  onStepReps={(delta) => update((d) => stepReps(d, item.id, delta))}
                  onStepDur={(delta) => update((d) => stepDur(d, item.id, delta))}
                  onRir={(v) => update((d) => setItemRir(d, item.id, v))}
                  onRest={(v) => update((d) => setItemRest(d, item.id, v))}
                  onToggleRest={() => setRestOpen(restOpen === item.id ? null : item.id)}
                />
              )
            }
            return (
              <div
                key={item.id}
                data-drag-row
                style={reorder.rowStyle(i)}
                className="flex items-stretch gap-2"
              >
                <button
                  onClick={() => {
                    setExpanded(item.id)
                    setRestOpen(null)
                  }}
                  className="flex flex-1 cursor-pointer flex-col justify-center gap-1 rounded-rs border border-rowbd bg-rowbg p-[12px_14px] text-left"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] font-bold tracking-[0.03em] text-tx tt-label">
                      {name}
                    </div>
                    <TypeBadge type={type} />
                  </div>
                  <div className="text-[11px] tracking-[0.04em] text-mut tabular-nums">
                    {itemSummary(item, routine, type)}
                  </div>
                </button>
                <div className="flex items-center self-center">
                  <button
                    {...reorder.handleProps(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault()
                        update((d) => moveItem(d, id, item.id, e.key === 'ArrowUp' ? -1 : 1))
                      }
                    }}
                    aria-label={`Reorder ${name}`}
                    className="flex h-12 w-12 cursor-grab items-center justify-center rounded-rs border border-stepbd bg-stepbg text-[17px] text-mut select-none active:cursor-grabbing"
                  >
                    ≡
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <button
          onClick={() =>
            setPicker({ mode: 'add', exIdx: null, query: '', group: 'all', equip: 'all' })
          }
          className="cursor-pointer border-0 bg-transparent p-[18px_0] text-center font-mono text-[12px] tracking-[0.08em] text-mut underline underline-offset-[3px] tt-label"
        >
          + Add exercise
        </button>

        {/* rotation */}
        <div className="flex flex-col gap-3 rounded-rs border border-rowbd bg-rowbg p-[14px]">
          <div
            onClick={() => update((d) => setRotation(d, id, !inRotation))}
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">
              In rotation
            </div>
            <Toggle on={inRotation} />
          </div>
          {inRotation && (
            <div className="flex flex-wrap items-center gap-2">
              {rotationRoutines(db).map((r, i, arr) => {
                const isThis = r.id === id
                return (
                  <div key={r.id} className="flex items-center gap-2">
                    <div
                      className={`flex h-[34px] items-center rounded-full border px-[12px] text-[11px] tracking-[0.06em] tt-label ${
                        isThis
                          ? 'border-acc bg-acc font-extrabold text-onacc'
                          : 'border-stepbd bg-stepbg text-mut'
                      }`}
                    >
                      {r.name}
                    </div>
                    {i < arr.length - 1 && <div className="text-[11px] text-dim">→</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => setConfirmDelete(true)}
          className="cursor-pointer border-0 bg-transparent p-[22px_0_4px] text-center font-mono text-[11px] tracking-[0.1em] text-dim underline underline-offset-[3px] tt-label"
        >
          Delete routine
        </button>
      </div>

      {confirmDelete && (
        <ConfirmSheet
          title={`Delete ${routine.name}?`}
          body="Past workouts stay in history — only the routine and its plan are removed."
          confirmLabel="Delete routine"
          cancelLabel="Keep"
          onConfirm={() => {
            update((d) => deleteRoutine(d, id))
            navigate('/routines')
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {picker && (
        <ExercisePicker
          filter={picker}
          title="Add exercise"
          items={pickerItems}
          onChange={setPicker}
          onPick={(ex) => {
            const itemId = newId('ri')
            update((d) => addItem(d, id, ex.id ?? '', itemId))
            setPicker(null)
            setExpanded(itemId)
            setRestOpen(null)
          }}
          onCancel={() => setPicker(null)}
          showEquipment={false}
          footnote={null}
        />
      )}
    </div>
  )
}

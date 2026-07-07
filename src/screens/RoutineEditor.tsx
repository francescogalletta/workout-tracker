import { useEffect, useState } from 'react'
import { exerciseById, itemsForRoutine, rotationRoutines, routineById } from '../data/queries'
import { update, useDb } from '../data/store'
import type { Db, RoutineItem } from '../data/types'
import { newId } from '../data/types'
import { navigate } from '../router'
import {
  ExercisePicker,
  filterDb,
  type PickerFilter,
} from '../runner/components/ExercisePicker'
import { toPickerItem } from '../runner/fromStore'
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
    routines: db.routines.map((r) => (r.id === routineId ? { ...r, name } : r)),
  }
}

export function setDefaultRest(db: Db, routineId: string, sec: number): Db {
  return {
    ...db,
    routines: db.routines.map((r) => (r.id === routineId ? { ...r, defaultRestSec: sec } : r)),
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

export function setItemRir(db: Db, itemId: string, rir: number): Db {
  return {
    ...db,
    routineItems: db.routineItems.map((it) => (it.id === itemId ? { ...it, targetRIR: rir } : it)),
  }
}

/** Override rest for one item; `null` reverts to the routine default. */
export function setItemRest(db: Db, itemId: string, restSec: number | null): Db {
  return {
    ...db,
    routineItems: db.routineItems.map((it) => (it.id === itemId ? { ...it, restSec } : it)),
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

/** Append an item (3×10 @ RIR 2, rest = routine default) with the given id. */
export function addItem(db: Db, routineId: string, exerciseId: string, id: string): Db {
  const order = itemsForRoutine(db, routineId).length
  const item: RoutineItem = {
    id,
    routineId,
    exerciseId,
    order,
    sets: 3,
    repsPerSet: 10,
    targetRIR: 2,
    restSec: null,
  }
  return { ...db, routineItems: [...db.routineItems, item] }
}

/** Re-rank every in-rotation routine to a dense 0..n-1 by current cycleOrder. */
export function normalizeRotation<T extends { id: string; cycleOrder: number | null }>(
  routines: T[],
): T[] {
  const ranked = routines
    .filter((r) => r.cycleOrder !== null)
    .slice()
    .sort((a, b) => (a.cycleOrder as number) - (b.cycleOrder as number))
  const rank = new Map(ranked.map((r, i) => [r.id, i]))
  return routines.map((r) => (rank.has(r.id) ? { ...r, cycleOrder: rank.get(r.id)! } : r))
}

/**
 * Toggle rotation membership. Enabling appends this routine at the end of the
 * cycle; disabling drops it. Either way the remaining routines stay a dense
 * 0..n-1 sequence.
 *
 * Delegates to the shared rotation helpers in `routineOps` (which Home and
 * Routines also use) so the editor and the list screens can never disagree on
 * cycleOrder semantics — notably both now exclude archived routines from the
 * numbering. `normalizeRotation` below is retained as a generic densifier.
 */
export function setRotation(db: Db, routineId: string, inRotation: boolean): Db {
  return {
    ...db,
    routines: inRotation
      ? addToRotation(db.routines, routineId)
      : removeFromRotation(db.routines, routineId),
  }
}

export function itemSummary(item: RoutineItem, defaultRest: number): string {
  return `${item.sets}×${item.repsPerSet} @ RIR ${item.targetRIR} · rest ${item.restSec ?? defaultRest}s`
}

// ── Small presentational bits ──────────────────────────────────────────────

function Toggle({ on }: { on: boolean }) {
  return (
    <div
      className={`box-border flex h-8 w-[52px] items-center rounded-full border px-[3px] ${
        on ? 'justify-end border-acc bg-acc' : 'justify-start border-stepbd bg-stepbg'
      }`}
    >
      <div className={`h-6 w-6 rounded-full ${on ? 'bg-onacc' : 'bg-mut'}`} />
    </div>
  )
}

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

const REST_CHIPS: Array<number | null> = [null, 60, 90, 120, 180]

// ── Expanded item card ─────────────────────────────────────────────────────

function ExpandedItem({
  item,
  name,
  defaultRest,
  restOpen,
  onCollapse,
  onRemove,
  onStepSets,
  onStepReps,
  onRir,
  onRest,
  onToggleRest,
}: {
  item: RoutineItem
  name: string
  defaultRest: number
  restOpen: boolean
  onCollapse: () => void
  onRemove: () => void
  onStepSets: (d: number) => void
  onStepReps: (d: number) => void
  onRir: (v: number) => void
  onRest: (v: number | null) => void
  onToggleRest: () => void
}) {
  const effectiveRest = item.restSec ?? defaultRest
  return (
    <div className="flex flex-col gap-[14px] rounded-rl border border-cardbd bg-cardbg p-[16px_14px]">
      <div onClick={onCollapse} className="flex cursor-pointer items-baseline justify-between">
        <div className="text-[14px] font-bold tracking-[0.04em] text-acc tt-label">{name}</div>
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
        {(
          [
            ['Sets', item.sets, onStepSets],
            ['Reps', item.repsPerSet, onStepReps],
          ] as const
        ).map(([lbl, val, step]) => (
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

      <div className="flex flex-col gap-[6px]">
        <div className="text-[10px] tracking-[0.16em] text-mut uppercase">Target RIR</div>
        <div className="grid grid-cols-5 gap-[6px]">
          {[0, 1, 2, 3, 4].map((v) => {
            const sel = item.targetRIR === v
            return (
              <button
                key={v}
                onClick={() => onRir(v)}
                className={`flex h-11 items-center justify-center rounded-rs border text-[14px] ${
                  sel
                    ? 'border-acc bg-acc font-extrabold text-onacc'
                    : 'border-stepbd bg-stepbg text-sec'
                }`}
              >
                {v === 4 ? '4+' : v}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] tracking-[0.16em] text-mut uppercase">Rest</div>
        {!restOpen && (
          <button
            onClick={onToggleRest}
            className="box-border flex min-w-[76px] cursor-pointer flex-col items-center gap-[2px] rounded-rs border border-stepbd bg-stepbg px-[14px] py-2"
          >
            <div className="text-[18px] font-extrabold text-tx tabular-nums">{effectiveRest}s</div>
            {item.restSec === null && (
              <div className="text-[8px] tracking-[0.12em] text-mut uppercase">default</div>
            )}
          </button>
        )}
      </div>
      {restOpen && (
        <div className="flex flex-wrap gap-[6px]">
          {REST_CHIPS.map((r) => (
            <ChoiceChip
              key={r === null ? 'default' : r}
              label={r === null ? `Default · ${defaultRest}s` : `${r}s`}
              selected={item.restSec === r}
              onClick={() => onRest(r)}
              h={44}
            />
          ))}
        </div>
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
      <div className="box-border flex w-full max-w-[430px] flex-col p-[20px_18px_28px]">
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
          className="w-full border-0 bg-transparent p-[6px_0_2px] font-mono text-[30px] font-extrabold tracking-[0.02em] text-tx outline-none tt-label"
        />
        <div className="pb-4 text-[11px] tracking-[0.06em] text-dim uppercase">{subtitle}</div>

        {/* default rest */}
        <div className="mb-4 flex items-center justify-between gap-3 rounded-rs border border-rowbd bg-rowbg p-[12px_14px]">
          <div className="text-[11px] tracking-[0.1em] text-mut uppercase">Default rest</div>
          <div className="flex gap-[6px]">
            {[60, 90, 120].map((r) => (
              <ChoiceChip
                key={r}
                label={`${r}s`}
                selected={routine.defaultRestSec === r}
                onClick={() => update((d) => setDefaultRest(d, id, r))}
              />
            ))}
          </div>
        </div>

        {/* warm-up */}
        <div
          onClick={() => update((d) => setWarmup(d, id, !routine.warmup))}
          className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded-rs border border-rowbd bg-rowbg p-[12px_14px]"
        >
          <div className="flex flex-col gap-[3px]">
            <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">
              Warm-up section
            </div>
            <div className="text-[10px] tracking-[0.03em] text-mut">
              Opens the session · 50% × 8, then 70% × 5 of the first exercise's weight
            </div>
          </div>
          <Toggle on={routine.warmup} />
        </div>

        {/* items */}
        <div className="flex flex-col gap-2">
          {items.map((item, i) => {
            const name = exerciseById(db, item.exerciseId)?.name ?? 'Exercise'
            if (expanded === item.id) {
              return (
                <ExpandedItem
                  key={item.id}
                  item={item}
                  name={name}
                  defaultRest={routine.defaultRestSec}
                  restOpen={restOpen === item.id}
                  onCollapse={() => setExpanded(null)}
                  onRemove={() => {
                    update((d) => removeItem(d, id, item.id))
                    setExpanded(null)
                    setRestOpen(null)
                  }}
                  onStepSets={(delta) => update((d) => stepSets(d, item.id, delta))}
                  onStepReps={(delta) => update((d) => stepReps(d, item.id, delta))}
                  onRir={(v) => update((d) => setItemRir(d, item.id, v))}
                  onRest={(v) => {
                    update((d) => setItemRest(d, item.id, v))
                    setRestOpen(null)
                  }}
                  onToggleRest={() => setRestOpen(item.id)}
                />
              )
            }
            return (
              <div key={item.id} className="flex items-stretch gap-2">
                <button
                  onClick={() => {
                    setExpanded(item.id)
                    setRestOpen(null)
                  }}
                  className="flex flex-1 cursor-pointer flex-col justify-center gap-1 rounded-rs border border-rowbd bg-rowbg p-[12px_14px] text-left"
                >
                  <div className="text-[13px] font-bold tracking-[0.03em] text-tx tt-label">
                    {name}
                  </div>
                  <div className="text-[11px] tracking-[0.04em] text-mut tabular-nums">
                    {itemSummary(item, routine.defaultRestSec)}
                  </div>
                </button>
                <div className="flex items-center gap-1 self-center">
                  <button
                    onClick={() => update((d) => moveItem(d, id, item.id, -1))}
                    className={`flex h-12 w-12 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg text-[15px] ${
                      i === 0 ? 'text-dim' : 'text-tx'
                    }`}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => update((d) => moveItem(d, id, item.id, 1))}
                    className={`flex h-12 w-12 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg text-[15px] ${
                      i === items.length - 1 ? 'text-dim' : 'text-tx'
                    }`}
                  >
                    ↓
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
      </div>

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

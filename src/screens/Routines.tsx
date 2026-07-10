import { Toggle } from '../components/Toggle'
import { startSession } from '../data/mutations'
import { nextInRotation } from '../data/queries'
import { useDb } from '../data/store'
import type { Routine } from '../data/types'
import { navigate } from '../router'
import {
  createRoutine,
  nonRotationList,
  reorderRotationMut,
  rotationList,
  routineSub,
  setInRotation,
} from './routineOps'

/**
 * Routines (design/prototypes/Routines.dc.html). Two hairline-labelled
 * sections: the ordered rotation (position badges, ↑/↓ reorder, in-rotation
 * toggle) and non-rotation routines (toggle off, Start). Tapping a name opens
 * its editor; "+ New routine" creates one and opens the editor. First-run
 * empty state when there are no routines.
 */
export function Routines() {
  const db = useDb()
  const rotation = rotationList(db.routines)
  const others = nonRotationList(db.routines)
  const nextId = nextInRotation(db)?.id ?? null
  const firstRun = db.routines.filter((r) => !r.archived).length === 0

  const start = (r: Routine) => {
    startSession(r)
    navigate('/run')
  }
  const openEditor = (r: Routine) => navigate(`/routines/${r.id}`)

  return (
    <div className="flex min-h-screen justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col pt-5 pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+24px)] pl-[max(18px,var(--safe-left))]">
        <div className="flex items-baseline pb-4">
          <div className="tt-label text-[17px] font-bold tracking-[0.05em] text-tx">Routines</div>
        </div>

        {firstRun ? (
          <div className="flex flex-col gap-6 px-1 py-[70px]">
            <div className="flex flex-col gap-[10px]">
              <div className="tt-label text-[13px] font-bold tracking-[0.06em] text-sec">
                No routines yet
              </div>
              <p className="text-[11px] leading-[1.8] text-mut">
                A routine is your workout, planned once: exercises in order, sets × reps, target
                RIR, rest. At the gym everything is prefilled.
              </p>
            </div>
            <button
              onClick={() => {
                const r = createRoutine()
                navigate(`/routines/${r.id}`)
              }}
              className="tt-label flex h-[60px] w-full cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[14px] font-extrabold tracking-[0.06em] text-onacc"
            >
              Create first routine
            </button>
          </div>
        ) : (
          <>
            <SectionLabel label="Rotation · repeats in this order" />
            <div className="flex flex-col gap-[10px]">
              {rotation.map((r, i) => (
                <RotationRow
                  key={r.id}
                  routine={r}
                  pos={i + 1}
                  upNext={r.id === nextId}
                  firstInList={i === 0}
                  lastInList={i === rotation.length - 1}
                  sub={routineSub(db, r, r.id === nextId)}
                  onStart={() => start(r)}
                  onOpen={() => openEditor(r)}
                  onToggleOff={() => setInRotation(r.id, false)}
                  onUp={() => reorderRotationMut(r.id, -1)}
                  onDown={() => reorderRotationMut(r.id, 1)}
                />
              ))}
            </div>

            <div className="pt-[22px]">
              <SectionLabel label="Not in rotation · start any time" />
            </div>
            <div className="flex flex-col gap-[10px]">
              {others.map((r) => (
                <OtherRow
                  key={r.id}
                  routine={r}
                  sub={routineSub(db, r, false)}
                  onStart={() => start(r)}
                  onOpen={() => openEditor(r)}
                  onToggleOn={() => setInRotation(r.id, true)}
                />
              ))}
              {others.length === 0 && (
                <div className="py-[14px] text-center text-[11px] text-dim">
                  All routines are in the rotation
                </div>
              )}
            </div>

            <button
              onClick={() => {
                const r = createRoutine()
                navigate(`/routines/${r.id}`)
              }}
              className="tt-label cursor-pointer border-0 bg-transparent px-0 pt-[22px] pb-1 text-center font-mono text-[12px] tracking-[0.08em] text-mut underline underline-offset-[3px]"
            >
              + New routine
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[10px] pb-[10px]">
      <div className="text-[9px] tracking-[0.2em] whitespace-nowrap text-mut uppercase">
        {label}
      </div>
      <div className="h-px flex-1 bg-bd" />
    </div>
  )
}

/** 44 px reorder / start controls share this outline style. */
const CTRL =
  'flex items-center justify-center rounded-rs border border-stepbd bg-stepbg font-mono select-none'

function RotationRow({
  routine,
  pos,
  upNext,
  firstInList,
  lastInList,
  sub,
  onStart,
  onOpen,
  onToggleOff,
  onUp,
  onDown,
}: {
  routine: Routine
  pos: number
  upNext: boolean
  firstInList: boolean
  lastInList: boolean
  sub: string
  onStart: () => void
  onOpen: () => void
  onToggleOff: () => void
  onUp: () => void
  onDown: () => void
}) {
  return (
    <div
      className={`flex flex-col gap-[10px] rounded-rl border p-[12px_14px] ${
        upNext ? 'border-bds' : 'border-rowbd'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-extrabold tabular-nums ${
            upNext
              ? 'border-acc bg-acc text-onacc'
              : 'border-stepbd bg-stepbg text-mut'
          }`}
        >
          {pos}
        </div>
        <button
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-[3px] border-0 bg-transparent p-0 text-left"
        >
          <div className="tt-label text-[13px] font-bold tracking-[0.03em] text-tx">
            {routine.name}
          </div>
          <div
            className={`truncate text-[10px] tracking-[0.06em] uppercase ${
              upNext ? 'text-acc' : 'text-dim'
            }`}
          >
            {sub}
          </div>
        </button>
        <ToggleSwitch on onClick={onToggleOff} />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onStart}
          className={`h-[44px] cursor-pointer px-[18px] text-[11px] font-bold tracking-[0.1em] text-tx uppercase ${CTRL}`}
        >
          Start ▸
        </button>
        <div className="flex-1" />
        <button
          onClick={onUp}
          disabled={firstInList}
          className={`h-[44px] w-[44px] cursor-pointer text-[15px] ${CTRL} ${
            firstInList ? 'text-dim' : 'text-tx'
          }`}
        >
          ↑
        </button>
        <button
          onClick={onDown}
          disabled={lastInList}
          className={`h-[44px] w-[44px] cursor-pointer text-[15px] ${CTRL} ${
            lastInList ? 'text-dim' : 'text-tx'
          }`}
        >
          ↓
        </button>
      </div>
    </div>
  )
}

function OtherRow({
  routine,
  sub,
  onStart,
  onOpen,
  onToggleOn,
}: {
  routine: Routine
  sub: string
  onStart: () => void
  onOpen: () => void
  onToggleOn: () => void
}) {
  return (
    <div className="flex flex-col gap-[10px] rounded-rl border border-rowbd p-[12px_14px]">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-[3px] border-0 bg-transparent p-0 text-left"
        >
          <div className="tt-label text-[13px] font-bold tracking-[0.03em] text-sec">
            {routine.name}
          </div>
          <div className="truncate text-[10px] tracking-[0.06em] text-dim uppercase">{sub}</div>
        </button>
        <ToggleSwitch on={false} onClick={onToggleOn} />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onStart}
          className={`h-[44px] cursor-pointer px-[18px] text-[11px] font-bold tracking-[0.1em] text-tx uppercase ${CTRL}`}
        >
          Start ▸
        </button>
      </div>
    </div>
  )
}

/** Captioned in-rotation toggle: "In rotation" label + the shared switch track. */
function ToggleSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 border-0 bg-transparent py-2 pr-0 pl-2"
    >
      <span
        className={`text-[8px] tracking-[0.12em] uppercase ${on ? 'text-mut' : 'text-dim'}`}
      >
        In rotation
      </span>
      <Toggle on={on} />
    </button>
  )
}

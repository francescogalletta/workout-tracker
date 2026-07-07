import { useState } from 'react'
import { startSession } from '../data/mutations'
import { lastCompletedSession, nextInRotation, routineById } from '../data/queries'
import { useDb } from '../data/store'
import type { Routine } from '../data/types'
import { navigate } from '../router'
import { Sheet } from '../runner/components/ui'
import {
  createRoutine,
  exerciseNames,
  lastSessionLine,
  previewLines,
  rotationList,
} from './routineOps'

/**
 * Home (design/prototypes/Home.dc.html). Ultra-minimal: rotation eyebrow +
 * suggested routine name + 2-line preview + change-routine sheet, "Last ·"
 * line, 68 px Start. First-run empty state when there are no routines.
 * The resume-or-discard prompt is App-owned (App.tsx) and overlays this.
 */
export function Home() {
  const db = useDb()
  const rotation = rotationList(db.routines)
  const suggested = nextInRotation(db)
  const routines = db.routines.filter((r) => !r.archived)

  // Local selection: which routine Start will launch. Defaults to the
  // rotation suggestion; the change-routine sheet re-points it (never starts).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const selected: Routine | null =
    (selectedId ? routineById(db, selectedId) : null) ?? suggested ?? routines[0] ?? null

  const firstRun = routines.length === 0

  return (
    <div className="flex min-h-screen justify-center bg-bg font-mono">
      <div className="box-border flex min-h-screen w-full max-w-[430px] flex-col px-5 pt-5 pb-7">
        <div className="flex flex-1 flex-col justify-center gap-[10px]">
          {firstRun ? (
            <>
              <div className="text-[11px] tracking-[0.18em] text-mut uppercase">Welcome</div>
              <div className="tt-label text-[44px] font-extrabold tracking-[0.02em] text-tx">
                No routines yet
              </div>
              <p className="tt-label text-[12px] leading-[1.7] tracking-[0.04em] text-mut">
                Plan a workout once —<br />
                every session after is tap · tap · tap.
              </p>
            </>
          ) : selected ? (
            <HomeSuggestion
              selected={selected}
              names={exerciseNames(db, selected.id)}
              rotation={rotation}
              lastLine={lastSessionLine(lastCompletedSession(db))}
              onChange={() => setSheetOpen(true)}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-[18px]">
          {firstRun ? (
            <button
              onClick={() => {
                const r = createRoutine()
                navigate(`/routines/${r.id}`)
              }}
              className="tt-label flex h-[68px] w-full cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[16px] font-extrabold tracking-[0.08em] text-onacc"
            >
              Create first routine
            </button>
          ) : selected ? (
            <button
              onClick={() => {
                startSession(selected)
                navigate('/run')
              }}
              className="tt-label flex h-[68px] w-full cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[16px] font-extrabold tracking-[0.08em] text-onacc"
            >
              Start workout
            </button>
          ) : null}
        </div>
      </div>

      {sheetOpen && (
        <ChangeRoutineSheet
          routines={routines}
          selectedId={selected?.id ?? null}
          suggestedId={suggested?.id ?? null}
          onPick={(id) => {
            setSelectedId(id)
            setSheetOpen(false)
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}

function HomeSuggestion({
  selected,
  names,
  rotation,
  lastLine,
  onChange,
}: {
  selected: Routine
  names: string[]
  rotation: Routine[]
  lastLine: string | null
  onChange: () => void
}) {
  const [line1, line2] = previewLines(names)
  const rotIndex = rotation.findIndex((r) => r.id === selected.id)
  const eyebrow =
    rotIndex === -1
      ? 'One-off · not in rotation'
      : `Next in rotation · ${rotIndex + 1} of ${rotation.length}`

  return (
    <>
      <div className="text-[11px] tracking-[0.18em] text-mut uppercase">{eyebrow}</div>
      <div className="tt-label text-[44px] font-extrabold tracking-[0.02em] text-tx">
        {selected.name}
      </div>
      <div className="tt-label text-[12px] leading-[1.7] tracking-[0.04em] text-mut">
        {line1}
        {line2 && (
          <>
            <br />
            {line2}
          </>
        )}
      </div>
      <button
        onClick={onChange}
        className="tt-label mt-[6px] cursor-pointer self-start border-0 bg-transparent py-2 font-mono text-[11px] tracking-[0.1em] text-dim underline underline-offset-[3px]"
      >
        Change routine
      </button>
      {lastLine && (
        <div className="tt-label mt-6 text-[11px] tracking-[0.06em] text-dim">{lastLine}</div>
      )}
    </>
  )
}

function ChangeRoutineSheet({
  routines,
  selectedId,
  suggestedId,
  onPick,
  onClose,
}: {
  routines: Routine[]
  selectedId: string | null
  suggestedId: string | null
  onPick: (id: string) => void
  onClose: () => void
}) {
  return (
    <Sheet onClose={onClose} z={50}>
      <div className="flex flex-col gap-2">
        <div className="pb-[6px] text-[11px] tracking-[0.16em] text-mut uppercase">
          Start instead
        </div>
        {routines.map((r) => {
          const sel = r.id === selectedId
          const sub = sel
            ? 'suggested'
            : r.id === suggestedId
              ? 'suggested next'
              : r.cycleOrder !== null
                ? 'in rotation'
                : 'not in rotation'
          return (
            <button
              key={r.id}
              onClick={() => onPick(r.id)}
              className={`flex items-center justify-between gap-[10px] rounded-rs border px-[14px] py-[15px] text-left ${
                sel ? 'border-acc bg-acc' : 'border-rowbd bg-transparent'
              }`}
            >
              <span
                className={`tt-label text-[13px] font-bold tracking-[0.03em] ${
                  sel ? 'text-onacc' : 'text-tx'
                }`}
              >
                {r.name}
              </span>
              <span
                className={`text-[10px] tracking-[0.08em] uppercase ${
                  sel ? 'text-onacc' : 'text-dim'
                }`}
              >
                {sub}
              </span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

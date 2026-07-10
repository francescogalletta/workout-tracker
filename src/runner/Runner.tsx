import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { addSetLog, finishSession, updateRoutineItemExercise } from '../data/mutations'
import { getDb, useDb } from '../data/store'
import type { Session } from '../data/types'
import { newId } from '../data/types'
import { ensureAudio, restClick, restDone } from '../lib/audio'
import { fmtClock, fmtDur, fmtMetricLine, fmtW } from '../lib/format'
import { useWakeLock } from '../lib/useWakeLock'
import { ActiveSetCard, type ActiveSetCardHandle } from './components/ActiveSetCard'
import { ExercisePicker, filterDb, type PickerFilter } from './components/ExercisePicker'
import { RestOverlay } from './components/RestOverlay'
import {
  FinishConfirmSheet,
  ReorderSheet,
  RestSessionSheet,
  StepChooserSheet,
  SwapConfirmSheet,
} from './components/sheets'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { SummaryScreen } from './components/SummaryScreen'
import { TypeBadge } from './components/TypeBadge'
import { OutlineButton, QuietLink } from './components/ui'
import { restoreState, syncLoggedEdits, toPickerItem } from './fromStore'
import { loggedWorkingSets, reduce, typeOf } from './session'
import type { DbExercise, SessionExercise, SetEntry } from './types'

/** In-memory hold-timer state for the active `time`-type set (§3.3). Not
 * persisted or reducer-owned — reset whenever the pointer moves. */
interface HoldState {
  key: string
  startedAt: number
  accSec: number
  running: boolean
  overFired: boolean
}

/**
 * Resolve the iOS safe-area top inset (--safe-top) to pixels, once. The custom
 * property holds an `env()` expression that getComputedStyle won't resolve, so
 * we measure it off a throwaway probe whose height IS the env() value. In a
 * normal browser tab (env → 0) this returns 0 and the auto-scroll offset is
 * unchanged. Cached because the inset is fixed for the session.
 */
let cachedSafeTop: number | null = null
function safeTopPx(): number {
  if (cachedSafeTop !== null) return cachedSafeTop
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;'
  document.body.appendChild(probe)
  cachedSafeTop = probe.getBoundingClientRect().height
  probe.remove()
  return cachedSafeTop
}

/**
 * The Workout Runner, wired to the store: the session is built from the
 * routine + engine output (restoring any already-logged sets on resume),
 * every logged set writes a SetLog immediately, and Finish stamps the
 * Session row. UI state (pointer, rest, sheets) stays in-memory.
 */
export function Runner({ session, onDone }: { session: Session; onDone: () => void }) {
  const db = useDb()
  const settings = db.settings

  const [state, dispatch] = useReducer(reduce, undefined, () =>
    restoreState(getDb(), session, Date.now()),
  )
  const [now, setNow] = useState(() => Date.now())

  // Native numeric entry (weight/reps): the log bar hides while a field is
  // focused so it never floats above the keyboard; an imperative handle
  // (activeCardHandle) raises the weight field when Log is hit without a weight.
  //
  // A begin/end *counter* (not a boolean) survives out-of-order focus events:
  // switching weight → reps fires the new field's begin before the old field's
  // late blur, so a last-writer-wins boolean would leave the bar showing over
  // the open keyboard. editing = count > 0.
  const editCount = useRef(0)
  const [numEditing, setNumEditing] = useState(false)
  const onEditingChange = useCallback((editing: boolean) => {
    editCount.current = Math.max(0, editCount.current + (editing ? 1 : -1))
    setNumEditing(editCount.current > 0)
  }, [])
  // Imperative handle to the active card so logActive can focus the weight
  // field synchronously inside its own tap gesture (see ActiveSetCardHandle).
  const activeCardHandle = useRef<ActiveSetCardHandle>(null)
  const [picker, setPicker] = useState<PickerFilter | null>(null)
  const [swapConfirm, setSwapConfirm] = useState<DbExercise | null>(null)
  const [reorderOpen, setReorderOpen] = useState(false)
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false)
  // Holds the exercise object, not an array index — reorder keeps the same
  // references (so indexOf re-finds it), and a swap replaces the object (so
  // indexOf returns -1 and the stale +1 is safely dropped).
  const [addSetConfirm, setAddSetConfirm] = useState<SessionExercise | null>(null)
  const [stepOverride, setStepOverride] = useState<number | null>(null)
  const [stepChooserOpen, setStepChooserOpen] = useState(false)
  const [restSheetOpen, setRestSheetOpen] = useState(false)
  const [hold, setHold] = useState<HoldState | null>(null)

  const holdFired = useRef(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastClickSecond = useRef<number | null>(null)
  const activeCardEl = useRef<HTMLDivElement | null>(null)

  // Stable ref callback: the active card remounts per set, but this closure
  // must not — an inline one re-runs its cleanup/attach on every 250ms tick.
  const cardRef = useCallback((el: HTMLDivElement | null) => {
    activeCardEl.current = el
    // React 19 ref cleanup: clear the ref when the active card unmounts so the
    // auto-scroll effect never reads a detached node between one active card
    // unmounting and the next mounting.
    return () => {
      if (activeCardEl.current === el) activeCardEl.current = null
    }
  }, [])

  const step = stepOverride ?? settings.weightIncrementKg
  const ptr = state.ptr
  const cur: SetEntry | undefined = state.sets[ptr.e]?.[ptr.s]
  const curEx: SessionExercise | undefined = state.exercises[ptr.e]

  useWakeLock(!state.finished)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  // Edits to already-logged sets flow back to their SetLog rows.
  useEffect(() => {
    syncLoggedEdits(getDb(), state)
  }, [state.sets])

  // Rest countdown cues: click each of the final 5 s, tone at 0 (SPEC §5.2).
  useEffect(() => {
    if (!state.resting || state.finished) return
    const remain = Math.ceil((state.resting.endsAt - now) / 1000)
    if (remain <= 5 && remain >= 1 && remain !== lastClickSecond.current) {
      lastClickSecond.current = remain
      if (settings.soundEnabled) restClick()
    }
    if (remain <= 0) {
      lastClickSecond.current = null
      if (settings.soundEnabled) restDone()
      dispatch({ type: 'restEnd' })
    }
  }, [now, state.resting, state.finished, settings.soundEnabled])

  // Auto-scroll the active card into view when the pointer advances.
  useEffect(() => {
    const el = activeCardEl.current
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect()
      // 130 clears the sticky-free Runner header; add the safe-area top inset so
      // the active card lands below the notch/status bar on standalone iOS.
      const offset = 130 + safeTopPx()
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - offset), behavior: 'smooth' })
    }
  }, [ptr.e, ptr.s])

  // Timed sets (§3.3): the hold timer is scoped to the pointed set — reset it
  // whenever the pointer moves to a different set.
  useEffect(() => {
    setHold(null)
  }, [ptr.e, ptr.s])

  // Chime once the hold reaches its target; never auto-logs.
  useEffect(() => {
    if (!hold || !hold.running || hold.overFired) return
    const target = cur?.durSec ?? 30
    const elapsedNow = hold.accSec + (now - hold.startedAt) / 1000
    if (elapsedNow >= target) {
      if (settings.soundEnabled) restDone()
      setHold((h) => (h ? { ...h, overFired: true } : h))
    }
  }, [now, hold, cur?.durSec, settings.soundEnabled])

  const timerElapsed = hold ? hold.accSec + (hold.running ? (now - hold.startedAt) / 1000 : 0) : 0

  const toggleTimer = () => {
    if (!cur) return
    if (!hold) {
      ensureAudio()
      setHold({ key: `${ptr.e}:${ptr.s}`, startedAt: Date.now(), accSec: 0, running: true, overFired: false })
      return
    }
    if (hold.running) {
      setHold({ ...hold, accSec: hold.accSec + (Date.now() - hold.startedAt) / 1000, running: false })
    } else {
      setHold({ ...hold, startedAt: Date.now(), running: true })
    }
  }

  const holdStart = () => {
    holdFired.current = false
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      holdFired.current = true
      setStepChooserOpen(true)
    }, 450)
  }
  const holdEnd = () => clearTimeout(holdTimer.current)

  const stepWeight = (dir: 1 | -1) => {
    if (holdFired.current) {
      holdFired.current = false
      return
    }
    dispatch({ type: 'stepWeight', dir, step })
  }

  const logActive = () => {
    ensureAudio()
    if (!cur || !curEx) return
    const curType = typeOf(curEx)
    if (curEx.kind === 'strength' && curType === 'weight' && cur.weight === null) {
      activeCardHandle.current?.focusWeight()
      return
    }
    lastClickSecond.current = null

    const isTimed = curEx.kind === 'strength' && curType === 'time'
    const durSec = isTimed
      ? hold
        ? Math.max(1, Math.round(timerElapsed))
        : (cur.durSec ?? 30)
      : undefined
    const logWeight = isTimed || (curEx.kind === 'strength' && curType === 'reps') ? 0 : (cur.weight ?? 0)
    const logReps = isTimed ? 0 : cur.reps
    const logRir = isTimed ? null : cur.rir

    let logId: string | undefined
    if (!cur.logged && !cur.logId) {
      // Write the SetLog immediately — history sees it live.
      logId = newId('l')
      const arr = state.sets[ptr.e]
      const setNumber = arr.slice(0, ptr.s + 1).filter((x) => x.isWarmup === cur.isWarmup).length
      addSetLog({
        id: logId,
        sessionId: session.id,
        exerciseId: curEx.exerciseId ?? '',
        exerciseName: curEx.name,
        setNumber,
        isWarmup: cur.isWarmup,
        weightKg: logWeight,
        reps: logReps,
        rir: logRir,
        durSec,
        values: cur.values ? { ...cur.values } : null,
        completedAt: Date.now(),
      })
    }
    dispatch({ type: 'log', now: Date.now(), settings, logId, durSec })
    if (isTimed) setHold(null)
  }

  const applySwapPick = (item: DbExercise, alsoRoutine: boolean) => {
    if (picker?.exIdx != null) {
      if (alsoRoutine) {
        const itemId = state.exercises[picker.exIdx].routineItemId
        if (itemId && item.id) updateRoutineItemExercise(itemId, item.id)
      }
      dispatch({ type: 'swap', exIdx: picker.exIdx, item })
    }
    setSwapConfirm(null)
    setPicker(null)
  }

  const finishNow = () => {
    setFinishConfirmOpen(false)
    const t = Date.now()
    finishSession(session.id, t)
    dispatch({ type: 'finish', now: t })
  }

  // ---- list view-model (warm-up hoisting per handoff README §6) ----
  type RowVM = { divider: string } | { e: number; s: number }
  interface SectionVM {
    title: string
    scheme: string
    exIdx: number | null
    rows: RowVM[]
  }

  const sections: SectionVM[] = []
  const firstWu: RowVM[] = []
  state.exercises.forEach((ex, ei) => {
    const arr = state.sets[ei]
    const wu = arr.map((_, si) => si).filter((si) => arr[si].isWarmup)
    const work = arr.map((_, si) => si).filter((si) => !arr[si].isWarmup)
    let rows: RowVM[]
    if (ei === 0) {
      firstWu.push(...wu.map((si) => ({ e: ei, s: si })))
      rows = work.map((si) => ({ e: ei, s: si }))
    } else if (wu.length) {
      rows = [
        { divider: 'Warm-up' },
        ...wu.map((si) => ({ e: ei, s: si })),
        { divider: 'Working sets' },
        ...work.map((si) => ({ e: ei, s: si })),
      ]
    } else {
      rows = arr.map((_, si) => ({ e: ei, s: si }))
    }
    sections.push({ title: ex.name, scheme: ex.scheme, exIdx: ei, rows })
  })
  if (firstWu.length) {
    sections.unshift({ title: 'Warm-up', scheme: '', exIdx: null, rows: firstWu })
  }

  const renderSetRow = (e: number, s: number) => {
    const ex = state.exercises[e]
    const sd = state.sets[e][s]
    const arr = state.sets[e]
    const isActive = !state.finished && ptr.e === e && ptr.s === s
    const workIdx = arr.slice(0, s + 1).filter((x) => !x.isWarmup).length
    const workTot = arr.filter((x) => !x.isWarmup).length

    const type = typeOf(ex)

    if (isActive) {
      const setLabel =
        ex.kind === 'cardio'
          ? 'Cardio'
          : sd.isWarmup
            ? e === 0
              ? ex.name
              : 'Warm-up'
            : type === 'time'
              ? `Set ${workIdx} of ${workTot} · target ${fmtDur(sd.durSec ?? 30)}`
              : `Set ${workIdx} of ${workTot}`
      return (
        <ActiveSetCard
          key={s}
          ref={activeCardHandle}
          exercise={ex}
          exIdx={e}
          entry={sd}
          setLabel={setLabel}
          step={step}
          cardRef={cardRef}
          onStepWeight={stepWeight}
          onHoldStart={holdStart}
          onHoldEnd={holdEnd}
          onTypeWeight={(value) => dispatch({ type: 'typeWeight', value })}
          onStepReps={(dir) => dispatch({ type: 'stepReps', dir })}
          onTypeReps={(value) => dispatch({ type: 'typeReps', value })}
          onEditingChange={onEditingChange}
          onSelectRir={(value) => dispatch({ type: 'selectRir', value })}
          onStepMetric={(key, dir) => dispatch({ type: 'stepMetric', key, dir })}
          onDismissPlateau={() => dispatch({ type: 'dismissPlateau', exIdx: e })}
          onStepDur={(dir) => dispatch({ type: 'stepDur', dir })}
          onToggleTimer={toggleTimer}
          timerElapsed={timerElapsed}
          timerRunning={!!hold?.running}
          timerStarted={!!hold}
        />
      )
    }

    const prefix = sd.isWarmup ? (e === 0 ? `${ex.name} · ` : '') : `Set ${workIdx}   `
    const dotPrefix = sd.isWarmup ? (e === 0 ? `${ex.name} · ` : '') : `Set ${workIdx} · `
    let text: string
    if (ex.kind === 'cardio') {
      text = fmtMetricLine(ex.metrics ?? [], sd.values ?? {})
    } else if (type === 'reps') {
      const rirTxt = sd.logged
        ? sd.rir !== null
          ? ` · RIR ${sd.rir}`
          : ''
        : sd.isWarmup
          ? ''
          : ` · target RIR ${ex.targetRir}`
      text = `${dotPrefix}${sd.reps} reps${rirTxt}`
    } else if (type === 'time') {
      const dur = fmtDur(sd.durSec ?? null)
      text = sd.logged ? `${dotPrefix}${dur}` : `${dotPrefix}${dur} target`
    } else if (sd.logged) {
      text = `${prefix}${fmtW(sd.weight)} kg × ${sd.reps}${sd.rir !== null ? `   RIR ${sd.rir}` : ''}`
    } else {
      text = `${prefix}${fmtW(sd.weight)} kg × ${sd.reps}${sd.isWarmup ? '' : `   target RIR ${ex.targetRir}`}`
    }

    return (
      <button
        key={s}
        onClick={() => dispatch({ type: 'activate', e, s })}
        className="flex min-h-[26px] cursor-pointer items-center gap-3 border p-[11px_14px] text-left font-mono"
        style={{
          background: sd.isWarmup ? 'var(--wubg)' : 'var(--rowbg)',
          borderColor: sd.isWarmup ? 'var(--wubd)' : 'var(--rowbd)',
          borderRadius: 'var(--rs)',
        }}
      >
        <div
          className="w-[14px] text-[13px] font-extrabold"
          style={{ color: sd.logged ? 'var(--acc)' : 'var(--dim)' }}
        >
          {sd.logged ? '✓' : '·'}
        </div>
        <div
          className="tracking-[0.03em] whitespace-pre tabular-nums"
          style={{
            fontSize: sd.isWarmup ? 11 : 13,
            color: sd.logged ? 'var(--mut)' : 'var(--dim)',
          }}
        >
          {text}
        </div>
      </button>
    )
  }

  // ---- pinned log bar ----
  const barVisible =
    !state.finished &&
    !state.resting &&
    !picker &&
    !numEditing &&
    !reorderOpen &&
    !finishConfirmOpen &&
    !addSetConfirm &&
    !restSheetOpen &&
    !!cur &&
    !cur.logged
  let barLabel = ''
  if (barVisible && cur && curEx) {
    const curType = typeOf(curEx)
    if (curEx.kind === 'cardio') barLabel = 'Log cardio'
    else if (curType === 'time' && hold) barLabel = `Stop · log ${fmtDur(timerElapsed)}`
    else if (cur.isWarmup) barLabel = 'Log warm-up'
    else {
      const arr = state.sets[ptr.e]
      const bIdx = arr.slice(0, ptr.s + 1).filter((x) => !x.isWarmup).length
      const bTot = arr.filter((x) => !x.isWarmup).length
      barLabel = `Log set ${bIdx}/${bTot} · start rest`
    }
  }

  const workingLogged = loggedWorkingSets(state).length
  const elapsed = fmtClock((state.finishedAt ?? now) - state.startedAt)
  const sessionRestValue = state.sessionRest ?? settings.defaultRestSec
  const targetMuscle =
    picker?.mode === 'swap' && picker.exIdx != null ? state.exercises[picker.exIdx].muscle : ''
  const pickerDb = db.exercises.map(toPickerItem)
  const pickerItems = picker
    ? filterDb(
        pickerDb,
        picker,
        state.exercises.map((m) => m.name),
        targetMuscle,
      )
    : []

  return (
    <div className="flex min-h-screen justify-center bg-bg font-mono">
      <div className="box-border flex w-full max-w-[430px] flex-col pt-[calc(var(--safe-top)+12px)] pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+120px)] pl-[max(18px,var(--safe-left))]">
        {/* header: name | rest pill · elapsed · order (Finish lives at the bottom) */}
        <div className="flex items-baseline justify-between gap-3 pt-[14px] pb-[6px]">
          <div className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[0.05em] text-tx tt-label">
            {session.routineName}
          </div>
          <div className="flex shrink-0 items-baseline gap-3">
            <button
              onClick={() => setRestSheetOpen(true)}
              className="cursor-pointer rounded-full border border-bds bg-transparent px-2.5 py-1 font-mono text-[11px] text-mut"
            >
              Rest {sessionRestValue}s
            </button>
            <div className="text-[13px] text-mut tabular-nums">{elapsed}</div>
            <QuietLink
              label="Order"
              onClick={() => setReorderOpen(true)}
              className="text-[12px] text-mut"
            />
          </div>
        </div>

        {/* exercise list */}
        {sections.map((sec, i) => (
          <div key={`${sec.title}-${i}`} className="mt-4 flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-[10px]">
                <div className="text-[14px] font-bold tracking-[0.04em] text-tx tt-label">
                  {sec.title}
                </div>
                {sec.scheme && <div className="text-[11px] text-dim">{sec.scheme}</div>}
              </div>
              {sec.exIdx !== null && (
                <div className="flex items-center gap-2">
                  {state.exercises[sec.exIdx].kind !== 'cardio' && (
                    <TypeBadge type={typeOf(state.exercises[sec.exIdx])} />
                  )}
                  <QuietLink
                    label="Swap"
                    onClick={() => {
                      const ex = state.exercises[sec.exIdx!]
                      setPicker({
                        mode: 'swap',
                        exIdx: sec.exIdx,
                        query: '',
                        group: ex.group || 'all',
                        equip: 'all',
                      })
                    }}
                    className="text-[11px] text-dim"
                  />
                </div>
              )}
            </div>
            {sec.rows.map((row, ri) =>
              'divider' in row ? (
                <div key={`d-${ri}`} className="flex items-center gap-[10px] pt-1 pb-[2px]">
                  <div className="text-[9px] tracking-[0.2em] whitespace-nowrap text-dim uppercase">
                    {row.divider}
                  </div>
                  <div className="h-px flex-1 bg-rowbd" />
                </div>
              ) : (
                renderSetRow(row.e, row.s)
              ),
            )}
            {sec.exIdx !== null &&
              state.exercises[sec.exIdx].kind !== 'cardio' &&
              !state.finished && (
                <button
                  onClick={() => setAddSetConfirm(state.exercises[sec.exIdx!])}
                  className="cursor-pointer self-start border-0 bg-transparent p-[4px_2px] font-mono text-[11px] tracking-[0.08em] text-dim uppercase underline underline-offset-[3px]"
                >
                  +1 set
                </button>
              )}
          </div>
        ))}

        <button
          onClick={() => {
            setPicker({ mode: 'add', exIdx: null, query: '', group: 'all', equip: 'all' })
          }}
          className="cursor-pointer border-0 bg-transparent p-[20px_0_14px] text-center font-mono text-[12px] tracking-[0.08em] text-mut uppercase underline underline-offset-[3px]"
        >
          + Add exercise
        </button>

        {!state.finished && (
          <OutlineButton
            label="Finish workout"
            onClick={() => setFinishConfirmOpen(true)}
            className="mt-1"
          />
        )}
      </div>

      {/* pinned log bar */}
      {barVisible && (
        <div className="fixed right-0 bottom-0 left-0 z-30 flex justify-center">
          <div className="box-border w-full max-w-[430px] border-t border-bd bg-bg pt-[10px] pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+16px)] pl-[max(18px,var(--safe-left))]">
            <button
              onClick={logActive}
              className="tt-label flex h-[58px] w-full cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[15px] font-extrabold tracking-[0.06em] text-onacc"
            >
              {barLabel}
            </button>
          </div>
        </div>
      )}

      {addSetConfirm && (
        <ConfirmSheet
          title="Feeling stronger?"
          body={`One more set of ${addSetConfirm.name}?`}
          confirmLabel="+1 set"
          cancelLabel="Not today"
          onConfirm={() => {
            const exIdx = state.exercises.indexOf(addSetConfirm)
            if (exIdx !== -1) dispatch({ type: 'addSet', exIdx })
            setAddSetConfirm(null)
          }}
          onCancel={() => setAddSetConfirm(null)}
        />
      )}

      {finishConfirmOpen && (
        <FinishConfirmSheet
          workingSets={workingLogged}
          onFinish={finishNow}
          onKeepGoing={() => setFinishConfirmOpen(false)}
        />
      )}

      {state.resting && !state.finished && (
        <RestOverlay
          state={state}
          rest={state.resting}
          now={now}
          onAdjust={(deltaMs) => dispatch({ type: 'restAdjust', deltaMs })}
          onSkip={() => {
            lastClickSecond.current = null
            dispatch({ type: 'restEnd' })
          }}
        />
      )}

      {picker && (
        <ExercisePicker
          filter={picker}
          title={
            picker.mode === 'swap' && picker.exIdx != null
              ? `Swap ${state.exercises[picker.exIdx].name}`
              : 'Add exercise'
          }
          items={pickerItems}
          onChange={setPicker}
          onPick={(item) => {
            if (picker.mode === 'swap') setSwapConfirm(item)
            else {
              dispatch({ type: 'add', item })
              setPicker(null)
            }
          }}
          onCancel={() => {
            setPicker(null)
            setSwapConfirm(null)
          }}
        />
      )}

      {reorderOpen && (
        <ReorderSheet
          state={state}
          onMove={(index, dir) => dispatch({ type: 'move', index, dir })}
          onClose={() => setReorderOpen(false)}
        />
      )}

      {swapConfirm && (
        <SwapConfirmSheet
          name={swapConfirm.name}
          onSession={() => applySwapPick(swapConfirm, false)}
          onRoutine={() => applySwapPick(swapConfirm, true)}
          onCancel={() => setSwapConfirm(null)}
        />
      )}

      {stepChooserOpen && (
        <StepChooserSheet
          current={step}
          onPick={(v) => {
            setStepOverride(v)
            setStepChooserOpen(false)
          }}
          onClose={() => setStepChooserOpen(false)}
        />
      )}

      {restSheetOpen && (
        <RestSessionSheet
          current={sessionRestValue}
          onPick={(sec) => dispatch({ type: 'setSessionRest', sec })}
          onClose={() => setRestSheetOpen(false)}
        />
      )}

      {state.finished && (
        <SummaryScreen state={state} routineName={session.routineName} onDone={onDone} />
      )}
    </div>
  )
}

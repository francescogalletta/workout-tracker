import { useEffect, useReducer, useRef, useState } from 'react'
import { addSetLog, finishSession, updateRoutineItemExercise } from '../data/mutations'
import { getDb, useDb } from '../data/store'
import type { Session } from '../data/types'
import { newId } from '../data/types'
import { ensureAudio, restClick, restDone } from '../lib/audio'
import { fmtClock, fmtMetricLine, fmtW } from '../lib/format'
import { useWakeLock } from '../lib/useWakeLock'
import { ActiveSetCard } from './components/ActiveSetCard'
import { ExercisePicker, filterDb, type PickerFilter } from './components/ExercisePicker'
import { RestOverlay } from './components/RestOverlay'
import {
  FinishConfirmSheet,
  KeypadSheet,
  ReorderSheet,
  StepChooserSheet,
  SwapConfirmSheet,
} from './components/sheets'
import { SummaryScreen } from './components/SummaryScreen'
import { QuietLink } from './components/ui'
import { restoreState, syncLoggedEdits, toPickerItem } from './fromStore'
import { loggedWorkingSets, reduce } from './session'
import type { DbExercise, SessionExercise, SetEntry } from './types'

interface KeypadState {
  field: 'weight' | 'reps'
  value: string
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

  const [keypad, setKeypad] = useState<KeypadState | null>(null)
  const [picker, setPicker] = useState<PickerFilter | null>(null)
  const [swapConfirm, setSwapConfirm] = useState<DbExercise | null>(null)
  const [reorderOpen, setReorderOpen] = useState(false)
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false)
  const [stepOverride, setStepOverride] = useState<number | null>(null)
  const [stepChooserOpen, setStepChooserOpen] = useState(false)

  const holdFired = useRef(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastClickSecond = useRef<number | null>(null)
  const activeCardEl = useRef<HTMLDivElement | null>(null)

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
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 130), behavior: 'smooth' })
    }
  }, [ptr.e, ptr.s])

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

  const openKeypad = (field: 'weight' | 'reps') => {
    ensureAudio()
    setKeypad({ field, value: '' })
  }

  const logActive = () => {
    ensureAudio()
    if (!cur || !curEx) return
    if (curEx.kind === 'strength' && cur.weight === null) {
      openKeypad('weight')
      return
    }
    lastClickSecond.current = null
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
        weightKg: cur.weight ?? 0,
        reps: cur.reps,
        rir: cur.rir,
        values: cur.values ? { ...cur.values } : null,
        completedAt: Date.now(),
      })
    }
    dispatch({ type: 'log', now: Date.now(), settings, logId })
  }

  const keypadCurrent = !keypad || !cur
    ? ''
    : keypad.field === 'weight'
      ? cur.weight === null
        ? ''
        : String(cur.weight)
      : String(cur.reps)

  const onKeypadKey = (k: string) => {
    setKeypad((kp) => {
      if (!kp) return kp
      let v = kp.value
      if (k === '⌫') v = v.slice(0, -1)
      else if (k === '.') {
        if (!v.includes('.')) v = (v || '0') + '.'
      } else if (v.length < 6) v = v + k
      return { ...kp, value: v }
    })
  }

  const onKeypadDone = () => {
    if (keypad) {
      const num = parseFloat(keypad.value)
      if (!Number.isNaN(num)) {
        dispatch(keypad.field === 'weight' ? { type: 'typeWeight', value: num } : { type: 'typeReps', value: num })
      }
    }
    setKeypad(null)
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

    if (isActive) {
      const setLabel =
        ex.kind === 'cardio'
          ? 'Cardio'
          : sd.isWarmup
            ? e === 0
              ? ex.name
              : 'Warm-up'
            : `Set ${workIdx} of ${workTot}`
      return (
        <ActiveSetCard
          key={s}
          exercise={ex}
          exIdx={e}
          entry={sd}
          setLabel={setLabel}
          step={step}
          cardRef={(el) => {
            if (el) activeCardEl.current = el
          }}
          onStepWeight={stepWeight}
          onHoldStart={holdStart}
          onHoldEnd={holdEnd}
          onWeightTap={() => openKeypad('weight')}
          onStepReps={(dir) => dispatch({ type: 'stepReps', dir })}
          onRepsTap={() => openKeypad('reps')}
          onSelectRir={(value) => dispatch({ type: 'selectRir', value })}
          onStepMetric={(key, dir) => dispatch({ type: 'stepMetric', key, dir })}
          onDismissPlateau={() => dispatch({ type: 'dismissPlateau', exIdx: e })}
        />
      )
    }

    const prefix = sd.isWarmup ? (e === 0 ? `${ex.name} · ` : '') : `Set ${workIdx}   `
    let text: string
    if (ex.kind === 'cardio') {
      text = fmtMetricLine(ex.metrics ?? [], sd.values ?? {})
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
    !keypad &&
    !reorderOpen &&
    !finishConfirmOpen &&
    !!cur &&
    !cur.logged
  let barLabel = ''
  if (barVisible && cur && curEx) {
    if (curEx.kind === 'cardio') barLabel = 'Log cardio'
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
      <div className="box-border flex w-full max-w-[430px] flex-col p-[12px_18px_120px]">
        {/* header */}
        <div className="flex items-baseline justify-between pt-[14px] pb-[6px]">
          <div className="text-[17px] font-bold tracking-[0.05em] text-tx tt-label">
            {session.routineName}
          </div>
          <div className="flex items-baseline gap-4">
            <div className="text-[13px] text-mut tabular-nums">{elapsed}</div>
            <QuietLink
              label="Order"
              onClick={() => setReorderOpen(true)}
              className="text-[12px] text-mut"
            />
            <QuietLink
              label="Finish"
              onClick={() => setFinishConfirmOpen(true)}
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
      </div>

      {/* pinned log bar */}
      {barVisible && (
        <div className="fixed right-0 bottom-0 left-0 z-30 flex justify-center">
          <div className="box-border w-full max-w-[430px] border-t border-bd bg-bg p-[10px_18px_16px]">
            <button
              onClick={logActive}
              className="tt-label flex h-[58px] w-full cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[15px] font-extrabold tracking-[0.06em] text-onacc"
            >
              {barLabel}
            </button>
          </div>
        </div>
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

      {keypad && (
        <KeypadSheet
          title={keypad.field === 'weight' ? 'Weight · kg' : 'Reps'}
          display={keypad.value || keypadCurrent || '0'}
          dimmed={!keypad.value}
          onKey={onKeypadKey}
          onDone={onKeypadDone}
          onCancel={() => setKeypad(null)}
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

      {state.finished && (
        <SummaryScreen state={state} routineName={session.routineName} onDone={onDone} />
      )}
    </div>
  )
}

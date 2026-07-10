# Post-ship fixes from the ui-fixes-batch review (2026-07-10)

Findings from the high-effort review of the `ui-fixes-batch` branch (8 finder
angles + adversarial verification). Shipped as-is by owner decision; pick these
up in follow-up work. Ranked most severe first. Verdicts: CONFIRMED = verified
against the code; PLAUSIBLE = realistic but device-dependent.

## Gesture commit semantics (highest priority — silent data loss)

1. **[CONFIRMED] `src/components/RestSlider.tsx:91` — no value-changed guard on commit.**
   `endDrag` fires `onCommit` on ANY pointerup, and `setDefaultRest`/`setDefaultTargetRIR`
   unconditionally reset every per-exercise override. An idle tap on the default-rest
   track at the current value silently wipes all hand-tuned rests (no confirm, no undo,
   no visible change). The track's `touch-action: none` also turns a scroll that starts
   on it into a drag. Fix: skip commit when unchanged; consider making the override
   reset conditional on an actual value change.
   **FIXED** — `endDrag` skips `onCommit` when the released value equals `clampRest(sec)`.
   `setDefaultRest`/`setDefaultTargetRIR` now early-return when the value is unchanged
   (so overrides survive an idle re-commit). Track `touch-action` → `pan-y`. Tests
   updated + a no-change (keeps-overrides) test added for both defaults.

2. **[CONFIRMED] `src/components/RestSlider.tsx:90` — pointercancel commits.**
   `onPointerCancel={endDrag}` persists the interrupted drag's value (system gesture,
   incoming call) instead of reverting — and via setDefaultRest also wipes overrides.
   Fix: cancel path that discards (`setDragSec(null)`, no commit).
   **FIXED** — separate `cancelDrag` clears `drag.current` + `setDragSec(null)` with no
   commit; wired to `onPointerCancel`.

3. **[CONFIRMED] `src/lib/useDragReorder.ts:69` — pointercancel commits the reorder.**
   An OS-cancelled gesture (notification shade, app switch, palm rejection) commits
   the in-flight reorder from `lastDy`. Fix: separate `cancel()` that clears state
   without committing.
   **FIXED** — `finish(commit: boolean)`; `onPointerUp` → `finish(true)`,
   `onPointerCancel` → `finish(false)` (discards).

4. **[CONFIRMED] `src/components/RestSlider.tsx:109` — keyboard commits per keypress.**
   Arrow keys call `onCommit` per press (autorepeat = commit storm): each is a full-Db
   localStorage serialize + Instant transact, and on the default slider each re-runs
   the override wipe. Fix: accumulate steps locally, commit on keyup/blur or debounce.
   **FIXED** — arrow/PageUp/PageDown/Home/End accumulate into `dragSec`; a single
   commit fires on keyup of the stepping key or on thumb blur (`commitKeyboard`), with
   the unchanged-value guard from item 1. `aria-valuenow`/`aria-valuetext` track the
   live local value.

5. **[PLAUSIBLE] `src/components/RestSlider.tsx:78` — 30s detents rarely apply at release.**
   Fine mode re-arms on natural end-of-drag deceleration (velocity ≤ 0.25 px/ms), so
   ordinary coarse sweeps release in 5s-fine mode. Fix: require sustained slow movement
   or press-hold; decay fine mode over distance.
   **FIXED** — fine mode now arms only from press-hold (`FINE_HOLD_MS`) or *sustained*
   slow movement: `slowStreak()` accumulates slow-sample time and any fast sample resets
   it, so a lone end-of-sweep deceleration sample no longer arms fine mode (needs
   `FINE_SLOW_SUSTAIN_MS = 150ms`). A clear fast flick still disarms. Unit tests added
   for `slowStreak`. NOTE: device-feel; wants a real-device sanity check.

## NumberField / native keyboard (runner)

6. **[CONFIRMED] `src/runner/components/ActiveSetCard.tsx:307` — unmount loses value + strands the Log bar.**
   Commit + `onEditingChange(false)` only fire on blur; unmounting while focused
   (tap another set row → keyed remount; React fires no blur) discards the typed
   weight AND leaves `numEditing` stuck true → pinned Log bar hidden until another
   field is opened and committed. Fix: commit/reset in an unmount effect cleanup.
   **FIXED** — `NumberField` holds latest `text`/`onCommit`/`onEditingChange` in refs
   and an unmount-cleanup effect commits the in-flight value (`Number.isFinite` guard)
   and calls `onEditingChange(false)`. `commit()` nulls `textRef` so a normal blur can't
   double-commit with the cleanup.

7. **[CONFIRMED] `src/runner/Runner.tsx:76` — shared editing boolean vs focus ordering.**
   Switching weight → reps: begin() sets true, then the old input's late blur writes
   false while the reps input is focused → Log bar floats over the open keyboard.
   Fix: editing counter or focus-within check instead of last-writer-wins boolean.
   **FIXED** — Runner replaces the boolean with a begin/end counter (`editCount` ref,
   `numEditing = count > 0`). Weight→reps: reps `begin` increments before weight's late
   blur decrements, so net stays >0. Item-6 unmount cleanup decrements exactly once
   (null-guarded).

8. **[CONFIRMED] `src/runner/components/ActiveSetCard.tsx:269` — `Infinity`/`1e30` pass validation.**
   commit() only checks NaN; reducer clamps low end only. `weightKg: Infinity` reaches
   SetLogs and JSON persistence (Infinity → null, corrupting the row) and insights math.
   Fix: `Number.isFinite` + sane upper bound.
   **FIXED** — `NumberField.commit`/unmount use `Number.isFinite`; reducer `typeWeight`/
   `typeReps` route through `clampNum` (non-finite → low bound), clamping weight to
   0..999 kg and reps to 1..999.

## Sync / rollout

9. **[CONFIRMED] `instant.schema.ts:53` — nullable targetRIR rollout hazards.**
   (a) Schema push MUST precede deploy: the app writes `targetRIR: null` verbatim;
   until the schema makes it optional, transacts are rejected (data stays local,
   sync shows error). (b) Stale installed-PWA bundles run the old mapper where
   null coerces to 0 → "@ RIR 0" prescriptions on un-updated devices until their
   cache refreshes. Consider resolving effectiveRIR at write time for sync, or
   accept the transition window.
   **DOCUMENTED** (no code change — deployment sequencing, and the write-time
   mitigation does not fit cleanly). Evaluated resolving `effectiveRIR` at write time:
   it would break the override model. `targetRIR: null` is the "follow the routine
   default" sentinel; writing a resolved concrete number to the synced row means that
   on reload the item reads back as a fixed number and would NOT track a later change to
   the routine's default RIR. It would also have to be special-cased in the generic
   `diff.ts` write path (which copies fields verbatim). So we keep null local + synced.
   Required rollout order (must be done by hand, NOT via this agent):
     1. Push the schema (`instant.schema.ts` — `targetRIR`/`defaultTargetRIR` optional)
        BEFORE shipping any app bundle that writes `targetRIR: null`. If the deploy
        lands first, background transacts are rejected and sync surfaces an error while
        data stays local.
     2. Stale-PWA window caveat: already-installed PWA bundles run the OLD mapper, where
        a null/absent `targetRIR` coerces to 0 → "@ RIR 0" prescriptions until each
        device's service-worker cache refreshes to the new bundle. This is unavoidable
        with the current single-field approach; accept the transition window (it clears
        on next app update per device). No mitigation shipped.

## Performance

10. **[CONFIRMED] `src/lib/useDragReorder.ts:66` — per-pointermove re-render storm.**
    `setDrag` fires a fresh object at 60–120Hz, re-rendering all of RoutineEditor per
    event; each render calls `itemsForRoutine` twice (itemIds + items). Fix: imperative
    translateY for the dragged row, setState only on row-boundary crossings, compute
    `items` once and derive `itemIds`.
    **FIXED** — `useDragReorder` writes the dragged row's `translateY(...)+scale` to the
    stored row element imperatively on pointermove and only calls `setDrag` when the
    target index crosses a row boundary; the dragged row's `rowStyle` carries only
    stacking (no React-managed transform to clobber the imperative writes), cleared on
    end/cancel. RoutineEditor computes `items` once and derives `itemIds` from it.

## Below the cut (not formally reported, worth a pass)

- Accessibility regressions: delete (Exercises) and reorder (routine editor) are now
  pointer-gesture-only — no keyboard/VoiceOver activation path (old buttons had one).
- `weightFocusNonce` focuses via passive effect (outside the tap's gesture stack);
  iOS may focus without raising the keyboard. An imperative focus handle called from
  `logActive` is the deeper fix.
- Duplication introduced by the split: `insights/bits.tsx` SheetRule duplicates
  `runner/components/ui.tsx` HairlineLabel; `GROUP_ORDER` and `WEEK_MS` now have
  multiple private copies (engine/insights.ts vs insights/helpers.ts vs queries.ts vs
  fromStore.ts, which also inlines targetWeeksLeft); inline pluralization ternaries in
  Exercises.tsx vs `exerciseCountLabel`/`plural()` helpers; `reorderItem` inlines a
  clamp beside the file's own `clamp()`.
- Minor: RestSlider measures getBoundingClientRect per pointermove (measure once on
  pointerdown); Runner's inline `cardRef` closure re-runs ref cleanup/attach every
  250ms tick (hoist to useCallback); `usedEntries` in Exercises.tsx computed every
  render but only read inside the confirm sheet; `addSetConfirm` stores an array index
  rather than exercise identity.

### Below-the-cut status

- Minor perf batch — **FIXED**: RestSlider measures the track rect once on pointerdown
  (stored in `drag.current.rect`); Runner's `cardRef` hoisted to a `useCallback`;
  `usedEntries` moved into a `DeleteConfirm` sub-component so it computes only while the
  sheet is open; `addSetConfirm` stores the `SessionExercise` object (reorder keeps the
  reference so `indexOf` re-finds it; a swap replaces it so the stale +1 is dropped).
- `reorderItem` inline clamp — **FIXED**: uses the file's own `clamp()`.
- Accessibility — **FIXED**: routine-editor reorder already had a keyboard path
  (ArrowUp/Down `onKeyDown` + `aria-label` on the ≡ handle), left as-is. Exercises
  multi-select delete now has a non-pointer path: a header **Select** button (shown when
  the list is non-empty) enters select mode from the keyboard/VoiceOver — long-press
  stays as the pointer path. In select mode each row is a real `role="checkbox"` with
  `aria-checked` + `aria-label={exercise name}`, so Enter/Space toggle it and VoiceOver
  reads the state; the header Delete is already a plain focusable button. Idle rows carry
  `aria-label="Rename <name>"`. Minimal visuals unchanged (the ✓ box stays `aria-hidden`,
  state conveyed by `aria-checked`).
- `weightFocusNonce` passive-effect focus / iOS keyboard-raise — **FIXED**: replaced the
  nonce+passive-effect with an imperative handle. `ActiveSetCard` is now `forwardRef`
  exposing `ActiveSetCardHandle.focusWeight()`, which calls the weight `NumberField`'s
  `useImperativeHandle` `focus()`; `logActive` invokes it synchronously inside its own tap
  gesture so the input mounts (autoFocus) within the gesture stack and iOS raises the
  keyboard. `focus()` is idle-guarded (`textRef.current === null`) so it can't double-fire
  the begin/end editing counter (fix 7); the unmount-commit cleanup (fix 6) is untouched.
- Remaining duplication — **FIXED**: new `src/lib/constants.ts` is the single source for
  `WEEK_MS`, `GROUP_ORDER`, and `targetWeeksLeft()`; engine/insights, data/queries,
  insights/helpers, and runner/fromStore now import from it (fromStore's inlined
  weeks-left math uses `targetWeeksLeft`; helpers re-exports it so PlanTab/tests keep
  their import path). `SheetRule` and `HairlineLabel` were byte-identical — merged onto
  `HairlineLabel` (in runner/components/ui, already shared by Exercises); `SheetRule`
  deleted and its 5 Insights call sites switched. `plural()` moved from Settings into
  screens/routineOps beside `exerciseCountLabel` and gained an optional irregular-plural
  arg; Exercises' two inline pluralization ternaries now use `exerciseCountLabel(size)`
  and `plural(n, 'routine entry', 'routine entries')`.

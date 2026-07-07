# Lift — Build Plan & Architecture Contract

This file is the contract between parallel build agents. Read it fully before
writing code. The design sources of truth are:

- `design/SPEC.md` — authoritative build spec (data model §3, runner §5,
  engine §5.5, warm-ups §5.3, PWA constraints §7)
- `design/HANDOFF.md` — owner-approved design decisions that extend/supersede
  the spec (History tabs, insight rules, cardio items, steppers, empty states)
- `design/theme-tokens.md` — frozen Volt/Ember tokens
- `design/prototypes/*.dc.html` — pixel-authoritative screen references.
  These are design references, NOT production code: recreate, never copy.
  Ignore the "Prototype chrome" controls at the top of each (theme toggle,
  First run, Resume demo) — demo affordances only.

Existing, working code to follow as the style/convention baseline:
`src/runner/` (Workout Runner, done), `src/runner/components/ui.tsx` (shared
primitives), `src/index.css` (Volt tokens as CSS vars + Tailwind `@theme`).

## Constraints (non-negotiable)

- Stack fixed: Vite + React + TS + Tailwind v4. No new runtime dependencies
  without a written reason in your report.
- InstantDB is NOT wired yet (no app ID). All data goes through the store in
  `src/data/` (localStorage-backed, InstantDB-shaped schema) so the swap is
  mechanical later. Do not build any other persistence or network layer.
- Zero loading states. No spinners, no skeletons. Optimistic updates only.
- Touch targets ≥ 44 px; tabular numerals everywhere; one accent color;
  motion 150–250 ms ease-out, transform/opacity only.
- Everything runs in Docker. Never run npm/node on the host. Never run
  `docker compose up` (the main session owns port 5173). Test with:
  `docker compose run --rm --build app sh -c "npm install --no-audit --no-fund && npm test && npm run build"`
- Tests colocated (`*.test.ts` / `*.test.tsx`, vitest, node env,
  renderToString for render smoke tests). Logic lives in pure functions so it
  is testable without a DOM. Run the suite yourself; hand back green only.
- Commit your work to your worktree branch when done (small, clear message).
  Do not push, do not touch other branches, no --no-verify.

## Architecture

### `src/data/` — store (foundation builds this; everyone consumes it)

- `types.ts` — entities per SPEC §3, InstantDB-shaped:
  `Exercise { id, name, muscleGroup, primaryMuscle, equipment, loadType,
  kind: 'strength'|'cardio', metrics?: Metric[], isCustom, notes }`,
  `Routine { id, name, defaultRestSec, cycleOrder: number|null, warmup:
  boolean, archived }`,
  `RoutineItem { id, routineId, exerciseId, order, sets, repsPerSet,
  targetRIR, restSec: number|null }`,
  `Session { id, routineId: string|null, routineName, status:
  'active'|'completed'|'discarded', startedAt, finishedAt: number|null }`,
  `SetLog { id, sessionId, exerciseId, exerciseName, setNumber, isWarmup,
  weightKg, reps, rir: number|null, values: Record<string,number>|null,
  completedAt }` (values = cardio metrics; weightKg 0 for cardio),
  `InsightTarget { id, exerciseId, weightKg, note, createdAt, expiresAt }`,
  `AppSettings { defaultRestSec, soundEnabled, weightIncrementKg, unit:
  'kg'|'lb', theme: 'volt'|'ember', email: string|null }`.
- `store.ts` — single store: `getDb(): Db` (snapshot object with all entity
  arrays + settings), `update(fn: (db: Db) => Db)` (persist to localStorage
  key `lift.db.v1`, notify), `subscribe(cb)`, React hook `useDb()` via
  `useSyncExternalStore`. Plus `resetDb()` for tests.
- `seed.ts` — starter exercise catalog (superset of the current
  `src/runner/demo.ts` DB, ~40 strength + 4 cardio entries with muscleGroup/
  primaryMuscle/equipment/loadType; full free-exercise-db import comes later)
  and a `seedDemoData()` used in dev/tests: routines Push A / Pull A / Legs /
  Push B (rotation) + 2 non-rotation, and 2–3 weeks of plausible setLogs so
  History/Insights/engine have data to show.
- `queries.ts` — pure helpers over `Db`: `nextInRotation(db)`,
  `lastCompletedSession(db)`, `activeSession(db)`, `historyFor(db,
  exerciseId)`, `sessionsForLog(db, filter)`, `weeklySetsPerMuscleGroup(db,
  weeks)`, `activeTargetFor(db, exerciseId, now)`.

### `src/engine/` — recommendation engine (foundation)

- `reco.ts` — SPEC §5.5 exactly: prescription from last session's working
  sets (surplus rule: ≥3 → +2 increments, ≥1 → +1, > −1 → repeat, else
  repeat/decrease), reason line text, plateau detection (3 consecutive
  repeat-or-worse sessions at same weight → banner text with −10% rounded to
  increment). Pure, fully unit-tested.
- `warmup.ts` — SPEC §5.3: 50%×8 + 70%×5 rounded to increment, single 50%×8
  when working weight < 20 kg.
- `insights.ts` — HANDOFF §4 rules: over an averaging window, *lower weight*
  when ≥40% of sets at RIR 0 AND avg reps < target (suggest −10% rounded to
  1.25); *add weight* when avg RIR ≥ target+1 (suggest +1 increment); sort by
  severity, lower-weight first. Muscle balance: working sets/week per group
  vs 10–20 band.

### `src/router.tsx` + `src/App.tsx` (foundation)

Tiny hash router, no dependency: routes `#/` (Home), `#/signin`, `#/routines`,
`#/routines/:id` (Editor), `#/run` (Runner), `#/history`, `#/settings`.
`navigate(path)` helper. App renders the route + global resume-or-discard
prompt when `activeSession(db)` exists on open (except on `#/run`).
Foundation creates a stub component per screen (title + TODO) so screen
agents only ever edit their own screen files — no shared-file conflicts.

Owner decision (supersedes the prototypes' per-screen quiet-link nav): a
persistent sticky `TopNav` (`src/screens/TopNav.tsx`) renders in `Shell` above
every screen EXCEPT `#/run` (chrome-free per SPEC §8.1) and `#/signin` (focused
flow) — see `showTopNav`. RoutineEditor maps onto the Routines active link.

### Theming

Volt vars live on `:root` in `src/index.css`. Ember = `[data-theme='ember']`
override block setting the same var names per `design/theme-tokens.md`
(different palette AND: `--f` Archivo, `--tt` none (sentence case), radii
12–20 px). Implement Ember from the tokens file, NOT from the prototype
approximation. Font Archivo via @fontsource. Screen code references only the
existing Tailwind token classes (`text-tx`, `bg-acc`, `rounded-rl`, …) plus
`uppercase`-via-`--tt`: use the pattern `style={{ textTransform: 'var(--tt)' }}`
→ foundation adds a `tt-label` utility for this; never hardcode `uppercase`
for text that should become sentence case in Ember (micro-labels stay
uppercase in both themes — copy the prototype's `--tt` vs `uppercase` choice
per element).

### Runner integration (foundation)

`src/runner/` currently seeds from `demo.ts`. Foundation rewires:
`createSession(routine, items, exercises, db)` builds the session from
routineItems + engine output (prescriptions, reason, plateau, targets, last
lines) + warm-up generation for the routine's `warmup` flag (first exercise).
Logging a set appends a `SetLog` to the store immediately (history sees it
live); finish stamps the session; discard keeps setLogs (SPEC §3 sessions).
"Also update routine" on swap now really updates the routine item. Session
UI state (pointer, rest, sheets) stays in-memory as today. Existing runner
tests keep passing (adapt seams, keep behavior).

## Screen assignments

Each agent: recreate the prototype pixel-faithfully (Volt), wire to the
store, add unit tests for any logic + a renderToString smoke test, run the
full suite in Docker, commit. Empty states per HANDOFF §8 ("First run" chip
in the prototypes previews them).

- **A — Sign In + Settings + Ember**: `design/prototypes/Sign In.dc.html`,
  `Settings.dc.html`. **Auth is NOT a gate (owner decision, supersedes the
  handoff's sign-in-first flow).** The app always boots straight to Home on the
  local (localStorage) backend — signed out, offline, no app id needed — and
  every screen works. Signing in exists only to enable cloud sync and is opted
  into from Settings' Sync section. Boot always starts on local; if an app id is
  set AND an InstantDB session already resolves, the store switches to the
  instant backend at runtime (no gate, no blank cold-start). Sign-in reconciles
  the first remote snapshot with local via `classifySync` (pure, in
  `data/backend/sync.ts`), keyed on "meaningful data" = any routines/sessions/
  setLogs/targets (catalog + settings do NOT count): fresh remote → `mergeDb`
  uploads local (case 1); meaningful remote + fresh local → adopt remote silently
  (case 2); both meaningful → PAUSE on the local backend and show a blocking
  "Account data found" modal (`App.SyncConflictPrompt`, counts from remote, no
  tap-to-dismiss) — "Use account data" backs local up to `lift.db.backup` then
  REPLACES local with remote (no union), "Cancel" signs the session out leaving
  local exactly as it was (case 3). Sign out snapshots the current Db into
  localStorage, ends the InstantDB session, and returns to local — data stays.
  The Sign In screen (reached only from Settings; quiet Cancel back to Settings,
  Continue returns to Settings) shows the wordmark + email/code/"Ready." steps
  when a backend is configured, and a quiet "sync unavailable" note otherwise (no
  fake-auth UI). Settings' Sync section has three states: no app id → dim
  "Sync unavailable" note; configured + signed out → "Sync off" + "Sign in to
  sync"; signed in → email + "Sign out". Other Settings rows unchanged: theme
  (Volt/Ember chips — applies `data-theme`), unit (kg/lb + "stored in kg" note),
  rest sound toggle, default rest 60/90/120, weight step 0.5/1/1.25/2.5/5 +
  long-press note. Ember theme per tokens file.
- **B — Home + Routines**: `Home.dc.html`, `Routines.dc.html`. Rotation
  suggestion from `nextInRotation`, change-routine sheet (suggested
  highlighted accent), "Last · <routine> · <weekday>, <n> min", Start →
  creates active session and navigates `#/run`; resume-or-discard modal
  (foundation provides the query; B owns the UI); first-run empty state.
  Routines: rotation section (position badge, up-next accent, ↑/↓ reorder
  writing cycleOrder, in-rotation toggle 52×32), others section, Start ▸ per
  row, + New routine → creates and opens editor, empty state.
- **C — Routine Editor**: `Routine Editor.dc.html`. Name input (30 px, 800),
  default-rest chips, warm-up toggle w/ explainer, item list: collapsed rows
  (summary "4×8 @ RIR 2 · rest 90s") with ↑/↓, expanded card (accent name,
  Remove, sets/reps 44 px steppers, RIR pills, rest chip → Default/60/90/
  120/180 chips), + Add exercise picker (reuse/generalize the runner's
  picker), rotation card with cycle preview chips, ‹ Routines / Done.
- **D — History**: `History.dc.html` + HANDOFF §4 (authoritative for rules).
  Two tabs (48 px switch). Log: per-session cards, exercise set tables
  (56 px columns S1…Sn, rows kg/reps/RIR, gutter 38 px, horizontal scroll
  with ›/‹ edge fades), filter bottom sheet (muscle-group chips / single
  exercise list with session counts + summary line), footnote. Insights ·
  Plan: 2/4/6/8 wk chips, suggested adjustments from `engine/insights.ts`,
  Accept → InsightTarget (expires 4 wk, removable), muscle balance list
  (10–20 band, OK/Low). Both tabs' empty states.

## Integration checkpoints (main session does these)

1. Foundation branch merges first; suite green.
2. Screen branches merge one at a time; suite green after each.
3. Final QA agent drives cross-screen flows and files findings; fixes land
   before done: sign in → create routine → rotation order → start → log sets
   (reco + target shown) → finish → History Log shows session → Insights
   suggests → accept target → Runner shows target column → Settings changes
   (step, rest, theme) take effect → resume-or-discard after abandoning.

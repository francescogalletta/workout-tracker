# Workout Tracker PWA — Build Specification

Single-user, offline-first workout tracking Progressive Web App. Built for one person (the owner), installed via Safari "Add to Home Screen" on iPhone and used in a browser/dock app on Mac. No App Store, no Apple Developer account, no paid services.

---

## 1. Goals & Non-Goals

### Goals
- Define reusable **routines** (ordered exercises with sets, reps, target weight, rest time, warm-up scheme) so a workout is fully specified before arriving at the gym.
- **Guided workout execution**: step through a routine set by set, with prescribed weight/reps/RIR, a rest timer with sound cues, and fast logging.
- Log per set: **weight, reps, RIR (Reps In Reserve)** — this is the core dataset.
- **Weight recommendations** derived from the user's own history (rule-based autoregulation, no ML).
- **Exercise substitution**: suggest alternatives targeting the same muscle/muscle group when equipment is busy.
- Work fully **offline** in the gym; sync automatically when online.
- Cross-device: same data on iPhone and Mac.

### Non-Goals (explicitly out of scope)
- Multi-user features, social features, sharing (auth must support adding a second read-only user later, but build nothing for it now).
- Supersets or circuits — **straight sets only**.
- Cardio, running, calories, nutrition, body-weight-over-time tracking.
- Estimated-1RM charts and session-duration/frequency stats (History = per-exercise table + weekly muscle-group volume only).
- Plate calculator (owner declined — no plates-per-side breakdown for barbells).
- Importing historical data (fresh start).
- Background execution while the app is closed/locked (see §7 iOS constraints).
- Native app / Capacitor wrapper.

---

## 2. Stack (fixed — do not substitute)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite + React + TypeScript** | SPA |
| Data/sync/backend | **InstantDB** (hosted free tier, `@instantdb/react`) | Local-first: reads/writes hit the local store (IndexedDB), sync is automatic when online. Do NOT build a custom backend, REST API, or sync layer. |
| Auth | InstantDB **magic-code email auth** | Single user in practice |
| PWA | **vite-plugin-pwa** (Workbox) | Precache the app shell + seeded exercise data + audio assets. Do NOT hand-write a service worker. |
| Styling | Tailwind CSS; theme tokens decided in the design exploration phase (§8.0) | See §8 |
| Audio | **Web Audio API** | Synthesized clicks; no audio files needed if synthesis is simpler |
| Hosting | Static hosting (Cloudflare Pages or GitHub Pages) | HTTPS required for PWA install |

Permissions: lock all InstantDB entities to the authenticated owner (`auth.id` checks) so the app is private by default.

---

## 3. Data Model (InstantDB schema)

### `exercises`
Seeded from public dataset (§6) + user-creatable custom entries.
- `name: string`
- `primaryMuscles: string[]` (e.g. `["lats"]`)
- `secondaryMuscles: string[]`
- `muscleGroup: string` (e.g. `"back"` — derived via muscle-group map, used for filtering & substitution)
- `equipment: string` (e.g. `"cable"`, `"machine"`, `"barbell"`, `"dumbbell"`, `"body only"`)
- `loadType: "weighted" | "bodyweight" | "assisted"` (see §5.4)
- `unit: "kg" | "lb"` — default `"kg"`, per-exercise override
- `isCustom: boolean`
- `instructions: string[]` (from dataset; display optional)
- `notes: string` (user's own, e.g. seat position, knee/back cautions)

### `routines`
- `name: string` (e.g. "Push A")
- `defaultRestSec: number` (default 90)
- `cycleOrder: number | null` (position in the rotation; null = not in rotation)
- `notes: string`
- `archived: boolean`

**Rotation**: routines with a `cycleOrder` form a repeating cycle (Push A → Pull A → Legs → Push B → …). Home suggests the routine after the last *completed* session's routine. Always overridable with one tap — a suggestion, never a lock.

### `routineItems` (ordered exercises within a routine)
- link → `routine`, link → `exercise`
- `order: number`
- `sets: number`, `repsPerSet: number` (fixed scheme, e.g. 4×8)
- `targetRIR: number` (0–4; the prescribed strain for this exercise)
- `restSec: number | null` (overrides routine default)
- `warmup: boolean` (whether to prepend auto-suggested warm-up sets, §5.3)

### `sessions` (one performed workout)
- link → `routine` (nullable)
- `status: "active" | "completed" | "discarded"`
- `startedAt: date`, `finishedAt: date | null`
- `notes: string`

**Interrupted sessions**: if an `active` session exists on app open, prompt **"Resume or discard?"**. Resume drops the user back into the runner where they left off; discard sets `status: "discarded"` but keeps its setLogs in history (the sets were really performed). Only one active session at a time.

### `setLogs` (the atomic record — most important entity)
- link → `session`, link → `exercise`
- `setNumber: number`, `isWarmup: boolean`
- `weightKg: number` (canonical storage ALWAYS in kg; convert at display time for lb exercises. For bodyweight: added weight; for assisted: negative assistance value. See §5.4)
- `reps: number`
- `rir: number | null` (0,1,2,3,4; null allowed for warm-ups)
- `completedAt: date`
- `note: string`

### `settings` (single row)
- `defaultRestSec`, `soundEnabled`, `weightIncrementKg` (default 2.5), `email`

---

## 4. Screens

1. **Home** — big "Start workout" defaulting to the **next routine in the rotation** (change with one tap), resume-or-discard prompt if an active session exists, recent sessions, links to Routines & History.
2. **Routines list / Routine editor** — create/edit/reorder items; per-item sets, reps, target RIR, rest override, warm-up toggle. Add exercise via the Exercise Picker.
3. **Exercise Picker** — search by name; filter by **muscle group** and **muscle**; filter by equipment. Create custom exercise inline.
4. **Workout Runner** (§5) — the core screen.
5. **History** — exactly two views: (a) **per-exercise table** of weight × reps × RIR over time, most recent first (answers "what did I do on incline press the last 2 months?"); (b) **weekly volume per muscle group** (sum of working sets per primary-muscle group per week, simple bar chart). No 1RM estimates, no duration stats.
6. **Settings** — sound on/off, default rest, weight increment, sign out.

---

## 5. Workout Runner — detailed behavior

### 5.1 Flow
- Shows: current exercise, **set X of Y**, prescribed **weight** (from recommendation engine §5.5, editable), **target reps**, **target RIR**, and a peek at what's next.
- Logging a set = one screen, three inputs, prefilled: weight (recommended), reps (target), RIR (tap-selector 0/1/2/3/4+). One tap to confirm if defaults are right; steppers to adjust. Big touch targets — this is used mid-workout with tired hands.
- Confirming a set immediately starts the **rest timer**.
- Exercises are strictly sequential (straight sets) but the user can jump back/forward and edit any logged set.
- **"Add exercise"** button in the runner: opens the Exercise Picker and appends an exercise to *this session only* (default 3 sets, editable; routine template untouched). Its sets log like any other and feed history/recommendations.
- "Finish workout" stamps `finishedAt`, sets `status: "completed"`, and shows a short session summary.

### 5.2 Rest timer
- Countdown from the item's `restSec` (or routine default). Editable mid-count (+15s / −15s).
- **Sound cues via Web Audio API**: a click each second for the final 5 seconds, distinct tone at 0. Sounds play through headphones alongside other audio.
- **Audio unlock**: iOS requires a user gesture before audio can play — prime/resume the `AudioContext` on the "Start workout" tap.
- **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`) while a workout is active, so the screen never sleeps mid-timer. Re-acquire on `visibilitychange`. Feature-detect; degrade gracefully.
- **Timestamp-based timing**: store the timer's absolute end time; render remaining = `endTime - now` on every tick. If iOS suspends the tab (user switched apps), the countdown is correct on return. Accept that cues can't fire while backgrounded — this is a known, accepted iOS PWA limitation. Do not attempt Push/Background Sync hacks.

### 5.3 Warm-up sets
When a routine item has `warmup: true`, prepend auto-suggested warm-up sets computed from the working weight W:
- Default scheme: **50% × 8 reps, 70% × 5 reps** (rounded to the nearest `weightIncrementKg`; skip a step if the working weight is very light, e.g. < 20 kg → single 50% × 8).
- Warm-ups appear in the runner as distinct (visually muted) sets; logging them is optional/one-tap; `isWarmup: true`, RIR not required.
- Warm-up sets are excluded from history charts and the recommendation engine.

### 5.4 Load types
- `weighted`: weight = external load. Straightforward.
- `bodyweight`: weight field = **added** weight (0 = strict bodyweight, +10 = 10 kg on a belt).
- `assisted`: weight field = assistance, stored **negative** (assisted pull-up with 20 kg help → `-20`). UI labels it "assistance" and shows positive numbers with a badge; progression = assistance decreasing.

### 5.5 Weight recommendation (rule-based autoregulation)
For each routine item, compute the prescribed weight from the most recent non-warm-up sets of that exercise:
- **No history** → show empty weight input with placeholder "first time — enter weight". The logged value seeds the record.
- **Has history** (last session's working sets for this exercise; let `surplus` = (avg reps − target reps) + (avg RIR − target RIR)):
  - `surplus ≥ 3` → **increase by 2 increments** (beating targets accelerates progression).
  - `1 ≤ surplus < 3` → **increase by 1 increment**.
  - `−1 < surplus < 1` → **repeat** same weight.
  - `surplus ≤ −1` → **repeat**; missed target reps by ≥2 on multiple sets → **decrease** one increment.
- **Plateau flag**: if the same exercise gets "repeat or worse" for 3 consecutive sessions at the same weight, show a non-blocking banner: "Plateau on [exercise] — consider a deload (~−10% = X kg)". Never auto-apply; the user decides and edits the weight if they want it.
- Show a one-line reason under the prescription (e.g. "↑ 5 kg — last time 4×10 @ RIR 3 vs target 8 @ RIR 2").
- Always editable; the engine informs, the user decides.

### 5.6 Exercise substitution
On any exercise in the runner (and in the routine editor), a "Swap" action lists alternatives that:
1. Share the primary muscle (fallback: same `muscleGroup`),
2. Are **not** already in the current routine,
3. Sorted: same primary muscle first, then same group; secondary sort by matching `mechanic`/equipment variety.
One tap swaps it **for this session only** (routine template unchanged) with an option to "also update routine". The swapped exercise uses its own history for recommendations.

---

## 6. Exercise database seeding

- Source: **`yuhonas/free-exercise-db`** (public domain, ~870 exercises, JSON with `primaryMuscles`, `secondaryMuscles`, `equipment`, `force`, `mechanic`, `category`, images).
- Build step: a script (`scripts/seed.ts`) transforms the dataset → app schema, assigns `muscleGroup` via a muscle→group map (chest, back, shoulders, legs, arms, core...), infers `loadType` (`equipment == "body only"` → bodyweight; name contains "assisted" → assisted; else weighted), and filters to strength exercises (drop stretching/cardio categories).
- Ship the transformed JSON as a static asset precached by the service worker; import into InstantDB on first login (idempotent — check a seed marker in `settings`). Skip images in v1 to keep the precache small (keep the image URLs in the data for later).

---

## 7. PWA & iOS constraints (accepted trade-offs — do not fight these)

- Manifest: `display: standalone`, portrait, app name "Lift" (placeholder), icons and `theme_color` matching the chosen theme (§8.0).
- iOS home-screen PWAs: no reliable background JS, no scheduled notifications, no Background Sync. **All timer UX is foreground-only by design** (§5.2 mitigations: wake lock + timestamp math + audio priming).
- InstantDB handles offline persistence of *data*; vite-plugin-pwa handles offline availability of the *app shell*. Verify the full flow works in airplane mode after first load.
- iOS may evict storage of long-unused web apps; acceptable because the server copy is the source of truth and the app is used weekly.

---

## 8. Design brief

The owner's one-line brief: **"silky smooth — fit for purpose, actionable stuff on the screen, no tabs and menus."** Concretely:

### 8.0 Design exploration phase (REQUIRED before building any UI)

The visual identity is deliberately **not decided**. Before writing any application UI, the design agent must run a short exploration with the owner:

1. **Propose 3–4 distinct visual routes.** Each route = a name, a one-paragraph rationale, a palette (dark themes preferred but not mandatory), a typography choice for the big numerals, and — most importantly — **the same sample screen rendered in each route**: the runner's set-logging card with realistic data. Same content, different skins, so the comparison is fair. Routes should be genuinely different in mood (e.g. near-monochrome utilitarian; warm dark with a single vivid accent; high-contrast "OLED black" with neon numerals; soft muted editorial), not four shades of the same idea.
2. **Cite references** where useful (existing apps, design systems, screenshots described in words) so the owner can react to something concrete.
3. **Ask the owner preference questions** where routes genuinely diverge (dark vs. true-black, colorful vs. monochrome accent, rounded vs. sharp, playful vs. clinical) — but only questions the samples can't answer by themselves.
4. **Decide together, then freeze**: the chosen route becomes a small token file (colors, radii, type scale, spacing) that every subsequent screen must use. No per-screen improvisation after the freeze.

Constraints on all routes: dark-leaning (gym environments, OLED battery), must satisfy §8.1 feel principles and §8.2 ergonomics, and legible at arm's length with sweat in your eyes.

### 8.1 Feel principles (non-negotiable)
- **Zero loading states.** InstantDB reads/writes are local-first, so nothing ever "loads". No spinners, no skeletons, anywhere. If a design includes one, it misunderstands the architecture.
- **Every tap responds < 100 ms** with a visible state change. Optimistic UI throughout; sync is invisible.
- **The default path is tap-tap-tap.** Everything prefilled (recommended weight, target reps, RIR preselected to target). Logging a normal set = confirm defaults in ≤ 2 taps. Typing is the exception (first time on a machine).
- **One decision per screen.** During a workout the runner owns the full screen: no tab bar, no hamburger, no menus. Secondary actions (swap, add exercise) are visually quiet text actions, not chrome.
- **Thumb zone.** One-handed use, standing, fatigued. Primary actions in the bottom third; top of screen is read-only context (exercise, set X of Y, up next).
- **Gestures are accelerators, never the only path.** Disable pinch-zoom (`viewport` + `touch-action`). Avoid edge gestures (conflict with Safari back-swipe). Mid-screen swipes allowed as shortcuts with a visible tap alternative.
- **Motion with restraint:** 150–250 ms ease-out, animate only `transform`/`opacity` (60 fps on iPhone Safari), one satisfying spring on set-confirm. No haptics (iOS Safari doesn't expose vibration to web apps) — audio cues are the tactile channel.

### 8.2 Visual language (route-independent rules)
- Palette and exact typography come from the chosen route (§8.0). The rules below hold for **every** route:
- **One accent color maximum.** The accent marks the primary action / current selection; everything else is neutral. No muscle-group color coding, no rainbow.
- Extreme minimalism: no decorative chrome, generous whitespace; **large numerals** for weight/reps/timer (the numbers are the interface) — tabular/monospaced digits so values don't jiggle as they change.
- Minimum 48 px touch targets; high contrast; mobile-first (~390 px). History may use wider layouts on desktop.
- Gym-first ergonomics override aesthetics wherever they conflict.

### 8.3 Screen-level decisions (owner-confirmed)
- **Home = ultra-minimal:** suggested next routine (rotation) + one big Start button; resume-or-discard prompt when an active session exists; quiet links to Routines / History / Settings. No stats, no charts on Home.
- **Runner = hybrid list:** a scrollable list of today's exercises and their sets (whole workout scannable, completed sets ticked with their logged numbers); the **active set expands inline** into the logging card — big weight numeral with recommendation reason line beneath, big reps numeral, RIR row 0/1/2/3/4+ preselected to target, one full-width "Log set · start rest" button.
- **Number input = steppers + tap-to-type:** −/+ steppers (weight steps by `weightIncrementKg`, reps by 1); tapping the numeral opens a numeric keypad for direct entry.
- **Rest = full-screen takeover showing the next set's prescription:** giant countdown, next set's exercise/weight/reps/RIR beneath it, +15 s / −15 s / skip controls. Final-5-second audio clicks.


## 8b. User stories (confirmed with the owner — the app fails if any of these fail)

1. Sunday night I create "Push A": bench 4×8 @ RIR 2, incline DB press 3×10 @ RIR 2, cable fly 3×12 @ RIR 1, per-exercise rest, bench flagged for warm-ups. I add it to my rotation after "Legs".
2. I open the app at the gym with no signal. Home suggests "Push A" (next in cycle). It prescribes warm-up 30 kg × 8 then work sets at 62.5 kg — up from 60 kg because last week I logged RIR 3 against a target of 2.
3. After a set I confirm with three taps (weight ok, reps ok, tap RIR) and the rest countdown starts, clicking through my headphones for the last 5 seconds. If I switch to Spotify and come back, the remaining time is still correct.
4. The next machine is taken; "Swap" offers same-muscle alternatives not already in today's routine. I pick one for this session only.
5. First time on a new machine there's no prescription; I type 40 kg and next session it prescribes from that.
6. Mid-workout I feel good and "Add exercise" appends lateral raises to today's session without touching the template.
7. I get interrupted and leave after 3 exercises. Next open, the app asks resume or discard; discarding still keeps the sets I did in history.
8. On my Mac I check incline press history (weight/reps/RIR table) and my weekly chest volume chart. After 3 stalled sessions on bench, a banner suggests a ~10% deload but changes nothing by itself.

## 9. Milestones (build in this order; each must run end-to-end)

0. **Design exploration (§8.0)**: 3–4 visual routes rendered on the set-logging card, preference questions, owner picks, theme tokens frozen. No app UI before this.
1. **Scaffold**: Vite + React + TS + Tailwind (chosen theme tokens) + vite-plugin-pwa + InstantDB init + magic-code auth. Installable shell on iPhone.
2. **Exercise DB**: seed script + Exercise Picker with muscle-group/muscle/equipment filters + custom exercises.
3. **Routines**: CRUD + ordered items with sets/reps/targetRIR/rest/warm-up flag + rotation (`cycleOrder`, home suggestion).
4. **Workout Runner**: sequential flow, set logging (weight/reps/RIR), rest timer with sounds + wake lock, warm-up generation, add-exercise, resume/discard prompt, finish/summary. *App is usable in the gym from here.*
5. **History**: per-exercise table + weekly volume per muscle group + session log.
6. **Recommendations**: §5.5 engine + reason line + plateau flag.
7. **Substitution**: §5.6 swap flow.
8. **Polish**: airplane-mode QA, Lighthouse PWA pass, icon set, empty states.

## 10. Acceptance criteria (spot checks)

- Fresh iPhone: install from Safari → magic-code login → exercises present → create routine → run full workout **in airplane mode** → data appears on Mac when back online.
- Rest timer: switch to Spotify mid-rest, return — remaining time is correct. Final-5-second clicks audible over music when app is foregrounded.
- First-ever set of an exercise prompts for weight; second session shows a recommendation with a reason.
- Assisted pull-up progression displays decreasing assistance as progress.
- Swap on a busy machine offers same-muscle alternatives not already in today's routine.

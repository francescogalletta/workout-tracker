# Handoff: Lift — Workout Tracker PWA

## Overview

Lift is a single-user, offline-first workout tracking PWA (iPhone via Add-to-Home-Screen + Mac browser). This bundle contains everything needed to implement it: the authoritative build spec (`SPEC.md`), the frozen design tokens (`theme-tokens.md`), high-fidelity interactive prototypes of every screen (`prototypes/`), and app icons (`assets/`).

**Read order: `SPEC.md` first** (stack, data model, engine rules, PWA constraints), **then this README** (what the prototypes decided, extended, or changed), **then the prototypes** (exact visuals + interactions).

## About the Design Files

The files in `prototypes/` are **design references created in HTML** — they open directly in a browser and are fully interactive, but they are *not* production code. Do **not** copy them into the app. The task is to **recreate these designs in the stack fixed by SPEC.md §2**: Vite + React + TypeScript + Tailwind + InstantDB + vite-plugin-pwa. All prototype logic (demo data, theme switching via CSS vars, fake auth) must be replaced by real InstantDB queries, real auth, and real engine code.

Each prototype has small "Prototype chrome" controls at the top (theme toggle, "First run", "Resume demo", "Reset"). These are **demo affordances only** — do not implement them. "First run" chips preview the empty states; "Resume demo" previews the resume-or-discard dialog.

## Fidelity

**High-fidelity.** Colors, typography, spacing, sizing, copy, and interaction patterns are final and owner-approved. Recreate pixel-perfectly (Tailwind theme config from the tokens below). The only intentionally-unfinished area is the **Ember theme's typography** — see "Theming" below.

## Decisions made during design (extends or supersedes SPEC.md)

The spec is authoritative for architecture; the prototypes are authoritative for UI. Where they differ, the following owner-approved decisions from the design phase win:

1. **Volt is the default theme** (true-black OLED, `#C8FF2E` accent, JetBrains Mono, uppercase). Ember is the alternate, switchable in Settings.
2. **Weight stepper is a single −/+ pair** (not 4 buttons): `[− step] [big numeral] [+ step]`, stepping by the configured `weightIncrementKg`. Button labels show the actual step value ("−2.5" / "+2.5"). **Long-press (450 ms) on either ± opens a per-session step chooser** (0.5 / 1 / 1.25 / 2.5 / 5 kg bottom sheet). Default step lives in Settings.
3. **Cardio items are supported in the runner** (extension of spec's strength-only scope, owner-approved): a routine item can be `kind: "cardio"` with 2–3 configurable metrics (time, resistance level, pace, incline), each with its own −/+ stepper. Cardio sets have no RIR, no rest timer, and are excluded from the strength recommendation engine.
4. **History = two tabs: "Log" and "Insights · Plan"** (extension of spec §4.5, owner-approved):
   - **Log**: per-session cards, each exercise a horizontally-scrollable set table (columns = S1…Sn; rows = kg / reps / RIR). A **filter menu** (bottom sheet) narrows the log by muscle group (chip row) or a single exercise (list with session counts). Exercise filter shows a summary line ("5 sessions · 55 → 62.5 kg"). Overflowing set tables show edge-fade arrows: `›` on the right until scrolled to the end, `‹` on the left once scrolled.
   - **Insights · Plan**: averaging window chips (2/4/6/8 wk); **suggested adjustments** computed from the log (rules below); accepting one creates an **active target** (weight goal shown in the runner's reco panel, expires after 4 weeks, removable); **muscle balance** list (working sets per week per muscle group vs a 10–20 band, "OK"/"Low" status).
   - Insight rules: *lower weight* when ≥40% of sets are at RIR 0 **and** avg reps < target (suggest −10%, rounded to 1.25); *add weight* when avg RIR ≥ target RIR + 1 (suggest +1 increment). Sort by severity, lower-weight first.
5. **Session exercise reorder**: "Order" action in the runner header opens a bottom sheet with ↑/↓ per exercise. Reorders **this session only**; routine template unchanged.
6. **Warm-ups of the first exercise are hoisted** into a leading "Warm-up" section at the top of the runner list (so the workout starts with warm-up rows); later exercises show inline "Warm-up" / "Working sets" dividers. The active warm-up card's label is just the exercise name (section header already says Warm-up).
7. **Logged-set checkmark is accent-colored** (`--acc`), weight 800 — completed rows read at a glance.
8. **First-run empty states** exist for Home ("No routines yet" + "Create first routine" CTA), Routines (explainer + CTA), and both History tabs. Preview them with the "First run" chrome chip.
9. **Sign-in screen** (`Sign In.dc.html`): 3 steps — email → 6-digit code → "Ready." confirmation ("873 exercises loaded · works offline · syncs when online"). Maps to InstantDB magic-code auth. No spinners anywhere; steps switch instantly.
10. **No plate calculator, no supersets, no 1RM charts** — reconfirmed.

## Screens

All screens are mobile-first, max content width 430 px, centered on wider viewports. Desktop layouts are explicitly **out of scope for v1** — the mobile layout is used everywhere.

### 1. Sign In (`prototypes/Sign In.dc.html`)
Wordmark "LIFT" top-left (12 px, weight 700, letter-spacing 0.24em, `--dim`). Center block vertically centered; primary button pinned to bottom third (68 px, accent bg, radius 6). Email input 56 px; code input 72 px, 34 px tabular digits, letter-spacing 0.4em, centered. "Use a different email" is a quiet underlined text action.

### 2. Home (`prototypes/Home.dc.html`)
Ultra-minimal. Vertically centered: rotation eyebrow ("NEXT IN ROTATION · 1 OF 4", 11 px `--mut`), routine name (44 px / 800), 2-line exercise preview (12 px `--mut`), "Change routine" quiet link (opens bottom-sheet list of all routines, suggested one highlighted in accent), "Last · Pull A · Thu, 62 min" (11 px `--dim`). Bottom: 68 px accent "Start workout" + quiet Routines / History / Settings links (11 px, gap 32). Resume-or-discard modal: centered card, "Resume" accent 56 px, "Discard" outline 52 px, footnote "Discarding keeps logged sets in history".

### 3. Routines (`prototypes/Routines.dc.html`)
Two sections with 9 px letter-spaced hairline headers: "Rotation · repeats in this order" (numbered position badge 26 px circle, accent when up-next; ↑/↓ 44 px reorder buttons; "In rotation" toggle 52×32) and "Not in rotation · start any time". Each row: name 13 px/700, meta 10 px, "Start ▸" outline button 44 px. "+ New routine" quiet centered link.

### 4. Routine Editor (`prototypes/Routine Editor.dc.html`)
Per-item editing: sets / reps / target RIR / rest override / warm-up toggle, exercise picker entry, item reorder. Reference the prototype for exact controls.

### 5. Workout Runner (`prototypes/Runner Prototype.dc.html`) — the core screen
- **Header**: routine name left; elapsed timer (tabular), "Order", "Finish" quiet links right. No tab bar, no menus.
- **Exercise list**: each exercise = name (14 px/700) + scheme ("4×8 @ RIR 2", 11 px `--dim`) + "Swap" quiet link. Set rows are 1-line buttons (radius 4): check/dot mark (accent when logged), then columnar text `Set 1   62.5 kg × 8   target RIR 2` (13 px tabular, `white-space: pre` for alignment; logged rows show actual values in `--mut`). Warm-up rows are visually muted (smaller text, hairline border).
- **Active set card** (the current set expands inline): surface card (radius 6). Label "SET 1 OF 4" (11 px, 0.16em). Weight block: `[−2.5]` 72×56 outline button · 52 px/800 numeral with dotted underline (tap → keypad sheet) + "KG" label · `[+2.5]`. Below: reco panel (3-column grid: **Last** box / **↑ +2.5 kg +4.2% vs last** center / **Target** box — accent label + solid border when an Insights target exists, dashed "No target · set in Insights" otherwise). First-time exercises show "first time — enter weight (tap the number)" instead. Plateau: dashed-border banner with "Dismiss". Reps block: `[−]` 72×56 · 38 px numeral · `[+]`. RIR row: 5 pills (0/1/2/3/4+), 48 px, selected = accent fill, preselected to target.
- **Pinned log bar**: full-width 58 px accent button fixed at bottom, "LOG SET 1/4 · START REST" (or "Log warm-up" / "Log cardio"). Logging: marks the set, seeds remaining empty sets with the weight, advances the pointer, auto-scrolls the next card into view, and (for working sets) starts rest.
- **Rest takeover**: full-screen, `--bg`. "REST" eyebrow + exercise name. 104 px/800 accent countdown (timestamp-based: store absolute end time). Next-set card beneath: "NEXT · SET 2 OF 4" / "62.5 kg × 8 @ RIR 2" / "Last · 60 kg · 4×10 @ RIR 3". Bottom: −15s / +15s / Skip (60 px). Audio: click at each of the final 5 s (square wave ~1100 Hz, 40 ms), distinct tone at 0 (~1650 Hz, 300 ms) via Web Audio (prime AudioContext on Start-workout tap). Wake lock while session active.
- **Keypad sheet**: bottom sheet, current value 40 px accent, 3×4 grid (1-9, ., 0, ⌫) 54 px keys, accent "Done" 56 px.
- **Exercise picker** (swap + add): full-screen takeover. Title + Cancel. Search input 48 px. "Muscle group" and "Equipment" labeled chip rows (34 px pill chips, accent when selected). Result rows show name + `muscle · equipment`; swap mode sorts same-muscle first and badges them "SAME MUSCLE" (accent outline pill); already-in-session exercises excluded. Footnote explains scope. Swap confirm sheet: "This session only" (accent) / "Also update routine" / Cancel.
- **Finish**: confirm sheet ("N working sets logged so far") → full-screen summary: "PUSH A · COMPLETE", 64 px accent elapsed time, "12 working sets · 2,340 kg total volume", per-exercise improvements line ("Bench Press ↑ +2.5 kg · Incline DB Press · first log"), accent "Done".

### 6. History (`prototypes/History.dc.html`)
Header + Home link. 48 px two-tab switch (Log / Insights · Plan, accent = active). Both tabs described in "Decisions" §4 above. Set table cells: 56 px wide columns, kg 13 px/700 `--tx`, reps 12 px `--sec`, RIR 12 px `--mut`, row-label gutter 38 px. Footnote: "Working sets only · warm-ups excluded · most recent first".

### 7. Settings (`prototypes/Settings.dc.html`)
Rows (radius 6 cards): Theme (Volt/Ember chips), Default unit (kg/lb + note "stored in kg"), Rest timer sound toggle, Default rest (60s/90s/120s chips), Weight step (0.5/1/1.25/2.5/5 chips + note about long-press), Account (email + "Synced · magic-code sign-in" + Sign out).

## Interactions & Behavior (route-independent rules)

- **Zero loading states.** No spinners, no skeletons, ever (InstantDB is local-first). Every tap responds < 100 ms, optimistic UI throughout.
- Touch targets ≥ 44–48 px; primary actions in the bottom third; steppers 52–72 px; log/start buttons 56–68 px full width.
- Motion: 150–250 ms ease-out, `transform`/`opacity` only. Overlays slide up 22 ms×10 (`translateY(24px)→0` fade, or `translateY(100%)` for sheets). One satisfying spring on set-confirm is welcome; nothing else.
- Bottom sheets: dimmed backdrop `rgba(0,0,0,0.55)`, card radius 6 top corners only, tap-outside dismisses.
- Disable pinch-zoom; no edge gestures; every gesture has a tap alternative.
- Numerals everywhere are **tabular** (`font-variant-numeric: tabular-nums`).
- Timer correctness: store absolute `endsAt`; render `endsAt − now` per tick; survives backgrounding (cues can't fire while backgrounded — accepted).

## State Management (implementation mapping)

Data model, sync, and permissions: SPEC.md §3 (InstantDB entities `exercises`, `routines`, `routineItems`, `sessions`, `setLogs`, `settings`). Additional client state surfaced by the prototypes:

- Runner: active-set pointer (exercise idx, set idx), per-session exercise order + swapped/added items (session-scoped copies, template untouched), rest `{endsAt, nextSet}`, per-session weight-step override, keypad/sheet open states.
- Recommendation engine (SPEC.md §5.5) drives the prescribed weight, the reason/delta line, and the plateau flag. **Add**: active targets (from History Insights) with `weight, expiresAt`; runner shows target in the reco panel's third column.
- History: filter `{type: 'exercise'|'group', value}`, averaging window (weeks), accepted targets.
- Settings singleton: `defaultRestSec`, `soundEnabled`, `weightIncrementKg`, `unit`, `theme`, `email`.

## Design Tokens

Authoritative file: `theme-tokens.md`. Summary:

**Volt (default)** — bg `#000000`, surface `#0A0A0A`, hairline `#161616`, border `#222222`, border-strong `#333333`, row-border `#1C1C1C`, text `#F2F2F2`, secondary `#9A9A9A`, muted `#6B6B6B`, dim `#4A4A4A`, accent `#C8FF2E`, on-accent `#000000`. Font: **JetBrains Mono** (400/700/800), UPPERCASE labels, letter-spacing 0.04–0.24em. Radius 4 (small) / 6 (cards, buttons). Chips are full-round (999px).

**Ember (alternate)** — bg `#17120E`, surface `#221B13`, raised `#2E251A`, inset `#1E1710`/`#1B140E`, border `#2E261D`, text `#F5EDE3`, bright `#FFF9F0`, muted `#9A8B78`, dim `#6E6153`, accent `#FF6A2B`, on-accent `#1A0F05`, reason-line `#C08A5A`. Per `theme-tokens.md` Ember should use **Archivo** (400/600/700/800), sentence case, radius 12–20. ⚠️ The prototypes approximate Ember with the palette only (still mono/uppercase/4-6 radius) — **implement Ember per `theme-tokens.md`, not per the prototype**. Numerals stay tabular in both themes.

Type scale (Volt, from prototypes): 9/10/11 px micro-labels (letter-spacing 0.1–0.2em) · 12–13 px body/rows · 14–17 px titles · 20 px rest-next value · 32–44 px display · 38 px reps numeral · 52 px weight numeral · 64 px summary time · 104 px rest countdown.

Spacing: 18–20 px screen padding; 10–14 px card padding; 6–12 px gaps; sections separated by hairline-rule headers (9 px label + 1 px line).

## Assets

- `assets/icon-1024.png`, `assets/icon-180.png` — app icon (black bg, Volt-lime barbell mark). Manifest: `display: standalone`, portrait, name "Lift", `theme_color`/`background_color` `#000000`.
- Exercise database: seed from `yuhonas/free-exercise-db` per SPEC.md §6 (not bundled here).
- Fonts: JetBrains Mono + Archivo via Google Fonts (self-host for offline precache).

## Files

- `SPEC.md` — authoritative build spec (stack, data model, engine, PWA constraints, milestones, acceptance criteria)
- `theme-tokens.md` — frozen theme tokens
- `prototypes/Sign In.dc.html` · `Home.dc.html` · `Routines.dc.html` · `Routine Editor.dc.html` · `Runner Prototype.dc.html` · `History.dc.html` · `Settings.dc.html` — interactive hi-fi references (open in any browser; keep `support.js` next to them)
- `prototypes/Design Exploration.dc.html` — the original 4-route visual exploration (context only)
- `assets/` — app icons

## Acceptance

Implement against SPEC.md §9 milestones and §10 acceptance criteria, plus: the History filter flow, Insights targets appearing in the runner reco panel, the single-± stepper with long-press step chooser, cardio items, session reorder, and all first-run empty states shown in the prototypes.

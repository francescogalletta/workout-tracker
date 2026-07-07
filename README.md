# Lift — Workout Tracker PWA

Single-user, offline-first workout tracker. A personal project, built from a
design handoff (spec, tokens, and interactive prototypes in `design/`). The
Runner prototype reference is at `design/prototypes/Runner Prototype.dc.html`
(open in a browser, keep `support.js` next to it).

## Status

**All screens implemented** (SPEC §9.1–9.7): Home (rotation suggestion,
resume-or-discard), Routines (rotation reorder/toggles), Routine Editor, Workout
Runner (engine-driven prescriptions, rest takeover with audio cues, warm-ups,
swap/add, cardio), History (Log + Insights · Plan with targets and muscle
balance), Settings (Volt/Ember themes), Sign In. End-to-end integration flow
covered by the test suite.

**Auth is offline-first, sign-in is opt-in sync — NOT a gate.** The app boots
straight to Home on the local (localStorage) backend and is fully functional
signed out, offline, with no account. Signing in (from Settings → Sync) enables
cloud sync across devices via InstantDB magic-code auth. On success the store
reconciles the first remote snapshot with local (`classifySync`): a fresh account
gets local uploaded (`mergeDb`); an account with data but a fresh device adopts
remote silently; if BOTH hold data (routines/sessions/setLogs/targets) it pauses
and warns — "Use account data" backs the device's data up to `lift.db.backup`
then replaces local with remote, "Cancel" signs out leaving local untouched.
Sign out snapshots data back into localStorage and returns to local; no data is
lost silently either way. Without an app id the app still runs fully offline (Settings
shows "Sync unavailable"). Data layer lives in `src/data/` behind a two-backend
seam (`src/data/backend/`); architecture contract in `docs/PLAN.md`. Open
`/?demo` for a seeded demo dataset (2.5 weeks of history, plateau + insight
fodder).

**Known gaps / next**: InstantDB sync is wired but needs an app ID from
instantdb.com in `.env.local` (`VITE_INSTANT_APP_ID`) to activate; a real
magic-code round-trip can't be exercised in tests, so the sign-in merge core
(`mergeDb`) is unit-tested and the async wiring is driven by the auth callback.
Exercise DB seeding from free-exercise-db (SPEC §6),
vite-plugin-pwa + icons (icons live in the design project), lb display
conversion (`settings.unit` persists but everything renders kg), ad-hoc
runner exercises default to 90 s rest instead of the Settings default.

## Commands (everything runs in Docker)

```sh
make dev    # vite dev server → http://localhost:5173
make test   # vitest
make build  # typecheck + production build
make shell  # shell inside the container
```

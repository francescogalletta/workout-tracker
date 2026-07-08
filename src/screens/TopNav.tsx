import { navigate, type Route } from '../router'

/**
 * Persistent top navigation (owner decision, supersedes the prototypes'
 * per-screen quiet-link navigation). Shown on every screen EXCEPT Sign In
 * (#/signin) — see `showTopNav`.
 *
 * Two stacked bars (re-org: the single crammed row truncated on narrow
 * phones):
 *   1. Title bar — the LIFT wordmark left, the Settings option far right.
 *   2. Section bar just below — the primary destinations Workout · Routines ·
 *      Exercises · History as a tab strip.
 * Active route is the accent-coloured, bold link with a short accent underline
 * in the tab strip; the others stay muted. RoutineEditor counts as Routines,
 * run counts as Workout.
 *
 * Sticky + opaque `bg-bg` so page content scrolls under it; `z-20` sits below
 * overlays/sheets (z ≥ 40). Tokens only — verified in Ember too. Keep the two
 * bar heights in sync with `--nav-h` in index.css.
 */

/** Which nav destination a route highlights (null → nav is not shown at all). */
type NavKey = 'home' | 'routines' | 'exercises' | 'history' | 'settings'

/** Primary destinations shown as the section tab strip (second bar). */
const TABS: ReadonlyArray<readonly [label: string, path: string, key: NavKey]> = [
  ['Workout', '/', 'home'],
  ['Routines', '/routines', 'routines'],
  ['Exercises', '/exercises', 'exercises'],
  ['History', '/history', 'history'],
] as const

/** Route → active nav key. RoutineEditor maps onto Routines; run onto Workout. */
export function activeNavKey(route: Route['name']): NavKey | null {
  switch (route) {
    case 'home':
    case 'run':
      return 'home'
    case 'routines':
    case 'routineEditor':
      return 'routines'
    case 'exercises':
      return 'exercises'
    case 'history':
      return 'history'
    case 'settings':
      return 'settings'
    default:
      return null // signin — chrome-free / focused
  }
}

/**
 * Whether the persistent nav shows for a route. Kept visible during a workout
 * (#/run) so you can jump between sections at any time; only Sign In stays
 * chrome-free. Runner overlays (rest/picker/summary) sit at z ≥ 40 and cover
 * the nav (z-20) while active.
 */
export function showTopNav(route: Route['name']): boolean {
  return route !== 'signin'
}

export function TopNav({ route }: { route: Route['name'] }) {
  const active = activeNavKey(route)
  return (
    <nav className="sticky top-0 z-20 bg-bg font-mono">
      {/* Title bar: wordmark + Settings */}
      <div className="flex justify-center border-b border-bd pt-[max(var(--safe-top),8px)]">
        <div className="box-border flex h-12 w-full max-w-[430px] items-center justify-between px-5">
          <span className="text-[12px] font-bold tracking-[0.24em] text-dim uppercase">Lift</span>
          <button
            onClick={() => navigate('/settings')}
            aria-current={active === 'settings' ? 'page' : undefined}
            className={`tt-label flex h-12 cursor-pointer items-center border-0 bg-transparent pl-4 font-mono text-[11px] tracking-[0.1em] ${
              active === 'settings' ? 'font-extrabold text-acc' : 'font-normal text-mut'
            }`}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Section bar: primary destinations */}
      <div className="flex justify-center border-b border-bd">
        <div className="box-border flex h-11 w-full max-w-[430px] items-center justify-between px-5">
          {TABS.map(([label, path, key]) => {
            const on = key === active
            return (
              <button
                key={key}
                onClick={() => navigate(path)}
                aria-current={on ? 'page' : undefined}
                className={`tt-label flex h-11 cursor-pointer items-center border-0 border-b-2 bg-transparent px-1 font-mono text-[11px] tracking-[0.1em] ${
                  on
                    ? 'border-b-acc font-extrabold text-acc'
                    : 'border-b-transparent font-normal text-mut'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

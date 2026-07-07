import { navigate, type Route } from '../router'

/**
 * Persistent top navigation (owner decision, supersedes the prototypes'
 * per-screen quiet-link navigation). Shown on every screen EXCEPT the Workout
 * Runner (#/run) and Sign In (#/signin) — see `showTopNav`. One sticky row: the
 * LIFT wordmark left, the four primary destinations right. Active route is the
 * accent-coloured, bold link (accent is the only signal — no underline); the
 * others stay muted. RoutineEditor counts as Routines.
 *
 * Sticky + opaque `bg-bg` so page content scrolls under it; `z-20` sits below
 * overlays/sheets (z ≥ 40). Tokens only — verified in Ember too.
 */

/** Which nav destination a route highlights (null → nav is not shown at all). */
type NavKey = 'home' | 'routines' | 'history' | 'settings'

const LINKS: ReadonlyArray<readonly [label: string, path: string, key: NavKey]> = [
  ['Home', '/', 'home'],
  ['Routines', '/routines', 'routines'],
  ['History', '/history', 'history'],
  ['Settings', '/settings', 'settings'],
] as const

/** Route → active nav key. RoutineEditor maps onto Routines. */
export function activeNavKey(route: Route['name']): NavKey | null {
  switch (route) {
    case 'home':
      return 'home'
    case 'routines':
    case 'routineEditor':
      return 'routines'
    case 'history':
      return 'history'
    case 'settings':
      return 'settings'
    default:
      return null // run, signin — nav is chrome-free / focused
  }
}

/** Whether the persistent nav shows for a route (hidden on run + signin). */
export function showTopNav(route: Route['name']): boolean {
  return route !== 'run' && route !== 'signin'
}

export function TopNav({ route }: { route: Route['name'] }) {
  const active = activeNavKey(route)
  return (
    <nav className="sticky top-0 z-20 flex justify-center border-b border-bd bg-bg pt-[max(var(--safe-top),8px)] font-mono">
      <div className="box-border flex h-12 w-full max-w-[430px] items-center justify-between px-5">
        <span className="text-[12px] font-bold tracking-[0.24em] text-dim uppercase">Lift</span>
        <div className="flex items-center">
          {LINKS.map(([label, path, key]) => {
            const on = key === active
            return (
              <button
                key={key}
                onClick={() => navigate(path)}
                aria-current={on ? 'page' : undefined}
                className={`tt-label flex h-12 cursor-pointer items-center border-0 bg-transparent px-2 font-mono text-[11px] tracking-[0.1em] ${
                  on ? 'font-extrabold text-acc' : 'font-normal text-mut'
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

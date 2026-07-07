import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import type { AuthApi } from './auth'
import { discardSession } from './data/mutations'
import { activeSession } from './data/queries'
import {
  getDb,
  hasInstant,
  resolveSyncConflictAdopt,
  resolveSyncConflictCancel,
  useDb,
  useSyncConflict,
} from './data/store'
import type { RemoteCounts } from './data/backend/sync'
import type { Session } from './data/types'
import { navigate, useRoute } from './router'
import { Runner } from './runner/Runner'
import { useThemeEffect } from './theme'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { RoutineEditor } from './screens/RoutineEditor'
import { Routines } from './screens/Routines'
import { Settings } from './screens/Settings'
import { SignIn } from './screens/SignIn'
import { TopNav, showTopNav } from './screens/TopNav'

/**
 * App root. There is NO auth gate: the app always boots straight to Home on the
 * local backend — signed out, offline, no app id needed — and every screen
 * works. Signing in is an opt-in from Settings that enables cloud sync.
 *
 * When an app id is configured (`hasInstant`), the lazy `InstantSync` shell is
 * mounted around `Shell`: it watches InstantDB's `useAuth` and, when a session
 * resolves, switches the store to the instant backend (merge-up). Its Suspense
 * fallback is a plain `<Shell />`, so the app is fully usable while that chunk
 * loads — no blank cold-start screen anymore.
 */
const InstantSync = lazy(() => import('./AppInstant'))

export default function App() {
  if (hasInstant) {
    return (
      <Suspense fallback={<Shell />}>
        <InstantSync />
      </Suspense>
    )
  }
  return <Shell />
}

/**
 * Shared shell: hash router + theme + the global resume-or-discard prompt
 * (SPEC §3). Renders the routed screen directly — no gate. `authApi`, when
 * present (instant build), reaches the Sign In screen so it can drive the real
 * magic-code flow.
 */
export function Shell({ authApi }: { authApi?: AuthApi } = {}) {
  const db = useDb()
  const route = useRoute()
  const active = activeSession(db)
  const conflict = useSyncConflict()

  useThemeEffect(db.settings.theme)

  let screen: ReactNode
  switch (route.name) {
    case 'home':
      screen = <Home />
      break
    case 'signin':
      screen = <SignIn authApi={authApi} />
      break
    case 'routines':
      screen = <Routines />
      break
    case 'routineEditor':
      screen = <RoutineEditor id={route.id} />
      break
    case 'run':
      screen = <RunScreen />
      break
    case 'history':
      screen = <History />
      break
    case 'settings':
      screen = <Settings />
      break
  }

  return (
    <>
      {showTopNav(route.name) && <TopNav route={route.name} />}
      {screen}
      {active && route.name !== 'run' && (
        <ResumePrompt
          session={active}
          setsLogged={db.setLogs.filter((l) => l.sessionId === active.id).length}
        />
      )}
      {conflict && (
        <SyncConflictPrompt
          counts={conflict.counts}
          onAdopt={resolveSyncConflictAdopt}
          onCancel={resolveSyncConflictCancel}
        />
      )}
    </>
  )
}

/**
 * #/run hosts the Runner for the active session. The session is captured at
 * mount so finishing (status → completed) doesn't unmount the summary
 * screen; arriving with no active session redirects home.
 */
function RunScreen() {
  const [session] = useState<Session | null>(() => activeSession(getDb()))
  useEffect(() => {
    if (!session) navigate('/')
  }, [session])
  if (!session) return null
  return <Runner key={session.id} session={session} onDone={() => navigate('/')} />
}

/** Resume-or-discard modal per the Runner prototype's RESUME PROMPT block. */
function ResumePrompt({ session, setsLogged }: { session: Session; setsLogged: number }) {
  const minAgo = Math.max(0, Math.round((Date.now() - session.startedAt) / 60000))
  return (
    <div className="fixed inset-0 z-70 box-border flex items-center justify-center bg-black/65 p-6 font-mono">
      <div className="animate-ovl-up box-border flex w-full max-w-[360px] flex-col gap-3 rounded-rl border border-cardbd bg-cardbg p-[22px_18px]">
        <div className="tt-label text-[13px] font-extrabold tracking-[0.06em] text-tx">
          Workout in progress
        </div>
        <div className="text-[12px] leading-[1.6] text-mut">
          {session.routineName} · started {minAgo} min ago · {setsLogged}{' '}
          {setsLogged === 1 ? 'set' : 'sets'} logged.
        </div>
        <button
          onClick={() => navigate('/run')}
          className="tt-label flex h-14 cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[14px] font-extrabold tracking-[0.06em] text-onacc"
        >
          Resume
        </button>
        <button
          onClick={() => discardSession(session.id)}
          className="tt-label flex h-[52px] cursor-pointer items-center justify-center rounded-rl border border-stepbd bg-stepbg font-mono text-[14px] font-bold tracking-[0.06em] text-tx"
        >
          Discard
        </button>
        <div className="text-center text-[10px] tracking-[0.04em] text-dim uppercase">
          Discarding keeps logged sets in history
        </div>
      </div>
    </div>
  )
}

/**
 * Sign-in adoption conflict modal (SPEC: replace-after-warning). Shown when the
 * signed-in account already holds meaningful data AND this device does too, so
 * syncing would replace local. Matches the ResumePrompt visual pattern. This is
 * a destructive decision, so tapping the backdrop does NOT dismiss — the user
 * must pick "Use account data" (adopt remote, local backed up first) or
 * "Cancel" (sign out, local untouched).
 */
export function SyncConflictPrompt({
  counts,
  onAdopt,
  onCancel,
}: {
  counts: RemoteCounts
  onAdopt: () => void
  onCancel: () => void
}) {
  const routines = `${counts.routines} ${counts.routines === 1 ? 'routine' : 'routines'}`
  const workouts = `${counts.workouts} ${counts.workouts === 1 ? 'workout' : 'workouts'}`
  return (
    <div className="fixed inset-0 z-70 box-border flex items-center justify-center bg-black/65 p-6 font-mono">
      <div className="animate-ovl-up box-border flex w-full max-w-[360px] flex-col gap-3 rounded-rl border border-cardbd bg-cardbg p-[22px_18px]">
        <div className="tt-label text-[13px] font-extrabold tracking-[0.06em] text-tx">
          Account data found
        </div>
        <div className="text-[12px] leading-[1.6] text-mut">
          This account has {routines} · {workouts}. Syncing replaces the data on this device.
        </div>
        <button
          onClick={onAdopt}
          className="tt-label flex h-14 cursor-pointer items-center justify-center rounded-rl border-0 bg-acc font-mono text-[14px] font-extrabold tracking-[0.06em] text-onacc"
        >
          Use account data
        </button>
        <button
          onClick={onCancel}
          className="tt-label flex h-[52px] cursor-pointer items-center justify-center rounded-rl border border-stepbd bg-stepbg font-mono text-[14px] font-bold tracking-[0.06em] text-tx"
        >
          Cancel
        </button>
        <div className="text-center text-[10px] tracking-[0.04em] text-dim uppercase">
          This device's data is backed up first
        </div>
      </div>
    </div>
  )
}

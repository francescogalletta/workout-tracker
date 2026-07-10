import type { ReactNode } from 'react'
import { RestSlider } from '../components/RestSlider'
import { Toggle } from '../components/Toggle'
import { classifySyncError } from '../data/backend/syncError'
import { updateSettings } from '../data/mutations'
import { isIOS, previewCue } from '../lib/audio'
import { retrySync, signOut, type SyncStatus, useDb, useSyncStatus } from '../data/store'
import type { AppSettings } from '../data/types'
import { navigate } from '../router'

/**
 * Settings — recreated from design/prototypes/Settings.dc.html.
 *
 * Rows are radius-rl cards. Every control writes through updateSettings and is
 * optimistic (no confirmation dialogs). Theme chips flip settings.theme, which
 * App's useThemeEffect maps onto <html data-theme>.
 *
 * The Sync section is the only opt-in to cloud sync (there is no gate). Its
 * three states are a pure function of whether a backend is configured and
 * whether a session is active (mirrored `settings.email`).
 */

export type SyncState = 'unavailable' | 'off' | 'on'

/**
 * Legacy pure selector for the coarse three-state view. Retained for the
 * signed-in/out/unavailable copy checks; the live section now renders from the
 * richer `SyncStatus` machine in the store (connecting/error/conflict too).
 */
export function syncState(syncAvailable: boolean, email: string | null): SyncState {
  if (!syncAvailable) return 'unavailable'
  return email != null ? 'on' : 'off'
}

/** "3 routines" / "1 workout" pluralization for the count line. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Row card wrapper (filled-surface in Ember, hairline outline in Volt). */
function Row({ children, column = false }: { children: ReactNode; column?: boolean }) {
  return (
    <div
      className={`box-border flex gap-3 rounded-rl border border-rowbd bg-rowbg p-[14px] ${
        column ? 'flex-col' : 'items-center justify-between'
      }`}
    >
      {children}
    </div>
  )
}

function RowLabel({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">{title}</div>
      {note && <div className="text-[10px] tracking-[0.03em] text-mut">{note}</div>}
    </div>
  )
}

/** Selectable chip: accent fill when active, filled/outlined step surface otherwise. */
function SettingChip({
  label,
  selected,
  onClick,
  numeric = false,
  wide = false,
}: {
  label: string
  selected: boolean
  onClick: () => void
  numeric?: boolean
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 cursor-pointer items-center justify-center rounded-rs border text-[12px] font-bold ${
        wide ? 'w-full' : 'px-4'
      } ${numeric ? 'tabular-nums' : 'tracking-[0.06em] tt-label'} ${
        selected ? 'border-acc bg-acc text-onacc' : 'border-stepbd bg-stepbg text-sec'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * Sync-error card. Leads with what to DO in plain words (owner is non-technical),
 * reassures that on-device data is safe, and keeps the raw message only as a small
 * secondary "Details:" line for bug reports. All copy comes from the pure
 * `classifySyncError` presenter (offline / permissions / code-crash / generic).
 */
function SyncErrorRow({ status }: { status: SyncStatus }) {
  // Only claim "offline" when the browser explicitly says so. In non-browser
  // (SSR/test) envs `navigator.onLine` is undefined — treat that as online.
  const online = typeof navigator === 'undefined' || navigator.onLine !== false
  const view = classifySyncError(status.detail, online)
  return (
    <Row column>
      <div className="flex flex-col gap-[4px]">
        {status.account && (
          <div className="text-[12px] tracking-[0.03em] text-sec">{status.account}</div>
        )}
        <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">
          {view.title}
        </div>
        <div className="text-[10px] tracking-[0.06em] text-dim uppercase">On this device</div>
        <div className="text-[11px] leading-[1.7] tracking-[0.03em] text-sec">{view.body}</div>
        {view.details && (
          <div className="pt-[2px] text-[10px] leading-[1.6] tracking-[0.02em] text-mut">
            Details: {view.details}
          </div>
        )}
      </div>
      <div className="flex gap-[6px]">
        <QuietAction label="Retry sync" onClick={() => retrySync()} />
        <QuietAction label="Sign out" tone="mut" onClick={() => signOut()} />
      </div>
    </Row>
  )
}

/** Quiet, uppercase action button in the sync-section visual language. */
function QuietAction({
  label,
  onClick,
  tone = 'sec',
}: {
  label: string
  onClick: () => void
  tone?: 'sec' | 'mut'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg px-[14px] text-[11px] font-bold tracking-[0.08em] uppercase ${
        tone === 'mut' ? 'text-mut' : 'text-sec'
      }`}
    >
      {label}
    </button>
  )
}

export function Settings({ status: statusOverride }: { status?: SyncStatus } = {}) {
  const db = useDb()
  const s = db.settings
  const set = (patch: Partial<AppSettings>) => updateSettings(patch)
  // Live sync status from the store machine; overridable for render tests.
  const liveStatus = useSyncStatus()
  const status = statusOverride ?? liveStatus

  return (
    <div
      className="flex min-h-screen justify-center bg-bg"
      style={{ fontFamily: 'var(--f, "JetBrains Mono", monospace)' }}
    >
      <div className="box-border flex min-h-screen w-full max-w-[430px] flex-col pt-[24px] pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+28px)] pl-[max(18px,var(--safe-left))]">
        <div className="flex items-baseline pb-[18px]">
          <div className="tt-label text-[17px] font-bold tracking-[0.05em] text-tx">Settings</div>
        </div>

        <div className="flex flex-col gap-2">
          {/* Theme */}
          <Row>
            <RowLabel title="Theme" />
            <div className="flex gap-[6px]">
              {(['volt', 'ember'] as const).map((t) => (
                <SettingChip
                  key={t}
                  label={t === 'volt' ? 'Volt' : 'Ember'}
                  selected={s.theme === t}
                  onClick={() => set({ theme: t })}
                />
              ))}
            </div>
          </Row>

          {/* Default unit */}
          <Row>
            <RowLabel title="Default unit" note="Per-exercise override available · stored in kg" />
            <div className="flex gap-[6px]">
              {(['kg', 'lb'] as const).map((u) => (
                <SettingChip
                  key={u}
                  label={u}
                  selected={s.unit === u}
                  onClick={() => set({ unit: u })}
                />
              ))}
            </div>
          </Row>

          {/* Rest timer sound */}
          <button
            type="button"
            onClick={() => {
              const next = !s.soundEnabled
              set({ soundEnabled: next })
              // Audible confirmation, inside the tap gesture so iOS unlocks audio.
              if (next) previewCue()
            }}
            className="box-border flex cursor-pointer items-center justify-between gap-3 rounded-rl border border-rowbd bg-rowbg p-[14px] text-left"
          >
            <RowLabel
              title="Rest timer sound"
              note={`Clicks for the final 5 seconds, tone at zero${
                isIOS() ? ' · the ring/silent switch mutes these' : ''
              }`}
            />
            <Toggle on={s.soundEnabled} />
          </button>

          {/* Default rest */}
          <Row column>
            <RowLabel title="Default rest" note="Used when a routine doesn't set its own" />
            <RestSlider sec={s.defaultRestSec} onCommit={(sec) => set({ defaultRestSec: sec })} />
          </Row>

          {/* Weight step */}
          <Row column>
            <RowLabel
              title="Weight step · kg"
              note="Default step for the ± buttons · hold ± in the runner to change it for one session"
            />
            <div className="grid grid-cols-5 gap-[6px]">
              {[0.5, 1, 1.25, 2.5, 5].map((v) => (
                <SettingChip
                  key={v}
                  label={String(v)}
                  numeric
                  wide
                  selected={s.weightIncrementKg === v}
                  onClick={() => set({ weightIncrementKg: v })}
                />
              ))}
            </div>
          </Row>

          {/* Sync */}
          <div className="flex items-center gap-[10px] pt-5 pb-2">
            <div className="text-[9px] tracking-[0.2em] whitespace-nowrap text-mut uppercase">
              Sync
            </div>
            <div className="h-px flex-1 bg-bd" />
          </div>

          {status.state === 'unavailable' && (
            <Row>
              <div className="text-[11px] leading-[1.6] tracking-[0.03em] text-dim">
                Sync unavailable · no backend configured
              </div>
            </Row>
          )}

          {status.state === 'off' && (
            <Row column>
              <div className="flex flex-col gap-[4px]">
                <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">
                  Sync off
                </div>
                <div className="text-[10px] leading-[1.6] tracking-[0.03em] text-mut">
                  Your data lives on this device. Sign in to sync across devices.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/signin')}
                className="flex h-12 cursor-pointer items-center justify-center rounded-rs border border-stepbd bg-stepbg px-[14px] text-[11px] font-bold tracking-[0.08em] text-sec uppercase"
              >
                Sign in to sync
              </button>
            </Row>
          )}

          {status.state === 'connecting' && (
            <Row column>
              <div className="flex flex-col gap-[3px]">
                {status.account && (
                  <div className="text-[12px] tracking-[0.03em] text-sec">{status.account}</div>
                )}
                <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">
                  Connecting…
                </div>
                <div className="text-[10px] leading-[1.6] tracking-[0.06em] text-mut">
                  On this device · reaching your account
                </div>
              </div>
              <QuietAction label="Retry sync" onClick={() => retrySync()} />
            </Row>
          )}

          {status.state === 'conflict' && (
            <Row column>
              <div className="flex flex-col gap-[3px]">
                <div className="text-[11px] font-bold tracking-[0.1em] text-tx uppercase">
                  Account data found
                </div>
                <div className="text-[10px] leading-[1.6] tracking-[0.03em] text-mut">
                  Resolve the prompt to finish signing in.
                </div>
              </div>
            </Row>
          )}

          {status.state === 'error' && <SyncErrorRow status={status} />}

          {status.state === 'on' && (
            <Row column>
              <div className="flex flex-col gap-[3px]">
                {status.account && (
                  <div className="text-[12px] tracking-[0.03em] text-sec">{status.account}</div>
                )}
                <div className="text-[10px] tracking-[0.06em] text-dim uppercase">
                  Cloud sync on
                </div>
                {status.remoteCounts && (
                  <div className="text-[10px] tracking-[0.03em] text-mut">
                    {plural(status.remoteCounts.routines, 'routine')} ·{' '}
                    {plural(status.remoteCounts.workouts, 'workout')} in account
                  </div>
                )}
                {status.detail && (
                  <div className="text-[10px] leading-[1.6] tracking-[0.03em] text-dim">
                    {status.detail}
                  </div>
                )}
              </div>
              <QuietAction
                label="Sign out"
                tone="mut"
                onClick={() => {
                  // Snapshots the merged Db into localStorage, ends the InstantDB
                  // session, and switches back to local — data stays, app stays
                  // usable. No redirect: settings just flips to the "Sync off" row.
                  signOut()
                }}
              />
            </Row>
          )}

          <div className="pt-[14px] text-center text-[10px] tracking-[0.06em] text-dim uppercase">
            Lift v1 ·{' '}
            {status.state === 'on'
              ? 'data syncs automatically when online'
              : 'offline-first · sign in to sync'}
          </div>
        </div>
      </div>
    </div>
  )
}

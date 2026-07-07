import type { ReactNode } from 'react'
import { updateSettings } from '../data/mutations'
import { hasInstant, signOut, useDb } from '../data/store'
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

/** Pure state selector for the Sync section — unit-tested without a DOM. */
export function syncState(syncAvailable: boolean, email: string | null): SyncState {
  if (!syncAvailable) return 'unavailable'
  return email != null ? 'on' : 'off'
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

export function Settings({ syncAvailable = hasInstant }: { syncAvailable?: boolean } = {}) {
  const db = useDb()
  const s = db.settings
  const set = (patch: Partial<AppSettings>) => updateSettings(patch)
  const sync = syncState(syncAvailable, s.email)

  return (
    <div
      className="flex min-h-screen justify-center bg-bg"
      style={{ fontFamily: 'var(--f, "JetBrains Mono", monospace)' }}
    >
      <div className="box-border flex min-h-screen w-full max-w-[430px] flex-col p-[24px_18px_28px]">
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
            onClick={() => set({ soundEnabled: !s.soundEnabled })}
            className="box-border flex cursor-pointer items-center justify-between gap-3 rounded-rl border border-rowbd bg-rowbg p-[14px] text-left"
          >
            <RowLabel
              title="Rest timer sound"
              note="Clicks for the final 5 seconds, tone at zero"
            />
            <div
              className={`box-border flex h-8 w-[52px] items-center rounded-full border px-[3px] ${
                s.soundEnabled
                  ? 'justify-end border-acc bg-acc'
                  : 'justify-start border-stepbd bg-stepbg'
              }`}
            >
              <div
                className={`h-6 w-6 rounded-full ${s.soundEnabled ? 'bg-onacc' : 'bg-mut'}`}
              />
            </div>
          </button>

          {/* Default rest */}
          <Row>
            <RowLabel title="Default rest" />
            <div className="flex gap-[6px]">
              {[60, 90, 120].map((r) => (
                <SettingChip
                  key={r}
                  label={`${r}s`}
                  numeric
                  selected={s.defaultRestSec === r}
                  onClick={() => set({ defaultRestSec: r })}
                />
              ))}
            </div>
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

          {sync === 'unavailable' && (
            <Row>
              <div className="text-[11px] leading-[1.6] tracking-[0.03em] text-dim">
                Sync unavailable · no backend configured
              </div>
            </Row>
          )}

          {sync === 'off' && (
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

          {sync === 'on' && (
            <Row>
              <div className="flex flex-col gap-[3px]">
                <div className="text-[12px] tracking-[0.03em] text-sec">{s.email}</div>
                <div className="text-[10px] tracking-[0.06em] text-dim uppercase">
                  Synced · magic-code sign-in
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Snapshots the merged Db into localStorage, ends the InstantDB
                  // session, and switches back to local — data stays, app stays
                  // usable. No redirect: settings just flips to the "Sync off" row.
                  signOut()
                }}
                className="flex h-12 cursor-pointer items-center rounded-rs border border-stepbd bg-stepbg px-[14px] text-[11px] font-bold tracking-[0.08em] text-mut uppercase"
              >
                Sign out
              </button>
            </Row>
          )}

          <div className="pt-[14px] text-center text-[10px] tracking-[0.06em] text-dim uppercase">
            Lift v1 · {sync === 'on' ? 'data syncs automatically when online' : 'offline-first · sign in to sync'}
          </div>
        </div>
      </div>
    </div>
  )
}

import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { updateSettings } from '../data/mutations'
import { getDb, resetDb } from '../data/store'
import { applyTheme } from '../theme'
import { Settings, syncState } from './Settings'

beforeEach(() => resetDb())

describe('Settings render', () => {
  it('renders all the preference rows (smoke)', () => {
    const html = renderToString(<Settings />)
    expect(html).toContain('Settings')
    expect(html).toContain('Theme')
    expect(html).toContain('Default unit')
    expect(html).toContain('Rest timer sound')
    expect(html).toContain('Default rest')
    expect(html).toContain('Weight step')
    expect(html).toContain('stored in kg')
    expect(html).toContain('Sync')
  })
})

describe('syncState (pure selector)', () => {
  it('is unavailable with no backend configured, regardless of email', () => {
    expect(syncState(false, null)).toBe('unavailable')
    expect(syncState(false, 'x@y.z')).toBe('unavailable')
  })
  it('is off when a backend is configured but signed out', () => {
    expect(syncState(true, null)).toBe('off')
  })
  it('is on when a backend is configured and signed in', () => {
    expect(syncState(true, 'x@y.z')).toBe('on')
  })
})

describe('Settings sync section — status-driven states', () => {
  it('unavailable → dim "Sync unavailable" note, no button', () => {
    const html = renderToString(<Settings status={{ state: 'unavailable' }} />)
    expect(html).toContain('Sync unavailable · no backend configured')
    expect(html).not.toContain('Sign in to sync')
    expect(html).not.toContain('Sign out')
  })

  it('off → "Sync off" explainer + sign-in affordance', () => {
    const html = renderToString(<Settings status={{ state: 'off' }} />)
    expect(html).toContain('Sync off')
    expect(html).toContain('Your data lives on this device. Sign in to sync across devices.')
    expect(html).toContain('Sign in to sync')
    expect(html).not.toContain('Sign out')
  })

  it('connecting → account + "Connecting…" + Retry sync', () => {
    const html = renderToString(
      <Settings status={{ state: 'connecting', account: 'lifter@example.com' }} />,
    )
    expect(html).toContain('lifter@example.com')
    expect(html).toContain('Connecting')
    expect(html).toContain('Retry sync')
  })

  it('on → account, "Cloud sync on", row counts, Sign out', () => {
    const html = renderToString(
      <Settings
        status={{
          state: 'on',
          account: 'lifter@example.com',
          remoteCounts: { routines: 3, workouts: 12 },
        }}
      />,
    )
    expect(html).toContain('lifter@example.com')
    expect(html).toContain('Cloud sync on')
    expect(html).toContain('3 routines')
    expect(html).toContain('12 workouts')
    expect(html).toContain('in account')
    expect(html).toContain('Sign out')
    expect(html).not.toContain('Sync off')
  })

  it('on → surfaces the empty-but-healthy upload diagnostic when present', () => {
    const html = renderToString(
      <Settings
        status={{
          state: 'on',
          account: 'lifter@example.com',
          remoteCounts: { routines: 0, workouts: 0 },
          detail: "This account had no data yet — this device's data was uploaded to it.",
        }}
      />,
    )
    expect(html).toContain('0 routines')
    expect(html).toContain('had no data')
  })

  it('error (generic) → action-first copy + raw Details + Retry/Sign out', () => {
    const html = renderToString(
      <Settings
        status={{
          state: 'error',
          account: 'lifter@example.com',
          detail: 'Sync timed out. Check your connection and retry.',
        }}
      />,
    )
    expect(html).toContain('Sync hit a problem')
    expect(html).toContain('On this device')
    // Action-first body + raw message kept for bug reports.
    expect(html).toContain('safe on this device')
    expect(html).toContain('Details:')
    expect(html).toContain('Sync timed out')
    expect(html).toContain('Retry sync')
    expect(html).toContain('Sign out')
  })

  it('error (code crash) → "app hit a bug" copy, raw message in Details', () => {
    const html = renderToString(
      <Settings
        status={{
          state: 'error',
          account: 'lifter@example.com',
          detail: "Cannot access 'd' before initialization",
        }}
      />,
    )
    expect(html).toContain('The app hit a bug syncing')
    expect(html).toContain('safe on this device')
    // Raw message kept as a secondary Details line (apostrophes get HTML-escaped).
    expect(html).toContain('before initialization')
  })
})

describe('settings writes', () => {
  it('persists optimistically through updateSettings', () => {
    updateSettings({ theme: 'ember', unit: 'lb', defaultRestSec: 120, weightIncrementKg: 5 })
    const s = getDb().settings
    expect(s.theme).toBe('ember')
    expect(s.unit).toBe('lb')
    expect(s.defaultRestSec).toBe(120)
    expect(s.weightIncrementKg).toBe(5)
  })

  it('clearing the email flips sync back to off (local sign-out)', () => {
    updateSettings({ email: 'lifter@example.com' })
    expect(syncState(true, getDb().settings.email)).toBe('on')
    updateSettings({ email: null })
    expect(getDb().settings.email).toBeNull()
    expect(syncState(true, getDb().settings.email)).toBe('off')
  })
})

describe('applyTheme', () => {
  it('is a no-op without a document (SSR-safe)', () => {
    expect(() => applyTheme('ember')).not.toThrow()
    expect(() => applyTheme('volt')).not.toThrow()
  })
})

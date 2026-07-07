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

describe('Settings sync section — three states', () => {
  it('no backend → dim "Sync unavailable" note, no button', () => {
    const html = renderToString(<Settings syncAvailable={false} />)
    expect(html).toContain('Sync unavailable · no backend configured')
    expect(html).not.toContain('Sign in to sync')
    expect(html).not.toContain('Sign out')
  })

  it('backend + signed out → "Sync off" explainer + sign-in affordance', () => {
    const html = renderToString(<Settings syncAvailable={true} />)
    expect(html).toContain('Sync off')
    expect(html).toContain('Your data lives on this device. Sign in to sync across devices.')
    expect(html).toContain('Sign in to sync')
    expect(html).not.toContain('Sign out')
  })

  it('backend + signed in → email, synced label, Sign out', () => {
    updateSettings({ email: 'lifter@example.com' })
    const html = renderToString(<Settings syncAvailable={true} />)
    expect(html).toContain('lifter@example.com')
    expect(html).toContain('Synced · magic-code sign-in')
    expect(html).toContain('Sign out')
    expect(html).not.toContain('Sync off')
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

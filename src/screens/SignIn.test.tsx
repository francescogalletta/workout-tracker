import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../data/store'
import { SignIn, friendlyAuthError, isValidCode, isValidEmail, nextStep, normalizeCode } from './SignIn'

beforeEach(() => resetDb())

describe('isValidEmail', () => {
  it('accepts well-formed addresses (trimmed)', () => {
    expect(isValidEmail('you@example.com')).toBe(true)
    expect(isValidEmail('  a.b+tag@sub.domain.io ')).toBe(true)
  })
  it('rejects malformed ones', () => {
    for (const bad of ['', 'you', 'you@', '@example.com', 'you@example', 'a b@c.com']) {
      expect(isValidEmail(bad)).toBe(false)
    }
  })
})

describe('normalizeCode', () => {
  it('strips non-digits and caps at 6', () => {
    expect(normalizeCode('12ab34')).toBe('1234')
    expect(normalizeCode('123-456-789')).toBe('123456')
    expect(normalizeCode('')).toBe('')
  })
})

describe('isValidCode', () => {
  it('accepts exactly 6 digits', () => {
    expect(isValidCode('000000')).toBe(true)
    expect(isValidCode('123456')).toBe(true)
  })
  it('rejects anything else', () => {
    for (const bad of ['', '12345', '1234567', '12345a']) {
      expect(isValidCode(bad)).toBe(false)
    }
  })
})

describe('nextStep', () => {
  it('advances email → code only for a valid email', () => {
    expect(nextStep('email', 'you@example.com', '')).toBe('code')
    expect(nextStep('email', 'nope', '')).toBe('email')
  })
  it('advances code → done only for 6 digits', () => {
    expect(nextStep('code', 'you@example.com', '123456')).toBe('done')
    expect(nextStep('code', 'you@example.com', '123')).toBe('code')
  })
  it('stays done', () => {
    expect(nextStep('done', 'you@example.com', '123456')).toBe('done')
  })
})

const stubApi = {
  sendMagicCode: async () => {},
  signInWithMagicCode: async () => {},
}

describe('SignIn render', () => {
  it('renders the magic-code flow when a backend is configured (smoke)', () => {
    const html = renderToString(<SignIn authApi={stubApi} />)
    expect(html).toContain('Lift')
    expect(html).toContain('Magic code')
    expect(html).toContain('Send code')
    expect(html).toContain('you@example.com')
    expect(html).toContain('Cancel') // quiet back-to-Settings affordance
  })

  it('shows a sync-unavailable note (no dead flow) with no backend', () => {
    const html = renderToString(<SignIn />)
    expect(html).toContain('Sync unavailable')
    expect(html).toContain('Back to Settings')
    expect(html).not.toContain('Send code') // no fake-auth flow
  })
})

describe('friendlyAuthError', () => {
  it('maps record-not-found to actionable copy', () => {
    const msg = friendlyAuthError('Record not found: app-user-magic-code', 'fallback')
    expect(msg).toContain('no longer valid')
    expect(msg).toContain('newest email')
  })

  it('passes through other server messages and falls back when absent', () => {
    expect(friendlyAuthError('Too many attempts', 'fallback')).toBe('Too many attempts')
    expect(friendlyAuthError(null, 'fallback')).toBe('fallback')
  })
})

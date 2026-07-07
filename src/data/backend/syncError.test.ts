import { describe, expect, it } from 'vitest'
import { classifySyncError } from './syncError'

describe('classifySyncError', () => {
  it('offline wins over any message and hides details', () => {
    const v = classifySyncError('permission denied', false)
    expect(v.title).toBe('You look offline')
    expect(v.body).toMatch(/safe on this device/i)
    expect(v.details).toBeUndefined()
  })

  it('classifies a code crash (the owner TDZ bug) and keeps the raw details', () => {
    const v = classifySyncError(
      "Cannot access 'd' before initialization",
      true,
    )
    expect(v.title).toBe('The app hit a bug syncing')
    expect(v.body).toMatch(/safe on this device/i)
    expect(v.details).toBe("Cannot access 'd' before initialization")
  })

  it.each([
    'ReferenceError: x is not defined',
    'TypeError: undefined is not a function',
    'Cannot read properties of undefined',
  ])('treats %s as a code crash', (raw) => {
    expect(classifySyncError(raw, true).title).toBe('The app hit a bug syncing')
  })

  it('classifies a permission error', () => {
    const v = classifySyncError('permission denied', true)
    expect(v.title).toBe("Your account can't read this data")
    expect(v.details).toBe('permission denied')
    expect(v.body).toMatch(/permissions issue/i)
  })

  it('falls back to a generic, still-actionable message with details', () => {
    const v = classifySyncError('the first sync timed out', true)
    expect(v.title).toBe('Sync hit a problem')
    expect(v.details).toBe('the first sync timed out')
    expect(v.body).toMatch(/Retry/i)
  })

  it('generic message with no raw detail omits the Details line', () => {
    const v = classifySyncError(null, true)
    expect(v.title).toBe('Sync hit a problem')
    expect(v.details).toBeUndefined()
  })

  it('code-crash and permission both keep data-safe reassurance', () => {
    expect(classifySyncError('TypeError: boom', true).body).toMatch(/safe on this device/i)
    expect(classifySyncError('forbidden', true).body).toMatch(/safe on this device/i)
  })
})

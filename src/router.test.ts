import { describe, expect, it } from 'vitest'
import { parseRoute } from './router'

describe('parseRoute', () => {
  it('parses every route', () => {
    expect(parseRoute('#/')).toEqual({ name: 'home' })
    expect(parseRoute('#/signin')).toEqual({ name: 'signin' })
    expect(parseRoute('#/routines')).toEqual({ name: 'routines' })
    expect(parseRoute('#/routines/r-push-a')).toEqual({ name: 'routineEditor', id: 'r-push-a' })
    expect(parseRoute('#/run')).toEqual({ name: 'run' })
    expect(parseRoute('#/history')).toEqual({ name: 'history' })
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' })
  })

  it('treats an empty or missing hash as home', () => {
    expect(parseRoute('')).toEqual({ name: 'home' })
    expect(parseRoute('#')).toEqual({ name: 'home' })
  })

  it('decodes routine ids', () => {
    expect(parseRoute('#/routines/a%20b')).toEqual({ name: 'routineEditor', id: 'a b' })
  })

  it('falls back to home for unknown paths', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'home' })
    expect(parseRoute('#/routines/a/b')).toEqual({ name: 'home' })
  })
})

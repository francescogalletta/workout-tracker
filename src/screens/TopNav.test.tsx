import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Route } from '../router'
import { TopNav, activeNavKey, showTopNav } from './TopNav'

/**
 * TopNav: the persistent top navigation (owner decision). Verifies the four
 * destinations render, the active-route accent mapping (including the
 * routineEditor → Routines aliasing and run → Workout), and that the nav is
 * suppressed only on the focused Sign In flow.
 */

/** Label of the link carrying aria-current="page" in the SSR output, if any. */
function activeLabel(html: string): string | null {
  const m = html.match(/aria-current="page"[^>]*>([A-Za-z ]+)</)
  return m ? m[1] : null
}

describe('TopNav', () => {
  it('renders the wordmark and all five destinations', () => {
    const html = renderToString(<TopNav route="home" />)
    expect(html).toContain('Lift')
    for (const label of ['Workout', 'Routines', 'Exercises', 'History', 'Settings']) {
      expect(html).toContain(label)
    }
  })

  it('marks the active route with the accent colour and no other', () => {
    const html = renderToString(<TopNav route="home" />)
    expect(activeLabel(html)).toBe('Workout')
    expect(html).toContain('text-acc') // active link paints accent
    expect(html).toContain('text-mut') // inactive links stay muted
  })

  it('marks Routines active for both routines and routineEditor', () => {
    expect(activeLabel(renderToString(<TopNav route="routines" />))).toBe('Routines')
    expect(activeLabel(renderToString(<TopNav route="routineEditor" />))).toBe('Routines')
  })

  it('maps exercises, history and settings to their own links', () => {
    expect(activeLabel(renderToString(<TopNav route="exercises" />))).toBe('Exercises')
    expect(activeLabel(renderToString(<TopNav route="history" />))).toBe('History')
    expect(activeLabel(renderToString(<TopNav route="settings" />))).toBe('Settings')
  })
})

describe('activeNavKey', () => {
  it('aliases routineEditor onto Routines and run onto Workout; nulls sign in', () => {
    expect(activeNavKey('routineEditor')).toBe('routines')
    expect(activeNavKey('routines')).toBe('routines')
    expect(activeNavKey('exercises')).toBe('exercises')
    expect(activeNavKey('run')).toBe('home')
    expect(activeNavKey('signin')).toBeNull()
  })
})

describe('showTopNav', () => {
  it('hides the nav only on Sign In (kept visible during a workout)', () => {
    const hidden: Route['name'][] = ['signin']
    const shown: Route['name'][] = [
      'home',
      'run',
      'routines',
      'routineEditor',
      'exercises',
      'history',
      'settings',
    ]
    for (const r of hidden) expect(showTopNav(r)).toBe(false)
    for (const r of shown) expect(showTopNav(r)).toBe(true)
  })
})

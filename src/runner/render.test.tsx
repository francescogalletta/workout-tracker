import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { startSession } from '../data/mutations'
import { routineById } from '../data/queries'
import { ensureCatalog, seedDemoData } from '../data/seed'
import { getDb, resetDb } from '../data/store'
import { Runner } from './Runner'

// Smoke tests: whole trees render without throwing (effects and browser APIs
// excluded — those need a real browser). SSR always sees route "#/".

const T0 = 1_750_000_000_000

beforeEach(() => resetDb())

// No auth gate: App boots straight to Home on the local backend whether or not
// an email is mirrored. These assertions render App directly — no sign-in
// needed — exercising the real Home empty-state / demo-data paths.
describe('App render', () => {
  it('renders the Home empty state on a fresh store (no routines)', () => {
    ensureCatalog()
    const html = renderToString(<App />)
    expect(html).toContain('Lift')
    expect(html).toContain('No routines yet')
    expect(html).toContain('Create first routine')
    expect(html).not.toContain('Start workout') // no routines yet
  })

  it('renders Home (not Sign In) when signed out — the gate is gone', () => {
    ensureCatalog()
    const html = renderToString(<App />)
    expect(html).toContain('No routines yet')
    expect(html).toContain('Create first routine')
    expect(html).not.toContain('Magic code') // no sign-in gate
  })

  it('shows the rotation suggestion once demo data exists', () => {
    seedDemoData(T0)
    const html = renderToString(<App />)
    expect(html).toContain('Legs') // next in rotation after Pull A
    expect(html).toContain('Start workout')
  })

  it('overlays the resume-or-discard prompt when a session is active', () => {
    seedDemoData(T0)
    startSession(routineById(getDb(), 'r-push-a')!, Date.now())
    const html = renderToString(<App />)
    expect(html).toContain('Workout in progress')
    expect(html).toContain('Resume')
    expect(html).toContain('Discard')
    expect(html).toContain('Discarding keeps logged sets in history')
  })
})

describe('Runner render', () => {
  it('renders a session built from the store (engine output included)', () => {
    seedDemoData(T0)
    const session = startSession(routineById(getDb(), 'r-push-a')!, Date.now())
    const html = renderToString(<Runner session={session} onDone={() => {}} />)
    expect(html).toContain('Push A')
    expect(html).toContain('Warm-up') // hoisted warm-up section
    expect(html).toContain('Bench Press')
    expect(html).toContain('Incline DB Press')
    expect(html).toContain('Cable Fly')
    expect(html).toContain('Log warm-up') // pinned bar for the active warm-up
    expect(html).toContain('+ Add exercise')
    expect(html).toContain('+1 set') // per-exercise extra-set affordance
    expect(html).toContain('Finish workout') // in-flow finish button at the bottom
    expect(html).not.toContain('>Finish<') // the old header QuietLink is gone
  })
})

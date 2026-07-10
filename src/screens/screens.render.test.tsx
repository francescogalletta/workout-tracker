import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { ensureCatalog, seedDemoData } from '../data/seed'
import { getDb, resetDb } from '../data/store'
import { Exercises } from './Exercises'
import { Home } from './Home'
import { Routines } from './Routines'

// SSR smoke tests: trees render without throwing and show the right copy for
// the empty vs seeded store. Effects/DOM APIs are excluded (SSR).

const T0 = 1_750_000_000_000

beforeEach(() => resetDb())

describe('Home', () => {
  it('shows the first-run empty state with no routines', () => {
    ensureCatalog()
    const html = renderToString(<Home />)
    expect(html).toContain('Welcome')
    expect(html).toContain('No routines yet')
    expect(html).toContain('Create first routine')
    expect(html).not.toContain('Start workout')
  })

  it('suggests the next rotation routine and its preview when seeded', () => {
    seedDemoData(T0)
    const html = renderToString(<Home />)
    // Most recent completed is Pull A → next in rotation is Legs.
    expect(html).toContain('Legs')
    expect(html).toContain('Next in rotation')
    expect(html).toContain('Back Squat') // preview line 1
    expect(html).toContain('Start workout')
    expect(html).toContain('Change routine')
    expect(html).toContain('Last · Pull A') // last completed session line
  })
})

describe('Routines', () => {
  it('shows the first-run empty state with no routines', () => {
    ensureCatalog()
    const html = renderToString(<Routines />)
    expect(html).toContain('No routines yet')
    expect(html).toContain('Create first routine')
    expect(html).not.toContain('Rotation · repeats in this order')
  })

  it('lists rotation and non-rotation sections when seeded', () => {
    seedDemoData(T0)
    const html = renderToString(<Routines />)
    expect(html).toContain('Rotation · repeats in this order')
    expect(html).toContain('Not in rotation · start any time')
    expect(html).toContain('Push A')
    expect(html).toContain('Arms') // non-rotation routine
    expect(html).toContain('up next') // the next-in-rotation routine's sub line
    expect(html).toContain('+ New routine')
  })

  it('marks exactly the next-in-rotation routine as up next', () => {
    seedDemoData(T0)
    const html = renderToString(<Routines />)
    // Only one "up next ·" prefix across the whole list.
    const count = html.split('up next ·').length - 1
    expect(count).toBe(1)
    // Sanity: the store really has non-rotation routines to render.
    expect(getDb().routines.some((r) => r.cycleOrder === null)).toBe(true)
  })
})

describe('Exercises', () => {
  it('lists the catalog with a create affordance and per-row actions', () => {
    ensureCatalog()
    const html = renderToString(<Exercises />)
    expect(html).toContain('Exercises')
    expect(html).toContain('Search exercises')
    expect(html).toContain('type="search"') // native search keyboard on mobile
    expect(html).toContain('+ Create custom exercise')
    // Gesture hint replaces the old per-row rename/delete icon buttons.
    expect(html).toContain('Tap to rename · hold to select')
    expect(html).not.toContain('aria-label="Rename"')
    expect(html).not.toContain('aria-label="Delete"')
    // A known seed exercise renders.
    expect(html.toLowerCase()).toContain('bench press')
  })
})

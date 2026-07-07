import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncConflictPrompt } from './App'
import { emptyDb, type Db } from './data/types'
import type { Backend } from './data/backend/backend'

/**
 * Sign-in adoption conflict modal. A direct render of the component pins its
 * copy + affordances; a store-driven render proves Shell surfaces it from a
 * forced pending-conflict state.
 */

describe('SyncConflictPrompt (component)', () => {
  it('renders the warning, remote counts, and both choices', () => {
    const html = renderToString(
      <SyncConflictPrompt counts={{ routines: 3, workouts: 12 }} onAdopt={() => {}} onCancel={() => {}} />,
    )
    // React SSR splits text/interpolation with <!-- --> markers, so assert pieces.
    expect(html).toContain('Account data found')
    expect(html).toContain('This account has')
    expect(html).toContain('3 routines')
    expect(html).toContain('12 workouts')
    expect(html).toContain('Syncing replaces the data on this device')
    expect(html).toContain('Use account data')
    expect(html).toContain('Cancel')
  })

  it('singularizes a single routine / workout', () => {
    const html = renderToString(
      <SyncConflictPrompt counts={{ routines: 1, workouts: 1 }} onAdopt={() => {}} onCancel={() => {}} />,
    )
    expect(html).toContain('1 routine')
    expect(html).toContain('1 workout')
    expect(html).not.toContain('1 routines')
    expect(html).not.toContain('1 workouts')
  })
})

function fakeBackend(initial: Db): Backend {
  let snap = initial
  return {
    getDb: () => snap,
    update(fn) {
      snap = fn(snap)
    },
    reset() {
      snap = emptyDb()
    },
    set(next) {
      snap = next
    },
    signOut() {},
  }
}

function routine(id: string, name: string): Db['routines'][number] {
  return { id, name, defaultRestSec: 90, cycleOrder: null, warmup: false, archived: false }
}

describe('Shell renders the conflict modal from a forced pending-conflict state', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', undefined)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('surfaces the modal when the store has a pending conflict', async () => {
    const store = await import('./data/store')
    const { Shell } = await import('./App')
    store.update((db) => ({ ...db, routines: [routine('r-local', 'Local')] }))
    const inst = fakeBackend(emptyDb())
    store.__enableSyncForTest(
      inst,
      { ...emptyDb(), routines: [routine('r-remote', 'Remote'), routine('r2', 'Pull')] },
      'me@x.com',
    )
    expect(store.getSyncConflict()).not.toBeNull()

    const html = renderToString(<Shell />)
    expect(html).toContain('Account data found')
    expect(html).toContain('2 routines')
    expect(html).toContain('0 workouts')
  })
})

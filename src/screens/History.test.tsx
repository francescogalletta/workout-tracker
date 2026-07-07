import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeTargetFor, exerciseById } from '../data/queries'
import { ensureCatalog, seedDemoData } from '../data/seed'
import { getDb, resetDb, update } from '../data/store'
import {
  History,
  TARGET_WEEKS,
  buildInsightTarget,
  exerciseSummaryLine,
  filterDisplayLabel,
  fmtCardio,
  fmtDuration,
  fmtSessionDate,
  logExercises,
  logGroups,
  targetNote,
  targetWeeksLeft,
  toggleFilter,
} from './History'
import type { Session } from '../data/types'

const T0 = 1_750_000_000_000
const DAY = 24 * 3600 * 1000
const WEEK = 7 * DAY

beforeEach(() => resetDb())

describe('fmtSessionDate / fmtDuration', () => {
  it('formats a timestamp as weekday + month + day', () => {
    // T0 = 2025-06-15T14:13:20Z (a Sunday, UTC)
    expect(fmtSessionDate(T0)).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/)
  })

  it('renders finished-session minutes and an active fallback', () => {
    const base: Session = {
      id: 's',
      routineId: 'r',
      routineName: 'Push A',
      status: 'completed',
      startedAt: T0,
      finishedAt: T0 + 58 * 60_000,
    }
    expect(fmtDuration(base)).toBe('58 min')
    expect(fmtDuration({ ...base, status: 'active', finishedAt: null })).toBe('in progress')
  })
})

describe('fmtCardio', () => {
  it('formats a cardio set from values + metric defs', () => {
    ensureCatalog()
    const erg = exerciseById(getDb(), 'row-erg')!
    expect(fmtCardio(erg, { time: 600, res: 5, pace: 125 })).toBe('10:00 · lvl 5 · 2:05 /500m')
  })

  it('returns empty for a non-cardio or null values', () => {
    expect(fmtCardio(null, { time: 60 })).toBe('')
    ensureCatalog()
    const bench = exerciseById(getDb(), 'bench-press')!
    expect(fmtCardio(bench, null)).toBe('')
  })
})

describe('toggleFilter (filter building)', () => {
  it('sets a new filter, and clears it when the same value is re-picked', () => {
    const g = { type: 'group' as const, value: 'chest' }
    expect(toggleFilter(null, g)).toEqual(g)
    expect(toggleFilter(g, g)).toBeNull()
    const e = { type: 'exercise' as const, value: 'bench-press' }
    expect(toggleFilter(g, e)).toEqual(e) // switching type keeps the new one
    expect(toggleFilter(null, null)).toBeNull()
  })
})

describe('filterDisplayLabel / logExercises / logGroups', () => {
  beforeEach(() => seedDemoData(T0))

  it('labels the filter control by name', () => {
    const db = getDb()
    expect(filterDisplayLabel(db, null)).toBe('All exercises')
    expect(filterDisplayLabel(db, { type: 'group', value: 'chest' })).toBe('chest')
    expect(filterDisplayLabel(db, { type: 'exercise', value: 'bench-press' })).toBe('Bench Press')
  })

  it('lists logged strength exercises with a per-exercise session count', () => {
    const exs = logExercises(getDb())
    const bench = exs.find((e) => e.id === 'bench-press')!
    expect(bench).toMatchObject({ name: 'Bench Press', group: 'chest', sessions: 3 })
    // sorted by name and cardio-free
    expect(exs.some((e) => e.id === 'row-erg')).toBe(false)
    expect([...exs].map((e) => e.name)).toEqual(exs.map((e) => e.name).slice().sort())
  })

  it('lists present groups in canonical order', () => {
    const groups = logGroups(getDb())
    expect(groups[0]).toBe('chest')
    expect(groups).not.toContain('cardio')
    // canonical order among those present
    const order = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']
    const idx = groups.map((g) => order.indexOf(g))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
  })
})

describe('exerciseSummaryLine', () => {
  beforeEach(() => seedDemoData(T0))

  it('reports session count and first → latest max working weight', () => {
    // Bench: 3 Push A sessions, 60 kg oldest → 62.5 kg latest.
    expect(exerciseSummaryLine(getDb(), 'bench-press')).toBe('3 sessions · 60 → 62.5 kg')
  })

  it('is null for an exercise with no log', () => {
    expect(exerciseSummaryLine(getDb(), 'front-squat')).toBeNull()
  })
})

describe('target accept / remove / expiry math', () => {
  it('builds a target 4 weeks out with the accepted weight', () => {
    const t = buildInsightTarget('bench-press', 65, T0, '8 @ RIR 2')
    expect(t).toMatchObject({ exerciseId: 'bench-press', weightKg: 65, note: '8 @ RIR 2', createdAt: T0 })
    expect(t.expiresAt).toBe(T0 + TARGET_WEEKS * WEEK)
  })

  it('counts whole weeks left and expires exactly on schedule', () => {
    const t = buildInsightTarget('bench-press', 65, T0)
    expect(targetWeeksLeft(t.expiresAt, T0)).toBe(4)
    expect(targetWeeksLeft(t.expiresAt, T0 + 7 * DAY)).toBe(3)
    expect(targetWeeksLeft(t.expiresAt, t.expiresAt)).toBe(0)
    // activeTargetFor drops it once now reaches expiry
    resetDb()
    ensureCatalog()
    update((d) => ({ ...d, targets: [t] }))
    expect(activeTargetFor(getDb(), 'bench-press', T0 + 3 * WEEK)).not.toBeNull()
    expect(activeTargetFor(getDb(), 'bench-press', t.expiresAt)).toBeNull()
  })

  it('derives the note from the active routine item', () => {
    seedDemoData(T0)
    expect(targetNote(getDb(), 'bench-press')).toBe('8 @ RIR 2')
    expect(targetNote(getDb(), 'front-squat')).toBe('')
  })
})

describe('History render smoke — Log tab', () => {
  it('renders session cards with routines, exercises and set values', () => {
    seedDemoData(T0)
    const html = renderToString(<History now={T0} />)
    expect(html).toContain('History')
    expect(html).toContain('Push A')
    expect(html).toContain('Bench Press')
    expect(html).toContain('62.5') // a logged working weight
    expect(html).toContain('Working sets only · warm-ups excluded · most recent first')
    // cardio session renders a one-line metric summary, not a kg table row
    expect(html).toContain('lvl')
  })

  it('shows the empty state on a fresh store', () => {
    ensureCatalog()
    const html = renderToString(<History now={T0} />)
    expect(html).toContain('No workouts yet')
  })
})

describe('History render smoke — Insights · Plan tab', () => {
  it('renders window chips, suggestions, active targets and muscle balance', () => {
    seedDemoData(T0)
    const html = renderToString(<History now={T0} initialView="insights" />)
    expect(html).toContain('Plan · Build strength')
    expect(html).toContain('Suggested adjustments')
    expect(html).toContain('Muscle balance')
    // demo seeds an active bench target → shown in Active targets, excluded from suggestions
    expect(html).toContain('Bench Press')
    expect(html).toContain('wk left')
    // a plateaued lift is suggested for lowering
    expect(html).toContain('Lateral Raise')
    expect(html).toContain('Set target ·')
  })

  it('shows the empty state on a fresh store', () => {
    ensureCatalog()
    const html = renderToString(<History now={T0} initialView="insights" />)
    expect(html).toContain('Nothing to plan yet')
  })
})

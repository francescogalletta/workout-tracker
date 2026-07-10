import { beforeEach, describe, expect, it } from 'vitest'
import { createExercise, deleteExercise, deleteExercises, renameExercise } from './mutations'
import { exerciseById, routinesUsingExercise } from './queries'
import { seedDemoData } from './seed'
import { getDb, resetDb } from './store'

/**
 * Exercise-library management (rename + delete) used by the Exercises screen.
 * Verifies the safety guarantees: rename never touches logged-set name
 * snapshots, and delete cascades to routine items while preserving history.
 */

const T0 = 1_750_000_000_000

beforeEach(() => {
  resetDb()
  seedDemoData(T0)
})

describe('renameExercise', () => {
  it('renames the catalog row, trimming and capping at 40 chars', () => {
    const ex = createExercise({ name: 'Temp', type: 'weight' })
    renameExercise(ex.id, `  ${'x'.repeat(60)}  `)
    const after = exerciseById(getDb(), ex.id)!
    expect(after.name).toBe('x'.repeat(40))
  })

  it('ignores a blank name (no-op)', () => {
    const ex = createExercise({ name: 'Keep Me', type: 'weight' })
    renameExercise(ex.id, '   ')
    expect(exerciseById(getDb(), ex.id)!.name).toBe('Keep Me')
  })

  it('leaves logged-set name snapshots untouched (history reads as performed)', () => {
    const log = getDb().setLogs[0]
    expect(log).toBeTruthy()
    const original = log.exerciseName
    renameExercise(log.exerciseId, 'Totally Different Name')
    const sameLog = getDb().setLogs.find((l) => l.id === log.id)!
    expect(sameLog.exerciseName).toBe(original)
    expect(exerciseById(getDb(), log.exerciseId)!.name).toBe('Totally Different Name')
  })
})

describe('routinesUsingExercise + deleteExercise', () => {
  it('reports and then cascade-removes referencing routine items, keeping history', () => {
    const usedId = getDb().routineItems[0].exerciseId
    expect(routinesUsingExercise(getDb(), usedId).length).toBeGreaterThan(0)

    const logsBefore = getDb().setLogs.filter((l) => l.exerciseId === usedId).length

    deleteExercise(usedId)

    const db = getDb()
    expect(exerciseById(db, usedId)).toBeNull()
    expect(db.routineItems.some((it) => it.exerciseId === usedId)).toBe(false)
    // Logged history is preserved — setLogs keep their own name snapshot.
    expect(db.setLogs.filter((l) => l.exerciseId === usedId).length).toBe(logsBefore)
  })

  it('reports zero routines for a freshly created, unused exercise', () => {
    const ex = createExercise({ name: 'Nobody Uses This', type: 'reps' })
    expect(routinesUsingExercise(getDb(), ex.id)).toEqual([])
    deleteExercise(ex.id)
    expect(exerciseById(getDb(), ex.id)).toBeNull()
  })
})

describe('deleteExercises (group delete)', () => {
  it('removes every id and cascades routine items in one shot, keeping history', () => {
    const ids = [...new Set(getDb().routineItems.map((it) => it.exerciseId))].slice(0, 2)
    expect(ids).toHaveLength(2)
    const logsBefore = getDb().setLogs.length

    deleteExercises(ids)

    const db = getDb()
    for (const id of ids) {
      expect(exerciseById(db, id)).toBeNull()
      expect(db.routineItems.some((it) => it.exerciseId === id)).toBe(false)
    }
    expect(db.setLogs.length).toBe(logsBefore)
  })

  it('is a no-op for an empty selection', () => {
    const before = getDb()
    deleteExercises([])
    expect(getDb()).toBe(before)
  })
})

import { describe, expect, it } from 'vitest'
import { approach, tiltFromOrientation, tiltFromPointer, tiltTransform } from './useTilt'

describe('tiltFromOrientation', () => {
  it('is neutral at the resting pose (no roll, ~45° pitch)', () => {
    expect(tiltFromOrientation(0, 45)).toEqual({ x: 0, y: 0 })
  })

  it('maps roll to x and pitch (from rest) to y', () => {
    const { x, y } = tiltFromOrientation(35, 45 + 35)
    expect(x).toBeCloseTo(1)
    expect(y).toBeCloseTo(1)
  })

  it('clamps beyond the tilt range to [-1, 1]', () => {
    const { x, y } = tiltFromOrientation(-200, -200)
    expect(x).toBe(-1)
    expect(y).toBe(-1)
  })
})

describe('tiltFromPointer', () => {
  it('is neutral at the viewport centre', () => {
    expect(tiltFromPointer(200, 400, 400, 800)).toEqual({ x: 0, y: 0 })
  })

  it('reaches the corners at [±1, ±1]', () => {
    expect(tiltFromPointer(400, 800, 400, 800)).toEqual({ x: 1, y: 1 })
    expect(tiltFromPointer(0, 0, 400, 800)).toEqual({ x: -1, y: -1 })
  })

  it('guards against a zero-sized viewport', () => {
    expect(tiltFromPointer(10, 10, 0, 0)).toEqual({ x: 0, y: 0 })
  })
})

describe('tiltTransform', () => {
  it('is the identity-ish transform at neutral', () => {
    expect(tiltTransform(0, 0)).toBe(
      'perspective(700px) rotateX(0.00deg) rotateY(0.00deg) translate3d(0.00px, 0.00px, 0)',
    )
  })

  it('counter-shifts the card against the tilt direction', () => {
    // Positive x (tilt right) → card translates left (negative tx).
    expect(tiltTransform(1, 0, 6, 2.5)).toContain('translate3d(-6.00px, 0.00px, 0)')
    expect(tiltTransform(1, 0, 6, 2.5)).toContain('rotateY(2.50deg)')
  })
})

describe('approach', () => {
  it('moves a fraction of the way toward the target', () => {
    expect(approach(0, 10, 0.1)).toBeCloseTo(1)
  })

  it('converges to the target after enough steps', () => {
    let v = 0
    for (let i = 0; i < 200; i++) v = approach(v, 1)
    expect(v).toBeCloseTo(1)
  })
})

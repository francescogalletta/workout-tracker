/**
 * Pure logic for the shared rest slider (30s–3min). Coarse 30s detents by
 * default; sliding slowly or press-holding before moving switches to fine 5s
 * increments. Kept DOM-free so snapping/mapping is unit-testable.
 */

export const REST_MIN = 30
export const REST_MAX = 180
export const REST_COARSE_STEP = 30
export const REST_FINE_STEP = 5

/** Drag slower than this (px/ms) counts as a deliberate fine adjustment. */
export const FINE_VELOCITY_PX_MS = 0.25
/** Press-holding this long before moving also enters fine mode. */
export const FINE_HOLD_MS = 400

export function clampRest(sec: number): number {
  return Math.max(REST_MIN, Math.min(REST_MAX, sec))
}

/** Clamp to range and snap to the active step (30s coarse, 5s fine). */
export function snapRest(rawSec: number, fine: boolean): number {
  const step = fine ? REST_FINE_STEP : REST_COARSE_STEP
  return clampRest(Math.round(clampRest(rawSec) / step) * step)
}

/** Linear px→seconds over the track width (0 → REST_MIN, width → REST_MAX). */
export function posToSec(px: number, trackWidth: number): number {
  if (trackWidth <= 0) return REST_MIN
  const frac = Math.max(0, Math.min(1, px / trackWidth))
  return REST_MIN + frac * (REST_MAX - REST_MIN)
}

/** Seconds → 0..1 fraction along the track (clamped for legacy out-of-range values). */
export function secToFrac(sec: number): number {
  return (clampRest(sec) - REST_MIN) / (REST_MAX - REST_MIN)
}

/** Fine mode: press-held before moving, or currently dragging slowly. */
export function isFineDrag(velocityPxPerMs: number, heldBeforeMoveMs: number): boolean {
  return heldBeforeMoveMs >= FINE_HOLD_MS || Math.abs(velocityPxPerMs) <= FINE_VELOCITY_PX_MS
}

/** The coarse detent seconds (tick marks): 30, 60, …, 180. */
export const REST_TICKS: number[] = Array.from(
  { length: (REST_MAX - REST_MIN) / REST_COARSE_STEP + 1 },
  (_, i) => REST_MIN + i * REST_COARSE_STEP,
)

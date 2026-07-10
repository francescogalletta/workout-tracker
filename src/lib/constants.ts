/**
 * Cross-module shared constants (single source of truth), plus the tiny pure
 * helpers that operate directly on them. Kept dependency-free so any layer
 * (engine, data, runner, screens) can import it without a cycle.
 */

/** Milliseconds in one week (7 days). */
export const WEEK_MS = 7 * 24 * 3600 * 1000

/**
 * Canonical muscle-group display order; unknown groups sort last (alphabetical).
 * Shared by the engine's balance rows and the Insights screen's grouping.
 */
export const GROUP_ORDER = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']

/** Whole weeks until a target expires (0 once past). */
export function targetWeeksLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / WEEK_MS))
}

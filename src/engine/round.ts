/**
 * Round a weight to the nearest multiple of `incrementKg`.
 * Exact halves round DOWN (toward the lighter plate): 31.25 @ 2.5 → 30,
 * matching the spec's warm-up example (50% of 62.5 → 30 kg).
 */
export function roundToIncrement(weightKg: number, incrementKg: number): number {
  if (incrementKg <= 0) return weightKg
  const q = weightKg / incrementKg
  const base = Math.floor(q)
  const frac = q - base
  const n = frac > 0.5 + 1e-9 ? base + 1 : base
  return Math.round(n * incrementKg * 10000) / 10000
}

/** Number for copy: up to 2 decimals, no trailing zeros ("62.5", "1.25", "5"). */
export function fmtKg(v: number): string {
  return String(Math.round(v * 100) / 100)
}

import type { Metric } from '../runner/types'

/** m:ss from milliseconds, floored at 0. */
export function fmtClock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

/** Weight for display: null → em dash, else rounded to 0.1. */
export function fmtW(w: number | null): string {
  return w === null ? '—' : String(Math.round(w * 10) / 10)
}

/** Step value without trailing zeros (2.5, 1.25, 5). */
export function fmtStep(v: number): string {
  return String(Math.round(v * 100) / 100)
}

/** One cardio metric value, optionally without pre/post decoration. */
export function fmtMetric(d: Metric, v: number, bare = false): string {
  const s = d.fmt === 'clock' ? fmtClock(v * 1000) : String(Math.round(v * 10) / 10)
  return bare ? s : `${d.pre ?? ''}${s}${d.post ?? ''}`
}

/** All metric values of a cardio set joined for a one-line row. */
export function fmtMetricLine(metrics: Metric[], values: Record<string, number>): string {
  return metrics.map((d) => fmtMetric(d, values[d.key])).join(' · ')
}

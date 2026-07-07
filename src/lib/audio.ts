/**
 * Synthesized rest-timer cues (SPEC §5.2). iOS requires a user gesture before
 * audio can start, so ensure() must be called from a tap handler.
 */
let ctx: AudioContext | null = null

export function ensureAudio(): void {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // no audio available; cues silently disabled
  }
}

export function beep(freq: number, durSec: number, vol: number): void {
  if (!ctx) return
  try {
    const t0 = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'square'
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec)
    o.connect(g)
    g.connect(ctx.destination)
    o.start(t0)
    o.stop(t0 + durSec + 0.02)
  } catch {
    // ignore
  }
}

/** Click for each of the final 5 seconds. */
export function restClick(): void {
  beep(1100, 0.04, 0.25)
}

/** Distinct tone at zero. */
export function restDone(): void {
  beep(1650, 0.3, 0.3)
}

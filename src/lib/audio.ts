/**
 * Synthesized rest-timer cues (SPEC §5.2). iOS requires a user gesture before
 * audio can start, so ensure() must be called from a tap handler. Note that on
 * iPhone the ring/silent hardware switch mutes Web Audio entirely — Settings
 * surfaces that (isIOS) since it looks exactly like "sound doesn't work".
 */
let ctx: AudioContext | null = null

/**
 * Get a usable context, self-healing: recreate a closed one, resume a
 * suspended/interrupted one (iOS suspends on backgrounding and after route
 * changes like unplugging headphones).
 */
function ensureCtx(): AudioContext | null {
  try {
    if (!ctx || ctx.state === 'closed') ctx = new AudioContext()
    if (ctx.state !== 'running') void ctx.resume()
    return ctx
  } catch {
    return null // no audio available; cues silently disabled
  }
}

export function ensureAudio(): void {
  ensureCtx()
}

export function beep(freq: number, durSec: number, vol: number, delaySec = 0): void {
  const c = ensureCtx()
  if (!c) return
  try {
    const t0 = c.currentTime + delaySec
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'square'
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec)
    o.connect(g)
    g.connect(c.destination)
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

/** What toggling the setting on sounds like: one click, then the zero tone. */
export function previewCue(): void {
  beep(1100, 0.04, 0.25)
  beep(1650, 0.3, 0.3, 0.35)
}

/** Render-safe iOS detection (iPadOS ≥13 reports as MacIntel + touch). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

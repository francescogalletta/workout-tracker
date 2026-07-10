import { useEffect, type RefObject } from 'react'

/**
 * Subtle device-tilt parallax for the active workout card — the same "letters
 * shift as you move the phone" feel the Home wordmark gets from the OS, but
 * driven by the real motion sensor so it works inside the app. Applied only to
 * whichever card is the *active* set in the Runner (owner request).
 *
 * Pointer movement is wired up too so the effect is visible (and verifiable)
 * on desktop, where there is no orientation sensor. Respects
 * prefers-reduced-motion: when set, nothing is attached and the card stays put.
 *
 * The maths (orientation/pointer → a normalized [-1, 1] offset, and that offset
 * → a CSS transform) are pulled out as pure functions so they can be unit
 * tested without a device.
 */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Neutral device pose: phone held tilted ~45° toward you (typical reading angle). */
const REST_BETA = 45
/** Degrees of tilt that map to the full offset range. */
const TILT_RANGE = 35

/**
 * DeviceOrientation angles → normalized offset in [-1, 1].
 * `gamma` is left/right roll [-90, 90], `beta` is front/back pitch [-180, 180].
 * `y` is measured from the resting pose so a phone at rest sits near 0.
 */
export function tiltFromOrientation(gamma: number, beta: number): { x: number; y: number } {
  return {
    x: clamp(gamma / TILT_RANGE, -1, 1),
    y: clamp((beta - REST_BETA) / TILT_RANGE, -1, 1),
  }
}

/** Pointer position → normalized offset in [-1, 1] relative to the viewport centre. */
export function tiltFromPointer(
  px: number,
  py: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const cx = width / 2
  const cy = height / 2
  if (cx === 0 || cy === 0) return { x: 0, y: 0 }
  return { x: clamp((px - cx) / cx, -1, 1), y: clamp((py - cy) / cy, -1, 1) }
}

/**
 * Normalized offset → CSS transform. The card counter-shifts a few pixels and
 * tips a couple of degrees in 3D, so it reads as a light physical object that
 * lags behind the phone's motion.
 */
export function tiltTransform(x: number, y: number, maxPx = 10, maxDeg = 4): string {
  const tx = (-x * maxPx).toFixed(2)
  const ty = (-y * maxPx).toFixed(2)
  const ry = (x * maxDeg).toFixed(2)
  const rx = (-y * maxDeg).toFixed(2)
  return `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) translate3d(${tx}px, ${ty}px, 0)`
}

/** One exponential-smoothing step toward `target` (0 < factor ≤ 1). */
export function approach(current: number, target: number, factor = 0.15): number {
  return current + (target - current) * factor
}

export interface TiltOptions {
  /** Max counter-shift in px. */
  maxPx?: number
  /** Max 3D tip in degrees. */
  maxDeg?: number
  /** Smoothing factor per frame (0 < factor ≤ 1). */
  factor?: number
}

export function useTilt<T extends HTMLElement>(
  elRef: RefObject<T | null>,
  { maxPx = 10, maxDeg = 4, factor = 0.15 }: TiltOptions = {},
): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const target = { x: 0, y: 0 }
    const cur = { x: 0, y: 0 }
    let raf = 0

    const onOrient = (e: DeviceOrientationEvent) => {
      const t = tiltFromOrientation(e.gamma ?? 0, e.beta ?? REST_BETA)
      target.x = t.x
      target.y = t.y
    }
    const onPointer = (e: PointerEvent) => {
      const t = tiltFromPointer(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
      target.x = t.x
      target.y = t.y
    }

    const loop = () => {
      cur.x = approach(cur.x, target.x, factor)
      cur.y = approach(cur.y, target.y, factor)
      const el = elRef.current
      if (el) {
        el.style.transform = tiltTransform(cur.x, cur.y, maxPx, maxDeg)
        el.style.willChange = 'transform'
      }
      raf = requestAnimationFrame(loop)
    }

    // iOS 13+ gates the sensor behind an explicit permission request that must
    // run from a user gesture. Ask on the first tap; until then (and on
    // desktop) the pointer fallback drives the effect.
    const DOE = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> })
      | undefined
    const needsGesture = typeof DOE?.requestPermission === 'function'

    const addOrient = () => window.addEventListener('deviceorientation', onOrient)
    const requestOnGesture = () => {
      DOE?.requestPermission?.()
        .then((state) => {
          if (state === 'granted') addOrient()
        })
        .catch(() => {})
    }

    if (needsGesture) {
      window.addEventListener('pointerdown', requestOnGesture, { once: true })
    } else {
      addOrient()
    }
    window.addEventListener('pointermove', onPointer)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('deviceorientation', onOrient)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', requestOnGesture)
      const el = elRef.current
      if (el) {
        el.style.transform = ''
        el.style.willChange = ''
      }
    }
  }, [elRef, maxPx, maxDeg, factor])
}

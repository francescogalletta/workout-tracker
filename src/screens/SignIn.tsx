import { useState } from 'react'
import type { AuthApi } from '../auth'
import { updateSettings } from '../data/mutations'
import { navigate } from '../router'

/**
 * Sign In — recreated from design/prototypes/Sign In.dc.html.
 *
 * Reached ONLY from Settings → "Sign in to sync" (never a gate). Its sole
 * purpose is to enable cloud sync; the app is fully usable signed out.
 *
 * With an `authApi` (instant build) it drives the real magic-code flow in three
 * steps, instant transitions, no spinners: email → 6-digit code → "Ready."
 * confirmation. `sendMagicCode` fires on the email step and switches instantly;
 * `signInWithMagicCode` verifies on the code step and only advances on success
 * (a wrong code surfaces a quiet inline message, no spinner). The InstantDB
 * session is live at the "Ready." step and `store.enableSync` has already begun
 * the merge-up; Continue mirrors the email into settings and returns to
 * Settings.
 *
 * Without an `authApi` (no app id configured) there is no backend to sign into,
 * so the screen shows a quiet "sync unavailable" note + a way back to Settings
 * rather than a dead fake-auth flow.
 */

export type SignInStep = 'email' | 'code' | 'done'

/** Well-formed-enough email for the auth gate. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/** Strip to digits, cap at 6 (mirrors the code input's onChange). */
export function normalizeCode(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(0, 6)
}

/** Any 6 digits are accepted (fake auth); instant verifies server-side. */
export function isValidCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

/**
 * Pure step machine used by the component and the tests. Returns the next step
 * (or the current one if the action is not allowed yet), so gating logic is
 * testable without a DOM.
 */
export function nextStep(step: SignInStep, email: string, code: string): SignInStep {
  if (step === 'email') return isValidEmail(email) ? 'code' : 'email'
  if (step === 'code') return isValidCode(code) ? 'done' : 'code'
  return 'done'
}

/** Pull a human message out of an InstantDB auth error (`err.body.message`). */
function errMessage(err: unknown): string | null {
  const body = (err as { body?: { message?: unknown } })?.body
  return typeof body?.message === 'string' ? body.message : null
}

const eyebrow = 'text-[11px] tracking-[0.18em] text-mut uppercase'
const accentBtn =
  'tt-label flex h-[68px] w-full cursor-pointer items-center justify-center rounded-rl border-0 bg-acc text-[16px] font-extrabold tracking-[0.08em] text-onacc'

export function SignIn({ authApi }: { authApi?: AuthApi } = {}) {
  // No backend configured → nothing to sign into. Show a quiet note + back.
  if (!authApi) return <SyncUnavailable />
  return <SignInFlow authApi={authApi} />
}

/** Shown when the route is reached with no app id configured. */
function SyncUnavailable() {
  return (
    <div
      className="flex min-h-screen justify-center bg-bg"
      style={{ fontFamily: 'var(--f, "JetBrains Mono", monospace)' }}
    >
      <div className="box-border flex min-h-screen w-full max-w-[430px] flex-col pt-[calc(var(--safe-top)+24px)] pr-[max(20px,var(--safe-right))] pb-[calc(var(--safe-bottom)+28px)] pl-[max(20px,var(--safe-left))]">
        <div className="text-[12px] font-bold tracking-[0.24em] text-dim uppercase">Lift</div>
        <div className="flex flex-1 flex-col justify-center gap-[14px]">
          <div className={eyebrow}>Sync unavailable</div>
          <div className="tt-label text-[28px] leading-[1.2] font-extrabold tracking-[0.02em] text-tx">
            No backend
            <br />
            configured
          </div>
          <div className="text-[11px] leading-[1.7] text-dim">
            Your data lives on this device and the app works fully offline. Cloud
            sync needs an InstantDB app id, which this build was compiled without.
          </div>
        </div>
        <button type="button" onClick={() => navigate('/settings')} className={accentBtn}>
          Back to Settings
        </button>
      </div>
    </div>
  )
}

function SignInFlow({ authApi }: { authApi: AuthApi }) {
  const [step, setStep] = useState<SignInStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function sendCode() {
    if (!isValidEmail(email)) return
    setError(null)
    // Switch instantly (no spinner); magic code sends in the background.
    setStep('code')
    authApi.sendMagicCode(email.trim()).catch((err: unknown) => {
      setStep('email')
      setError(errMessage(err) ?? "Couldn't send a code to that address.")
    })
  }

  function signIn() {
    if (!isValidCode(code)) return
    // Verify server-side; only advance on success.
    setError(null)
    authApi
      .signInWithMagicCode(email.trim(), code)
      .then(() => setStep('done'))
      .catch((err: unknown) => {
        setCode('')
        setError(errMessage(err) ?? "That code didn't work — try again.")
      })
  }

  function backToEmail() {
    setCode('')
    setError(null)
    setStep('email')
  }

  function complete() {
    // Mirror the email into settings (Settings shows it) and return to Settings.
    // The session is already live and `enableSync` has started the merge-up.
    updateSettings({ email: email.trim() })
    navigate('/settings')
  }

  return (
    <div
      className="flex min-h-screen justify-center bg-bg"
      style={{ fontFamily: 'var(--f, "JetBrains Mono", monospace)' }}
    >
      <div className="box-border flex min-h-screen w-full max-w-[430px] flex-col pt-[calc(var(--safe-top)+24px)] pr-[max(20px,var(--safe-right))] pb-[calc(var(--safe-bottom)+28px)] pl-[max(20px,var(--safe-left))]">
        <div className="flex items-baseline justify-between">
          <div className="text-[12px] font-bold tracking-[0.24em] text-dim uppercase">Lift</div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="tt-label cursor-pointer border-0 bg-transparent text-[12px] tracking-[0.08em] text-mut underline underline-offset-[3px]"
          >
            Cancel
          </button>
        </div>

        {step === 'email' && (
          <>
            <div className="flex flex-1 flex-col justify-center gap-[14px]">
              <div className={eyebrow}>Sign in</div>
              <div className="tt-label text-[32px] leading-[1.15] font-extrabold tracking-[0.02em] text-tx">
                Magic code,
                <br />
                no password
              </div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                onKeyDown={(e) => e.key === 'Enter' && sendCode()}
                style={{ fontFamily: 'inherit' }}
                className="mt-[10px] box-border h-14 w-full rounded-rs border border-stepbd bg-stepbg px-4 text-[15px] text-tx outline-none"
              />
              {error ? (
                <div className="text-[11px] leading-[1.6] text-acc">{error}</div>
              ) : (
                <div className="text-[11px] leading-[1.7] text-dim">
                  We'll email a one-time code. Sign in once per device — after that the app opens
                  straight to your workout, online or off.
                </div>
              )}
            </div>
            <button type="button" onClick={sendCode} className={accentBtn}>
              Send code
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <div className="flex flex-1 flex-col justify-center gap-[14px]">
              <div className={eyebrow}>Enter code</div>
              <div className="text-[12px] tracking-[0.03em] text-sec">
                Sent to {email || 'you@example.com'}
              </div>
              <input
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
                inputMode="numeric"
                maxLength={6}
                placeholder="······"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
                style={{ fontFamily: 'inherit' }}
                className={`mt-[10px] box-border h-[72px] w-full rounded-rs border bg-stepbg px-4 text-center text-[34px] font-extrabold tracking-[0.4em] text-tx tabular-nums outline-none ${
                  error ? 'border-acc' : 'border-stepbd'
                }`}
              />
              {error && <div className="text-[11px] leading-[1.6] text-acc">{error}</div>}
              <button
                type="button"
                onClick={backToEmail}
                className="tt-label cursor-pointer self-start border-0 bg-transparent py-2 text-[11px] tracking-[0.1em] text-dim underline underline-offset-[3px]"
              >
                Use a different email
              </button>
            </div>
            <button type="button" onClick={signIn} className={accentBtn}>
              Sign in
            </button>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="flex flex-1 flex-col justify-center gap-[14px]">
              <div className={eyebrow}>Signed in</div>
              <div className="tt-label text-[44px] font-extrabold tracking-[0.02em] text-tx">
                Ready.
              </div>
              <div className="tt-label text-[12px] leading-[1.7] tracking-[0.04em] text-mut">
                873 exercises loaded
                <br />
                Works offline · syncs when online
              </div>
            </div>
            <button type="button" onClick={complete} className={accentBtn}>
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

/**
 * Admin login — the only entry point to /admin.
 *
 * Two-step Supabase magic-code flow (no shared secret ever touches the
 * browser):
 *   1. Enter the admin email → POST /api/auth/magic-link/request. Only
 *      ADMIN_EMAILS-allowlisted addresses actually get a code; the response
 *      tells us whether the email service accepted the request so the form
 *      can show a real error boundary instead of a silent "sent".
 *   2. Enter the one-time code → POST /api/auth/magic-link/verify — on success
 *      the server sets an HttpOnly `admin_session` cookie and we land on
 *      /admin. Clicking the magic link in the email (→ /api/auth/callback)
 *      works too. Supabase's code length is configurable (6, 8, or 10 digits),
 *      so the input accepts any of those.
 *
 * Both steps sit behind per-IP lockout + a global circuit breaker
 * (lib/api/auth-guard.ts).
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  ArrowLeft,
  Pulse,
  CheckCircle,
  CircleNotch,
  Envelope,
  EnvelopeOpen,
  MapPin,
  ShieldCheck,
  Triangle,
  X,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { OtpSlots } from '@/components/admin/otp-slots'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESEND_SECONDS = 45

type Step = 'email' | 'code'

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string; hint?: string }
  | { kind: 'rate-limited'; retryAfterSec: number }

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string }
  | { kind: 'rate-limited'; retryAfterSec: number }

function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@')
  if (!name) return email
  return `${name[0]}${'•'.repeat(Math.min(Math.max(name.length - 1, 1), 5))}@${domain}`
}

function fmtCountdown(sec: number): string {
  return `0:${String(sec).padStart(2, '0')}`
}

/** mm:ss for session-expiry counts that can exceed a minute. */
function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function GoToAdminAuthPage() {
  // Match the console's theme so the front door and the dashboard don't flash
  // different moods. Reads the same key the header toggle writes; when the
  // user has never chosen, follow the OS preference (ivory for light-mode
  // systems, warm dark otherwise).
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const saved = localStorage.getItem('busgo-admin-theme')
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved)
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      // A console toggle writes the key — once the user chooses, stop tracking.
      if (!localStorage.getItem('busgo-admin-theme')) setTheme(mq.matches ? 'light' : 'dark')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  // Same portal fix as the dashboard: mirror the theme onto <html> so any
  // Radix overlay on this page inherits the console tokens, not the light
  // :root defaults. Cleaned up on unmount.
  useEffect(() => {
    const el = document.documentElement
    el.classList.toggle('dark', theme === 'dark')
    el.classList.toggle('admin-light', theme === 'light')
    return () => el.classList.remove('dark', 'admin-light')
  }, [theme])

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [send, setSend] = useState<SendState>({ kind: 'idle' })
  const [verify, setVerify] = useState<VerifyState>({ kind: 'idle' })
  const [resendIn, setResendIn] = useState(0)
  // First-time addresses get a one-time confirmation email before codes flow
  // (Supabase "Confirm email" is on). When set, the form explains that instead
  // of pretending a code is on its way.
  const [confirmFirst, setConfirmFirst] = useState(false)

  // Already signed in? Show a session notice with a live expiry countdown,
  // then land on the dashboard after a beat (or on click).
  const [sessionState, setSessionState] = useState<'checking' | 'signed-in' | 'none'>('checking')
  const [session, setSession] = useState<{ email: string; idleExpiresInSec: number } | null>(null)
  const [redirectIn, setRedirectIn] = useState(3)
  const [idleLeft, setIdleLeft] = useState(0)

  // System notices carried in from ?error= (failed magic-link click, or a
  // session killed mid-use on the dashboard). Shown as a dismissible banner,
  // separate from inline form validation errors.
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.authenticated) {
          setSession({ email: d.email ?? '', idleExpiresInSec: d.idleExpiresInSec ?? 0 })
          setSessionState('signed-in')
        } else {
          setSessionState('none')
        }
      })
      .catch(() => setSessionState('none'))
  }, [])

  // A failed magic-link click lands here with ?error=… — surface it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err) {
      setNotice(err)
      window.history.replaceState({}, '', '/goToAdminAuth')
    }
  }, [])

  // Live countdowns while signed in: idle window left + the 3s auto-redirect.
  useEffect(() => {
    if (sessionState !== 'signed-in' || !session) return
    setIdleLeft(session.idleExpiresInSec)
    const id = setInterval(() => {
      setIdleLeft((s) => Math.max(0, s - 1))
      setRedirectIn((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [sessionState, session])

  // Auto-redirect once the countdown hits zero.
  useEffect(() => {
    if (sessionState !== 'signed-in' || redirectIn > 0) return
    window.location.replace('/admin')
  }, [sessionState, redirectIn])

  // Resend countdown ticker (only while > 0).
  useEffect(() => {
    if (resendIn <= 0) return
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [resendIn])

  const requestCode = useCallback(async () => {
    const addr = email.trim().toLowerCase()
    if (!EMAIL_RE.test(addr)) {
      setSend({ kind: 'error', message: 'Enter a valid email address.' })
      return
    }
    setSend({ kind: 'sending' })
    setVerify({ kind: 'idle' })
    try {
      const res = await fetch('/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setSend({ kind: 'rate-limited', retryAfterSec: data?.retryAfterSec ?? 60 })
        return
      }
      if (!res.ok) {
        setSend({ kind: 'error', message: data?.error ?? 'Could not send the code. Try again.' })
        return
      }
      if (data?.sent === true) {
        if (data?.step === 'confirm') {
          // New to Supabase Auth — a confirmation email went out, not a code.
          setConfirmFirst(true)
          setSend({ kind: 'sent' })
          setResendIn(RESEND_SECONDS)
          return
        }
        setConfirmFirst(false)
        setStep('code')
        setSend({ kind: 'sent' })
        setResendIn(RESEND_SECONDS)
        return
      }
      if (data?.detail === 'not-allowlisted') {
        setSend({
          kind: 'error',
          message: 'That email is not registered as an admin. Codes are only sent to addresses in ADMIN_EMAILS.',
        })
        return
      }
      // Allowlisted, but the email service rejected the send — surface it.
      setSend({
        kind: 'error',
        message: data?.message ?? 'The email service rejected the request.',
        hint: 'Check Supabase → Authentication → Email provider is enabled (and SMTP configured, if you use a custom sender).',
      })
    } catch {
      setSend({ kind: 'error', message: 'Could not reach the API. Check your connection and try again.' })
    }
  }, [email])

  const verifyCode = useCallback(async (raw?: string) => {
    const value = (raw ?? code).trim()
    if (!/^\d{6,10}$/.test(value)) {
      setVerify({ kind: 'error', message: 'Enter the code from the email (6, 8, or 10 digits).' })
      return
    }
    setVerify({ kind: 'verifying' })
    try {
      const res = await fetch('/api/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: value }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setVerify({ kind: 'rate-limited', retryAfterSec: data?.retryAfterSec ?? 60 })
        return
      }
      if (!res.ok) {
        setVerify({ kind: 'error', message: data?.error ?? 'Invalid or expired code.' })
        return
      }
      window.location.replace('/admin')
    } catch {
      setVerify({ kind: 'error', message: 'Could not reach the API. Check your connection and try again.' })
    }
  }, [code, email])

  const onCodeChange = useCallback(
    (value: string) => {
      const clean = value.replace(/\D/g, '').slice(0, 10)
      setCode(clean)
      // Auto-submit once the code reaches a full, valid length (Supabase ships
      // 6, 8, or 10-digit OTPs depending on the project's Auth settings).
      if ([6, 8, 10].includes(clean.length)) verifyCode(clean)
    },
    [verifyCode]
  )

  const resendEnabled = resendIn === 0 && send.kind !== 'sending'
  const busy = send.kind === 'sending' || verify.kind === 'verifying'
  const sendError =
    send.kind === 'error' ? send : send.kind === 'rate-limited' ? { message: `Too many attempts. Try again in ${fmtCountdown(send.retryAfterSec)}.` } : null
  const verifyError =
    verify.kind === 'error'
      ? verify
      : verify.kind === 'rate-limited'
        ? { message: `Too many attempts. Try again in ${fmtCountdown(verify.retryAfterSec)}.` }
        : null

  return (
    <div className={`${theme === 'dark' ? 'dark' : 'admin-light'} min-h-[100dvh] bg-background text-foreground`}>
      <div className="grid min-h-[100dvh] lg:grid-cols-[1.15fr_1fr]">
        {/* ─── Brand panel (desktop) ─────────────────────────────────────── */}
        <aside className="relative hidden overflow-hidden border-r border-border/70 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
          {/* Ambient layers: brand-teal glow + faint grid + bottom fade — all
              token-driven so they adapt to the warm dark and ivory themes. */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_45%_at_15%_0%,color-mix(in_oklab,var(--brand)_12%,transparent),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--foreground)_8%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--foreground)_8%,transparent)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />

          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={theme === 'dark' ? '/assets/busgo-logo-dark-sm.png' : '/assets/busgo-logo-light-sm.png'}
              alt="BusGo Track"
              className="h-20 w-auto xl:h-24"
            />
          </div>

          <div className="relative max-w-md">
            <h1 className="text-4xl font-semibold tracking-tight text-balance xl:text-5xl">
              The control room for BusGo Track.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Flip endpoints off, triage incidents, and review stop suggestions — gated behind a code
              sent to your inbox.
            </p>
            <ul className="mt-8 space-y-3.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-3">
                <Pulse className="size-4 shrink-0 text-brand/90" />
                Live health checks on every API route
              </li>
              <li className="flex items-center gap-3">
                <ShieldCheck className="size-4 shrink-0 text-brand/90" />
                Signed-in sessions only — no shared secrets in the browser
              </li>
              <li className="flex items-center gap-3">
                <MapPin className="size-4 shrink-0 text-brand/90" />
                Approve stop-suggestion edits for the Kigali network
              </li>
            </ul>
          </div>

          <p className="relative text-xs text-muted-foreground">
            © {new Date().getFullYear()} BusGo Track · Kigali, Rwanda
          </p>
        </aside>

        {/* ─── Form panel ─────────────────────────────────────────────────── */}
        <main className="flex items-center justify-center px-5 py-12 sm:px-10">
          <div className="w-full max-w-sm">
            {sessionState === 'signed-in' && session ? (
              /* Already signed in — session notice with a live expiry countdown,
                 then auto-redirect (or Continue on click). */
              <div className="flex flex-col items-center text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={theme === 'dark' ? '/assets/busgo-logo-dark-sm.png' : '/assets/busgo-logo-light-sm.png'}
                  alt="BusGo Track"
                  className="h-16 w-auto"
                />
                <div className="rise-in mt-8 w-full" style={{ '--rise-index': 0 } as CSSProperties}>
                  <h2 className="text-2xl font-semibold tracking-tight">You&apos;re signed in</h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Signed in as <span className="font-mono text-xs">{session.email}</span>. Taking you to
                    the dashboard…
                  </p>

                  <div className="mt-5 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2 text-xs font-medium text-brand">
                      <span className="status-breathe size-1.5 rounded-full bg-brand" />
                      Session active — redirecting in {redirectIn}s
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Idle session expires in{' '}
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {fmtDuration(idleLeft)}
                      </span>{' '}
                      without activity.
                    </p>
                  </div>

                  <Button
                    onClick={() => window.location.replace('/admin')}
                    className="mt-4 h-11 w-full text-sm"
                  >
                    Continue to dashboard
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Mobile logo */}
                <div className="mb-10 flex justify-center lg:hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={theme === 'dark' ? '/assets/busgo-logo-dark-sm.png' : '/assets/busgo-logo-light-sm.png'}
                    alt="BusGo Track"
                    className="h-16 w-auto"
                  />
                </div>

                {/* System notice — a session killed mid-use, or a failed magic-link
                    click, arrives as ?error=… and renders here (dismissible). */}
                {notice && (
                  <Alert className="mb-4 border-destructive/40 bg-destructive/10">
                    <Triangle className="size-4 text-destructive" />
                    <AlertDescription className="pr-6 text-xs">{notice}</AlertDescription>
                    <AlertAction>
                      <button
                        type="button"
                        onClick={() => setNotice(null)}
                        aria-label="Dismiss"
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </AlertAction>
                  </Alert>
                )}

                <div className="rise-in" style={{ '--rise-index': 0 } as CSSProperties}>
              <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {step === 'email'
                  ? 'Enter your admin email and we’ll send a one-time code.'
                  : `We sent a code to ${maskEmail(email)}.`}
              </p>
            </div>

            {step === 'email' ? (
              <form
                className="rise-in mt-7"
                style={{ '--rise-index': 1 } as CSSProperties}
                onSubmit={(e) => {
                  e.preventDefault()
                  requestCode()
                }}
              >
                <label htmlFor="admin-email" className="mb-1.5 block text-xs font-semibold">
                  Email
                </label>
                <div className="relative">
                  <Input
                    id="admin-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setConfirmFirst(false)
                      if (send.kind !== 'sending') setSend({ kind: 'idle' })
                    }}
                    placeholder="you@example.com"
                    className="h-11 pr-10 text-sm"
                    autoFocus
                  />
                  <Envelope className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                </div>

                {confirmFirst && send.kind === 'sent' && (
                  <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                      <EnvelopeOpen className="size-3.5" /> One-time confirmation sent to {maskEmail(email)}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      This address is new — click the confirmation link in the email once (it lands you
                      back on this sign-in page), then send the code again. After that, codes come
                      straight to your inbox.
                    </p>
                  </div>
                )}
                {send.kind === 'sent' && !confirmFirst && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-success">
                    <CheckCircle className="size-3.5" /> Code sent — check your inbox.
                  </p>
                )}
                {sendError && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                    <Triangle className="mt-px size-3.5 shrink-0" />
                    <span>{sendError.message}</span>
                  </p>
                )}
                {send.kind === 'error' && send.hint && (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{send.hint}</p>
                )}

                <Button
                  type="submit"
                  disabled={send.kind === 'sending' || !email.trim()}
                  className="mt-4 h-11 w-full justify-center text-sm"
                >
                  {send.kind === 'sending' ? (
                    <>
                      <CircleNotch className="size-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    'Send code'
                  )}
                </Button>

                <p className="mt-6 flex justify-center">
                  <a
                    href="/"
                    className="group inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
                    Back to the public status page
                  </a>
                </p>
              </form>
            ) : (
              <div className="rise-in mt-7" style={{ '--rise-index': 1 } as CSSProperties}>
                {send.kind === 'sent' && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-success">
                    <CheckCircle className="size-3.5" /> Code sent to {maskEmail(email)} — check your
                    inbox.
                  </p>
                )}

                <label htmlFor="admin-code" className="mb-1.5 block text-xs font-semibold">
                  One-time code
                </label>
                <OtpSlots
                  id="admin-code"
                  value={code}
                  onChange={onCodeChange}
                  disabled={verify.kind === 'verifying'}
                  invalid={!!verifyError}
                />

                {verifyError && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                    <Triangle className="mt-px size-3.5 shrink-0" />
                    <span>{verifyError.message}</span>
                  </p>
                )}
                {send.kind === 'error' && sendError && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                    <Triangle className="mt-px size-3.5 shrink-0" />
                    <span>{sendError.message}</span>
                  </p>
                )}

                <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setStep('email')
                      setVerify({ kind: 'idle' })
                      setCode('')
                    }}
                    disabled={busy}
                    className="h-11 px-3 text-xs"
                  >
                    <ArrowLeft className="size-3.5" /> Back
                  </Button>
                  <Button
                    type="button"
                    onClick={() => verifyCode()}
                    disabled={verify.kind === 'verifying' || !/^\d{6,10}$/.test(code)}
                    className="h-11 text-sm"
                  >
                    {verify.kind === 'verifying' ? (
                      <>
                        <CircleNotch className="size-4 animate-spin" /> Signing in…
                      </>
                    ) : (
                      'Sign in'
                    )}
                  </Button>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={requestCode}
                    disabled={!resendEnabled}
                    className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                  >
                    {send.kind === 'sending'
                      ? 'Sending…'
                      : resendIn > 0
                        ? `Resend code in ${fmtCountdown(resendIn)}`
                        : 'Resend code'}
                  </button>
                  <a
                    href="/"
                    className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    public status page
                  </a>
                </div>

                <Alert className="mt-5 border-muted/40 bg-muted/20">
                  <AlertDescription className="text-xs text-muted-foreground">
                    No email? Check spam, wait a minute, then resend. You can also click the link in
                    the email instead of typing the code.
                  </AlertDescription>
                </Alert>
              </div>
            )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

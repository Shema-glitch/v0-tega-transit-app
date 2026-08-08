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
 *   2. Enter the 6-digit code → POST /api/auth/magic-link/verify — on success
 *      the server sets an HttpOnly `admin_session` cookie and we land on
 *      /admin. Clicking the magic link in the email (→ /api/auth/callback)
 *      works too.
 *
 * Both steps sit behind per-IP lockout + a global circuit breaker
 * (lib/api/auth-guard.ts).
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

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

export default function GoToAdminAuthPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [send, setSend] = useState<SendState>({ kind: 'idle' })
  const [verify, setVerify] = useState<VerifyState>({ kind: 'idle' })
  const [resendIn, setResendIn] = useState(0)

  // Already signed in? Straight to the dashboard.
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.authenticated) window.location.replace('/admin')
      })
      .catch(() => {})
  }, [])

  // A failed magic-link click lands here with ?error=… — surface it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err) {
      setSend({ kind: 'error', message: err })
      window.history.replaceState({}, '', '/goToAdminAuth')
    }
  }, [])

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
    if (!/^\d{6}$/.test(value)) {
      setVerify({ kind: 'error', message: 'Enter the 6-digit code from the email.' })
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
      const clean = value.replace(/\D/g, '').slice(0, 6)
      setCode(clean)
      if (clean.length === 6) verifyCode(clean)
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
    <div className="dark min-h-[100dvh] bg-background text-foreground">
      <div className="grid min-h-[100dvh] lg:grid-cols-[1.15fr_1fr]">
        {/* ─── Brand panel (desktop) ─────────────────────────────────────── */}
        <aside className="relative hidden overflow-hidden border-r border-border/70 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
          {/* Ambient layers: emerald glow + faint grid + bottom fade */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_45%_at_15%_0%,rgba(16,185,129,0.09),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />

          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/busgo-logo-dark-sm.png" alt="BusGo Track" className="h-10 w-auto" />
          </div>

          <div className="relative max-w-md">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium tracking-widest text-emerald-300">
              <span className="status-breathe size-1.5 rounded-full bg-emerald-400" />
              LIVE · KIGALI TRANSIT
            </span>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-balance xl:text-4xl">
              The control room for BusGo Track.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Flip endpoints off, triage incidents, and review stop suggestions — gated behind a code
              sent to your inbox.
            </p>
            <ul className="mt-8 space-y-3.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-3">
                <Activity className="size-4 shrink-0 text-emerald-400/90" />
                Live health checks on every API route
              </li>
              <li className="flex items-center gap-3">
                <ShieldCheck className="size-4 shrink-0 text-emerald-400/90" />
                Signed-in sessions only — no shared secrets in the browser
              </li>
              <li className="flex items-center gap-3">
                <MapPin className="size-4 shrink-0 text-emerald-400/90" />
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
            {/* Mobile logo */}
            <div className="mb-10 flex justify-center lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/busgo-logo-dark-sm.png" alt="BusGo Track" className="h-10 w-auto" />
            </div>

            <div className="rise-in" style={{ '--rise-index': 0 } as CSSProperties}>
              <p className="text-xs font-semibold tracking-widest text-emerald-400/90 uppercase">
                Admin console
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h2>
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
                      if (send.kind !== 'sending') setSend({ kind: 'idle' })
                    }}
                    placeholder="you@example.com"
                    className="h-11 pr-10 text-sm"
                    autoFocus
                  />
                  <Mail className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                </div>

                {send.kind === 'sent' && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="size-3.5" /> Code sent — check your inbox.
                  </p>
                )}
                {sendError && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>{sendError.message}</span>
                  </p>
                )}
                {send.kind === 'error' && send.hint && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{send.hint}</p>
                )}

                <Button
                  type="submit"
                  disabled={send.kind === 'sending' || !email.trim()}
                  className="mt-4 h-11 w-full justify-center text-sm"
                >
                  {send.kind === 'sending' ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    'Send code'
                  )}
                </Button>

                <p className="mt-5 text-center text-xs text-muted-foreground">
                  <a href="/" className="underline underline-offset-2 hover:opacity-80">
                    ← back to the public status page
                  </a>
                </p>
              </form>
            ) : (
              <div className="rise-in mt-7" style={{ '--rise-index': 1 } as CSSProperties}>
                {send.kind === 'sent' && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="size-3.5" /> Code sent to {maskEmail(email)} — check your
                    inbox.
                  </p>
                )}

                <label htmlFor="admin-code" className="mb-1.5 block text-xs font-semibold">
                  One-time code
                </label>
                <div className="relative">
                  <Input
                    id="admin-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => onCodeChange(e.target.value)}
                    placeholder="000000"
                    className="h-12 pr-10 text-center font-mono text-lg tracking-[0.45em]"
                    autoFocus
                  />
                  <KeyRound className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                </div>

                {verifyError && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>{verifyError.message}</span>
                  </p>
                )}
                {send.kind === 'error' && sendError && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
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
                    disabled={verify.kind === 'verifying' || code.length !== 6}
                    className="h-11 text-sm"
                  >
                    {verify.kind === 'verifying' ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Signing in…
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
                  <a href="/" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
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
          </div>
        </main>
      </div>
    </div>
  )
}

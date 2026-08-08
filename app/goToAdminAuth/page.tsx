'use client'

/**
 * Admin login — the only entry point to /admin now.
 *
 * Two-step Supabase magic-code flow (no shared secret ever touches the
 * browser):
 *   1. Enter the admin email → POST /api/auth/magic-link/request (Supabase
 *      emails a 6-digit code; only ADMIN_EMAILS-allowlisted addresses get
 *      one, and the response is identical either way).
 *   2. Enter the code → POST /api/auth/magic-link/verify — on success the
 *      server sets an HttpOnly `admin_session` cookie and we land on /admin.
 *
 * The response is deliberately generic for step 1 so the allowlist can't be
 * probed, and both steps sit behind per-IP lockout + a global circuit
 * breaker (lib/api/auth-guard.ts).
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, KeyRound, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const STATUS_COLOR = {
  err: 'text-destructive',
  dim: 'text-muted-foreground',
} as const

type Step = 'email' | 'code' | 'sent'

export default function GoToAdminAuthPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Already signed in? Straight to the dashboard.
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.authenticated) window.location.replace('/admin')
      })
      .catch(() => {})
  }, [])

  const requestCode = useCallback(async () => {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setError(data?.retryAfterSec
          ? `Too many attempts — try again in ${data.retryAfterSec}s.`
          : 'Too many attempts — try again later.')
        return
      }
      if (!res.ok) {
        setError(data?.error ?? 'Could not send the code.')
        return
      }
      // Generic success — the email may or may not be allowlisted.
      setStep('code')
    } catch {
      setError('Could not reach the API — try again.')
    } finally {
      setBusy(false)
    }
  }, [email])

  const verifyCode = useCallback(async () => {
    if (!email.trim() || !/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from the email.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setError(data?.retryAfterSec
          ? `Too many attempts — try again in ${data.retryAfterSec}s.`
          : 'Too many attempts — try again later.')
        return
      }
      if (!res.ok) {
        setError(data?.error ?? 'Invalid or expired code.')
        return
      }
      window.location.replace('/admin')
    } catch {
      setError('Could not reach the API — try again.')
    } finally {
      setBusy(false)
    }
  }, [code, email])

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/busgo-logo-dark.png" alt="BusGo Track" className="h-12 w-auto" />
        </div>

        <Card className="p-6">
          <h1 className="text-lg font-bold">Admin sign in</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {step === 'email'
              ? 'Enter your admin email to receive a one-time code.'
              : `We sent a code to ${email}. Enter it below.`}
          </p>

          {step === 'email' ? (
            <div className="mt-4">
              <label htmlFor="admin-email" className="mb-1.5 block text-xs font-semibold">
                Email
              </label>
              <div className="relative">
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') requestCode() }}
                  placeholder="you@example.com"
                  className="h-11 pr-9 text-sm"
                  autoFocus
                />
                <Mail className={`pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 ${STATUS_COLOR.dim}`} />
              </div>
              {error && <p className={`mt-2 text-xs ${STATUS_COLOR.err}`}>{error}</p>}
              <Button onClick={requestCode} disabled={busy || !email.trim()} className="mt-4 h-11 w-full justify-center text-sm">
                {busy ? 'Sending…' : 'Send code'}
              </Button>
            </div>
          ) : (
            <div className="mt-4">
              <label htmlFor="admin-code" className="mb-1.5 block text-xs font-semibold">
                One-time code
              </label>
              <div className="relative">
                <Input
                  id="admin-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === 'Enter') verifyCode() }}
                  placeholder="000000"
                  className="h-11 pr-9 text-center font-mono text-lg tracking-[0.4em]"
                  autoFocus
                />
                <KeyRound className={`pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 ${STATUS_COLOR.dim}`} />
              </div>
              {error && <p className={`mt-2 text-xs ${STATUS_COLOR.err}`}>{error}</p>}
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setStep('email'); setError(null) }}
                  disabled={busy}
                  className="h-11 flex-1 gap-1 text-xs"
                >
                  <ArrowLeft className="size-3.5" /> Back
                </Button>
                <Button onClick={verifyCode} disabled={busy || code.length !== 6} className="h-11 flex-1 text-sm">
                  {busy ? 'Verifying…' : 'Sign in'}
                </Button>
              </div>
            </div>
          )}
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <a href="/" className="underline underline-offset-2 hover:opacity-80">
            ← back to the public status page
          </a>
        </p>

        {step === 'code' && (
          <Alert className="mt-4 border-muted/40 bg-muted/20">
            <AlertDescription className="text-xs text-muted-foreground">
              No email? Check spam, or request a new code after a minute. Codes expire in a few minutes.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}

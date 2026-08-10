'use client'

/**
 * components/admin/settings-panel.tsx — the "Settings" section of the admin
 * console.
 *
 * Owns the Google Authenticator second factor:
 *   - status (enabled / not set up / pending enrollment)
 *   - enroll: generates a secret, shows the otpauth:// URI + base32 key for
 *     Google Authenticator, then activates on a valid code
 *   - confirm identity: proves a fresh code and primes the session cookie's
 *     totpAt claim, so sensitive actions (stop writes, maintenance toggles,
 *     admin invite/revoke, suggestion approval) are allowed for a 5-minute
 *     grace window
 *   - disable: requires a valid code (a hijacker can't just switch it off)
 *
 * All writes go to /api/admin/settings/totp (admin-gated, audit-logged).
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { toDataURL } from 'qrcode'
import { CheckCircle2, Copy, KeyRound, Loader2, RefreshCw, ScanLine, ShieldCheck, ShieldOff, Smartphone, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface TotpStatus {
  enabled: boolean
  enabledAt: number | null
  /** True when an enrollment was started but not yet activated. */
  pending: boolean
  dbOk: boolean
  /** Present when pending — the secret + otpauth URI to show the admin. */
  pendingEnrollment?: { secret: string; otpauthUri: string } | null
}

type Step = 'idle' | 'enrolling' | 'show-key' | 'activating'

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtGrace(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function SettingsPanel({ onNotify }: { onNotify: (message: string, kind?: 'success' | 'error') => void }) {
  const [status, setStatus] = useState<TotpStatus | null>(null)
  const [step, setStep] = useState<Step>('idle')
  const [secret, setSecret] = useState('')
  const [uri, setUri] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Identity-confirm grace window (from a successful verify).
  const [graceLeft, setGraceLeft] = useState(0)
  // QR of the otpauth URI, generated client-side (the URI never leaves the page).
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrFailed, setQrFailed] = useState(false)

  useEffect(() => {
    if (!uri) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    setQrFailed(false)
    toDataURL(uri, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0a0a0a', light: '#ffffff' }, // off-black on white — scannable contrast
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [uri])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings/totp', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      setStatus(data)
      if (data?.pendingEnrollment?.secret && !data.enabled) {
        setSecret(data.pendingEnrollment.secret)
        setUri(data.pendingEnrollment.otpauthUri)
        setStep('show-key')
      }
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Live grace countdown after a successful identity confirmation.
  useEffect(() => {
    if (graceLeft <= 0) return
    const t = setInterval(() => setGraceLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [graceLeft])

  const beginEnroll = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/settings/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enroll' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Could not start setup.')
        return
      }
      setSecret(data.enrollment.secret)
      setUri(data.enrollment.otpauthUri)
      setStep('show-key')
      onNotify('Authenticator key generated — add it to your app, then activate.')
    } catch {
      setError('Could not reach the API.')
    } finally {
      setBusy(false)
    }
  }, [onNotify])

  const activate = useCallback(async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from Google Authenticator.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/settings/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'That code was not accepted.')
        return
      }
      setCode('')
      setStep('idle')
      onNotify('Two-factor authentication is on — sensitive actions now need your authenticator code.')
      refresh()
    } catch {
      setError('Could not reach the API.')
    } finally {
      setBusy(false)
    }
  }, [code, onNotify, refresh])

  const confirmIdentity = useCallback(async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from Google Authenticator.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/settings/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'That code was not accepted.')
        return
      }
      setCode('')
      setGraceLeft(data.totpGraceSec ?? 300)
      onNotify('Identity confirmed — sensitive actions are unlocked for 5 minutes.')
    } catch {
      setError('Could not reach the API.')
    } finally {
      setBusy(false)
    }
  }, [code, onNotify])

  const disable = useCallback(async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from Google Authenticator.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/settings/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'That code was not accepted.')
        return
      }
      setCode('')
      setGraceLeft(0)
      onNotify('Two-factor authentication is off.')
      refresh()
    } catch {
      setError('Could not reach the API.')
    } finally {
      setBusy(false)
    }
  }, [code, onNotify, refresh])

  const copySecret = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      onNotify('Could not copy — select the key manually.', 'error')
    }
  }, [secret, onNotify])

  const enabled = status?.enabled ?? false

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          Google Authenticator second factor for this account — protects the destructive surface (stop
          writes, maintenance toggles, admin changes) even if your email is compromised.
        </p>
        <Button variant="outline" size="sm" onClick={refresh} className="h-9 gap-1.5 text-xs">
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>

      {/* ─── Status + identity confirmation ─────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <ShieldCheck className="size-4 text-brand" />
              Two-factor authentication
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {status === null
                ? 'Loading status…'
                : enabled
                  ? `Active since ${status.enabledAt ? fmtDate(status.enabledAt) : '—'}`
                  : 'Not set up — sensitive actions only need your email code for now.'}
            </CardDescription>
          </div>
          {enabled ? (
            <Badge className="gap-1.5 bg-brand/15 font-semibold text-brand">
              <CheckCircle2 className="size-3" /> TOTP active
            </Badge>
          ) : (
            <Badge className="gap-1.5 bg-muted font-semibold text-muted-foreground">
              <ShieldOff className="size-3" /> Not set up
            </Badge>
          )}
        </CardHeader>

        {enabled && (
          <CardContent className="grid gap-4 md:grid-cols-2">
            {/* Confirm identity — primes the 5-minute sensitive-op grace */}
            <div className="rise-in rounded-xl border border-border bg-card p-4" style={{ '--rise-index': 0 } as CSSProperties}>
              <p className="flex items-center gap-2 text-xs font-semibold">
                <Smartphone className="size-3.5 text-brand" />
                Confirm identity
                {graceLeft > 0 && (
                  <span className="ml-auto font-mono text-xs tabular-nums text-brand">
                    {fmtGrace(graceLeft)} left
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {graceLeft > 0
                  ? 'Sensitive actions are unlocked for the remaining window.'
                  : 'Enter a fresh authenticator code to unlock sensitive actions for 5 minutes.'}
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-10 w-32 font-mono text-center text-sm tracking-[0.3em]"
                />
                <Button size="sm" onClick={confirmIdentity} disabled={busy || code.length !== 6} className="h-10 text-xs">
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Confirm'}
                </Button>
              </div>
            </div>

            {/* Disable — requires a valid code, so a hijacker can't turn it off */}
            <div className="rise-in rounded-xl border border-border bg-card p-4" style={{ '--rise-index': 1 } as CSSProperties}>
              <p className="flex items-center gap-2 text-xs font-semibold text-destructive">
                <ShieldOff className="size-3.5" />
                Disable two-factor
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Requires a valid authenticator code — this is deliberate, so a compromised session
                can&apos;t switch the second factor off.
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-10 w-32 font-mono text-center text-sm tracking-[0.3em]"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={disable}
                  disabled={busy || code.length !== 6}
                  className="h-10 text-xs"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Disable'}
                </Button>
              </div>
            </div>
          </CardContent>
        )}

        {!enabled && (
          <CardContent>
            {step === 'idle' && (
              <div className="rise-in flex flex-col items-start gap-3" style={{ '--rise-index': 0 } as CSSProperties}>
                <p className="max-w-[52ch] text-xs leading-relaxed text-muted-foreground">
                  Set up Google Authenticator so that destructive actions require a code from your phone —
                  the second factor a hijacker who reads your OTP emails still can&apos;t produce.
                </p>
                <Button onClick={beginEnroll} disabled={busy} className="gap-2 text-xs">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  Set up authenticator
                </Button>
              </div>
            )}

            {step === 'show-key' && (
              <div className="rise-in space-y-4" style={{ '--rise-index': 0 } as CSSProperties}>
                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                  {/* QR — the primary path: scan with the authenticator app */}
                  <div className="flex flex-col items-center gap-2 self-start rounded-xl border border-border bg-white p-4">
                    {qrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrDataUrl}
                        alt="QR code to add BusGo Track to Google Authenticator"
                        className="size-[216px]"
                      />
                    ) : qrFailed ? (
                      <div className="flex size-[216px] flex-col items-center justify-center gap-2 text-center">
                        <TriangleAlert className="size-5 text-warning" />
                        <p className="max-w-[24ch] text-xs text-muted-foreground">
                          Couldn&apos;t render the QR — use the setup key below instead.
                        </p>
                      </div>
                    ) : (
                      <div className="flex size-[216px] items-center justify-center">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ScanLine className="size-3.5 text-brand" /> Scan with Google Authenticator
                    </p>
                  </div>

                  {/* Manual fallback: instructions + setup key */}
                  <div className="space-y-3">
                    <ol className="list-inside list-decimal space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                      <li>
                        Open <span className="font-semibold text-foreground">Google Authenticator</span> → tap{' '}
                        <span className="font-semibold text-foreground">+</span> →{' '}
                        <span className="font-semibold text-foreground">Scan QR code</span> and point the camera
                        at the code on the left.
                      </li>
                      <li>
                        No camera? Tap <span className="font-semibold text-foreground">Enter a setup key</span>{' '}
                        instead — account <span className="font-mono text-xs">BusGo Track</span>, then paste the key
                        below.
                      </li>
                      <li>Enter the 6-digit code it shows to activate.</li>
                    </ol>

                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                          Setup key
                        </p>
                        <Button variant="outline" size="sm" onClick={copySecret} className="h-7 gap-1.5 px-2 text-xs">
                          {copied ? <CheckCircle2 className="size-3 text-brand" /> : <Copy className="size-3" />}
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                      <p className="mt-2 font-mono text-xs break-all tracking-widest">{secret}</p>
                      <p className="mt-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                        otpauth URI
                      </p>
                      <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{uri}</p>
                    </div>
                  </div>
                </div>

                {error && (
                  <p className="flex items-start gap-1.5 text-xs text-destructive">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    {error}
                  </p>
                )}

                <div className="flex items-end gap-2">
                  <div>
                    <label htmlFor="totp-activate-code" className="mb-1.5 block text-xs font-semibold">
                      Authenticator code
                    </label>
                    <Input
                      id="totp-activate-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="h-10 w-36 font-mono text-center text-sm tracking-[0.3em]"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={activate}
                    disabled={busy || code.length !== 6}
                    className="h-10 text-xs"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Activate'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </section>
  )
}

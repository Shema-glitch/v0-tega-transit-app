/**
 * POST /api/auth/magic-link/verify  { email, code }
 *
 * Step 2 of the admin login: exchanges the emailed one-time code for a Supabase
 * session (server-side), then — only if the email is on the ADMIN_EMAILS
 * allowlist — issues our own short-lived HttpOnly `admin_session` cookie.
 * Failed codes count toward the per-IP lockout and the global circuit breaker.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { sessionCookieHeader } from '@/lib/api/admin-auth'
import { isAdminEmailAllowed } from '@/lib/api/admin-emails'
import { getAuthGuardStatus, recordAuthFailure, recordAuthSuccess } from '@/lib/api/auth-guard'
import { AuthLog } from '@/lib/api/auth-log'
import { clientIp } from '@/lib/api/client-ip'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Supabase's email OTP length is configurable (6, 8, or 10 digits) — accept all
// three so the form never rejects a valid code based on our own assumption.
const CODE_RE = /^\d{6,10}$/

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers)

  const guard = getAuthGuardStatus(ip)
  if (guard.blocked) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.', retryAfterSec: guard.retryAfterSec },
      { status: 429, headers: { ...CORS, 'Retry-After': String(guard.retryAfterSec) } }
    )
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!EMAIL_RE.test(email) || !CODE_RE.test(code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: CORS })
  }

  try {
    const supabase = getSupabaseServer()
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })

    if (error || !data.session) {
      recordAuthFailure(ip)
      AuthLog.record({ action: 'verify', email, ip, ok: false, detail: error?.message ?? 'no session' })
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401, headers: CORS })
    }

    if (!(await isAdminEmailAllowed(email))) {
      recordAuthFailure(ip)
      AuthLog.record({ action: 'verify', email, ip, ok: false, detail: 'email not allowlisted' })
      return NextResponse.json({ error: 'Not authorized' }, { status: 403, headers: CORS })
    }

    recordAuthSuccess(ip)
    AuthLog.record({ action: 'login', email, ip, ok: true })

    const cookie = sessionCookieHeader(email)
    if (!cookie) {
      return NextResponse.json(
        { error: 'Auth is not configured (ADMIN_SESSION_SECRET / ADMIN_TOKEN)' },
        { status: 500, headers: CORS }
      )
    }
    return NextResponse.json({ ok: true, email }, { headers: { ...CORS, 'Set-Cookie': cookie } })
  } catch (err) {
    AuthLog.record({
      action: 'verify',
      email,
      ip,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: 'Could not verify code', details: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: CORS }
    )
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

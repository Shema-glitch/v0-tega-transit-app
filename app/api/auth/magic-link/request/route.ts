/**
 * POST /api/auth/magic-link/request  { email }
 *
 * Step 1 of the admin login: asks Supabase Auth to email a 6-digit code (and a
 * magic link) to the admin's address.
 *
 * Response contract (so the login page can show real error boundaries):
 *   - { ok: true,  sent: true }                 allowlisted + Supabase accepted
 *   - { ok: true,  sent: false, detail: 'not-allowlisted' }   not an admin address
 *   - { ok: true,  sent: false, detail, message }  allowlisted but Supabase
 *                                                   rejected the send (email
 *                                                   provider disabled, SMTP
 *                                                   misconfigured, signups
 *                                                   off…) — the admin sees
 *                                                   this and can fix it / retry
 *   - { ok: false, error, retryAfterSec }        rate limited (429) or bad input
 *
 * Note: `sent: true/false` distinguishes allowlisted addresses, which slightly
 * relaxes the anti-enumeration posture for a deliberate UX win — the admin gets
 * to know whether the email service actually accepted the request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { isAdminEmailAllowed } from '@/lib/api/admin-emails'
import { getAuthGuardStatus, recordAuthFailure } from '@/lib/api/auth-guard'
import { AuthLog } from '@/lib/api/auth-log'
import { clientIp } from '@/lib/api/client-ip'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400, headers: CORS })
  }

  // Allowlist = ADMIN_EMAILS env seed + the admin_emails Supabase table
  // (invited from the dashboard). Fails closed to the env list if the DB
  // is unreachable.
  if (!(await isAdminEmailAllowed(email))) {
    // Slow down allowlist probing without revealing anything.
    recordAuthFailure(ip)
    AuthLog.record({ action: 'magic-link-request', email, ip, ok: false, detail: 'not allowlisted' })
    return NextResponse.json({ ok: true, sent: false, detail: 'not-allowlisted' }, { headers: CORS })
  }

  // Allowlisted — actually ask Supabase to send. The magic link in the email
  // points at our callback so a link-click also logs the admin in.
  const origin = request.nextUrl.origin
  try {
    const supabase = getSupabaseServer()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/api/auth/callback`,
      },
    })
    if (error) {
      AuthLog.record({ action: 'magic-link-request', email, ip, ok: false, detail: error.message })
      return NextResponse.json(
        { ok: true, sent: false, detail: 'email-service', message: error.message },
        { headers: CORS }
      )
    }
    AuthLog.record({ action: 'magic-link-request', email, ip, ok: true })
    return NextResponse.json({ ok: true, sent: true }, { headers: CORS })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    AuthLog.record({ action: 'magic-link-request', email, ip, ok: false, detail: message })
    return NextResponse.json(
      { ok: true, sent: false, detail: 'email-service', message },
      { headers: CORS }
    )
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

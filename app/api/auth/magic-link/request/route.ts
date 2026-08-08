/**
 * POST /api/auth/magic-link/request  { email }
 *
 * Step 1 of the admin login: asks Supabase Auth to email a 6-digit code to
 * the admin's address. Only allowlisted emails (ADMIN_EMAILS) actually get a
 * code — the response is identical for every well-formed request so the
 * allowlist can't be enumerated, and non-allowlisted probes still count
 * against the per-IP brute-force guard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { isAllowlistedAdmin } from '@/lib/api/admin-auth'
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

  if (isAllowlistedAdmin(email)) {
    try {
      const supabase = getSupabaseServer()
      await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
      AuthLog.record({ action: 'magic-link-request', email, ip, ok: true })
    } catch (err) {
      AuthLog.record({
        action: 'magic-link-request',
        email,
        ip,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  } else {
    AuthLog.record({ action: 'magic-link-request', email, ip, ok: false, detail: 'not allowlisted' })
    recordAuthFailure(ip) // slow down allowlist probing without revealing anything
  }

  // Generic success — never reveal whether the email is allowlisted.
  return NextResponse.json({ ok: true }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

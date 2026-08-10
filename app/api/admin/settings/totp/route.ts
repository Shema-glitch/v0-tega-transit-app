/**
 * /api/admin/settings/totp — Google Authenticator second factor for the
 * signed-in admin (see lib/api/admin-totp.ts for the logic).
 *
 *   GET                 → { enabled, enabledAt, pending: { secret, otpauthUri } | null, dbOk }
 *   POST { action }     → 'enroll'   start setup (returns secret + otpauth URI)
 *                          'activate'  { code }   activate the pending secret
 *                          'verify'    { code }   prove identity → session cookie
 *                                                 gains a totpAt claim (5 min grace)
 *                          'disable'   { code }   turn the second factor off
 *
 * Everything here is admin-gated twice (middleware 401 + in-handler check) and
 * every mutation lands in the audit log, like the rest of the auth surface.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateURI } from 'otplib'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { checkAdminAuth, sessionCookieHeader } from '@/lib/api/admin-auth'
import {
  activateTotp,
  beginTotpEnrollment,
  disableTotp,
  getTotpStatus,
  verifyTotp,
  TOTP_GRACE_MS,
  TOTP_ISSUER,
} from '@/lib/api/admin-totp'
import { AuthLog } from '@/lib/api/auth-log'
import { clientIp } from '@/lib/api/client-ip'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const ActionSchema = z.object({
  action: z.enum(['enroll', 'activate', 'verify', 'disable']),
  code: z.string().regex(/^\d{6}$/).optional(),
})

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const status = await getTotpStatus(auth.email)
  let pendingEnrollment: { secret: string; otpauthUri: string } | null = null
  if (status.pending && !status.enabled) {
    // Re-derive the otpauth URI from the stored pending secret so a refresh
    // mid-enrollment shows the same URI. The lib returns the URI on enroll;
    // here we recompute it from what the DB has.
    pendingEnrollment = await pendingEnrollmentFor(auth.email)
  }

  return NextResponse.json({ ...status, pendingEnrollment }, { headers: CORS })
}

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  const ip = clientIp(request.headers)

  const body = await request.json().catch(() => null)
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success || (parsed.data.action !== 'enroll' && !parsed.data.code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: CORS })
  }
  const { action, code } = parsed.data

  switch (action) {
    case 'enroll': {
      const result = await beginTotpEnrollment(auth.email)
      AuthLog.record({ action: 'totp-enroll', email: auth.email, ip, ok: result.ok })
      if (!result.ok) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 409, headers: CORS })
      }
      return NextResponse.json({ ok: true, enrollment: result.enrollment }, { headers: CORS })
    }
    case 'activate': {
      const result = await activateTotp(auth.email, code as string)
      AuthLog.record({ action: 'totp-activate', email: auth.email, ip, ok: result.ok })
      if (!result.ok) {
        const status = result.code === 'locked' ? 429 : 400
        return NextResponse.json({ error: result.error, code: result.code }, { status, headers: CORS })
      }
      return NextResponse.json({ ok: true }, { headers: CORS })
    }
    case 'verify': {
      const result = await verifyTotp(auth.email, code as string)
      AuthLog.record({ action: 'totp-verify', email: auth.email, ip, ok: result.ok })
      if (!result.ok) {
        const status = result.code === 'locked' ? 429 : 400
        return NextResponse.json({ error: result.error, code: result.code }, { status, headers: CORS })
      }
      // Prove identity: re-issue the session cookie with a totpAt claim, so
      // sensitive actions are allowed for the grace window without a fresh code.
      const cookie = sessionCookieHeader(auth.email, Date.now())
      if (!cookie) {
        return NextResponse.json(
          { error: 'Auth is not configured (ADMIN_SESSION_SECRET / ADMIN_TOKEN)' },
          { status: 500, headers: CORS }
        )
      }
      return NextResponse.json(
        { ok: true, totpGraceSec: TOTP_GRACE_MS / 1000, issuer: TOTP_ISSUER },
        { headers: { ...CORS, 'Set-Cookie': cookie } }
      )
    }
    case 'disable': {
      const result = await disableTotp(auth.email, code as string)
      AuthLog.record({ action: 'totp-disable', email: auth.email, ip, ok: result.ok })
      if (!result.ok) {
        const status = result.code === 'locked' ? 429 : 400
        return NextResponse.json({ error: result.error, code: result.code }, { status, headers: CORS })
      }
      return NextResponse.json({ ok: true }, { headers: CORS })
    }
  }
}

/** Rebuilds the otpauth URI from the stored pending secret (GET path). */
async function pendingEnrollmentFor(email: string): Promise<{ secret: string; otpauthUri: string } | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('admin_totp')
      .select('pending_secret')
      .eq('email', email)
      .maybeSingle()
    const secret = (data as { pending_secret?: string } | null)?.pending_secret
    if (error || !secret) return null
    return { secret, otpauthUri: generateURI({ issuer: TOTP_ISSUER, label: email, secret }) }
  } catch {
    return null
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

/**
 * /api/admin/curators — grant/revoke the curator role (CURATOR_GOVERNANCE.md).
 *
 *   POST   { email } → grant the curator role (address stays on the allowlist)
 *   DELETE ?email=…  → revoke it (back to plain admin)
 *
 * Admin-only, TOTP-gated (a hijacked session could lock out or over-privilege
 * people), and every change lands in the auth audit log. Role takes effect
 * immediately — it's re-read from the DB on every request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth, isAllowlistedAdmin } from '@/lib/api/admin-auth'
import { requireRole, setCuratorRole } from '@/lib/api/curators'
import { requireTotpForAction } from '@/lib/api/admin-totp'
import { AuthLog } from '@/lib/api/auth-log'
import { clientIp } from '@/lib/api/client-ip'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'admin')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  if (!(await requireTotpForAction(request, auth.email)).ok) {
    return NextResponse.json(
      { error: 'totp-required', message: 'Enter your authenticator code to continue.' },
      { status: 403, headers: CORS }
    )
  }

  const ip = clientIp(request.headers)
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400, headers: CORS })
  }
  if (isAllowlistedAdmin(email)) {
    return NextResponse.json(
      { error: `${email} is seeded via ADMIN_EMAILS and always has admin role — manage it in the deploy env.` },
      { status: 409, headers: CORS }
    )
  }

  const result = await setCuratorRole(email, true)
  AuthLog.record({ action: 'curator-grant', email, ip, ok: result.ok })
  if (!result.ok) {
    return NextResponse.json(
      { error: `Could not grant curator role: ${result.error}` },
      { status: result.notFound ? 404 : 502, headers: CORS }
    )
  }
  return NextResponse.json({ ok: true, email, role: 'curator' }, { headers: CORS })
}

export async function DELETE(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'admin')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  if (!(await requireTotpForAction(request, auth.email)).ok) {
    return NextResponse.json(
      { error: 'totp-required', message: 'Enter your authenticator code to continue.' },
      { status: 403, headers: CORS }
    )
  }

  const ip = clientIp(request.headers)
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400, headers: CORS })
  }

  const result = await setCuratorRole(email, false)
  AuthLog.record({ action: 'curator-revoke', email, ip, ok: result.ok })
  if (!result.ok) {
    return NextResponse.json(
      { error: `Could not revoke curator role: ${result.error}` },
      { status: result.notFound ? 404 : 502, headers: CORS }
    )
  }
  return NextResponse.json({ ok: true, email, role: 'admin' }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

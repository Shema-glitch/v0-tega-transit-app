/**
 * POST /api/auth/logout
 *
 * Clears the `admin_session` cookie. Stateless (HMAC), so there's nothing to
 * revoke server-side beyond dropping the cookie — the session naturally
 * expires within 8h anyway.
 */

import { NextResponse } from 'next/server'
import { clearSessionCookieHeader } from '@/lib/api/admin-auth'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({ ok: true }, { headers: { ...CORS, 'Set-Cookie': clearSessionCookieHeader() } })
}

export async function OPTIONS() {
  return corsPreflight()
}

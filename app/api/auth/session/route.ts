/**
 * GET /api/auth/session
 *
 * Reports whether the caller holds a valid `admin_session` cookie. Used by
 * the admin dashboard on boot to decide whether to render or send the user
 * to /goToAdminAuth. Deliberately public (it only reveals your own state).
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  checkAdminAuth,
  maybeRefreshSessionCookie,
  sessionIdleRemainingMs,
} from '@/lib/api/admin-auth'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  // Sliding session: the check itself counts as activity, so re-issue the
  // cookie (throttled to every 5 min) when the session is still valid.
  const refresh = auth.ok ? maybeRefreshSessionCookie(request) : null
  const idleMs = auth.ok ? sessionIdleRemainingMs(request) : null
  return NextResponse.json(
    {
      authenticated: auth.ok,
      email: auth.ok ? auth.email : null,
      // Seconds until the idle window kills the session — lets the login page
      // show a live "session expires in mm:ss" countdown.
      idleExpiresInSec: idleMs != null ? Math.floor(idleMs / 1000) : null,
    },
    { headers: { ...CORS, ...(refresh ? { 'Set-Cookie': refresh } : {}) } }
  )
}

export async function OPTIONS() {
  return corsPreflight()
}

/**
 * GET /admin/debug?token=<ADMIN_TOKEN>
 *
 * Secret trigger for the frontend's Debug Mode (stop rename/delete/add) —
 * see the "Open app in Debug Mode" button on the admin dashboard.
 * Bookmarkable/typeable directly too, for anyone who already knows the
 * token, which is the whole point: Debug Mode has no discoverable on-switch
 * left in the app itself (frontend/src/components/SettingsOverlay.jsx), so
 * this route is the only way to turn it on.
 *
 * Two ways in:
 *  - `?token=<ADMIN_TOKEN>` — the shared token (constant-time compared).
 *  - a valid `admin_session` cookie — the dashboard's "Open app in Debug
 *    Mode" button now relies on this, so no token ever needs to live in
 *    browser storage. In that case a short-lived (5 min) ephemeral token is
 *    minted and handed to the frontend; the API accepts it the same as the
 *    real token (see lib/api/admin-auth.ts).
 *
 * Redirects to the frontend with the token in a URL FRAGMENT, not a query
 * param — fragments never leave the browser on navigation, so it never
 * lands in a server access log on that end. It DOES arrive here as a query
 * param, which is unavoidable for a plain link; that's an accepted
 * trade-off since only someone who already holds a credential can use this.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth, createEphemeralToken, timingSafeEqualStr } from '@/lib/api/admin-auth'

const FRONTEND_ORIGIN = 'https://busgo-track.vercel.app'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  let debugToken: string | null = null
  if (token && process.env.ADMIN_TOKEN && timingSafeEqualStr(token, process.env.ADMIN_TOKEN)) {
    debugToken = token
  } else {
    const auth = checkAdminAuth(request)
    if (auth.ok) debugToken = createEphemeralToken(auth.email)
  }

  if (!debugToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const redirectUrl = new URL(FRONTEND_ORIGIN)
  redirectUrl.hash = `admin_debug=${encodeURIComponent(debugToken)}`
  return NextResponse.redirect(redirectUrl.toString(), 302)
}

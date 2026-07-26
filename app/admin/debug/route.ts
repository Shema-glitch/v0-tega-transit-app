/**
 * GET /admin/debug?token=<ADMIN_TOKEN>
 *
 * Secret trigger for the frontend's Debug Mode (stop rename/delete/add) —
 * see the "Open app in Debug Mode" button on the admin dashboard, which
 * builds this exact URL from the token already held in the admin session.
 * Bookmarkable/typeable directly too, for anyone who already knows the
 * token, which is the whole point: Debug Mode has no discoverable on-switch
 * left in the app itself (frontend/src/components/SettingsOverlay.jsx), so
 * this route is the only way to turn it on.
 *
 * Redirects to the frontend with the token in a URL FRAGMENT, not a query
 * param — fragments never leave the browser on navigation, so it never
 * lands in a server access log on that end. It DOES arrive here as a query
 * param, which is unavoidable for a plain link; that's an accepted
 * trade-off since only someone who already holds ADMIN_TOKEN can use this.
 */

import { NextRequest, NextResponse } from 'next/server'

const FRONTEND_ORIGIN = 'https://busgo-track.vercel.app'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token || !process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const redirectUrl = new URL(FRONTEND_ORIGIN)
  redirectUrl.hash = `admin_debug=${encodeURIComponent(token)}`
  return NextResponse.redirect(redirectUrl.toString(), 302)
}

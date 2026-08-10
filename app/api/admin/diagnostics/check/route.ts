/**
 * POST /api/admin/diagnostics/check
 *
 * Server-side "re-run all checks" — probes every endpoint once (in small
 * batches), records each result into the uptime tracker, and returns the
 * outcome. Admin-gated: this is deliberately NOT exposed to the public page
 * anymore, because a status page every visitor auto-triggers would hammer the
 * API (N visitors × M endpoints of self-probes).
 *
 * Unlike the background sweep (which stays read-only), this explicit admin
 * action also exercises the write-path endpoints (broadcast, incident report,
 * bug report, stop suggestion) — the admin chose to run it, so the phantom
 * test events it creates are expected and visible in the Issues/Suggestions
 * tabs.
 *
 * Returns the same results shape as the sweep, so the dashboard can show
 * "18/22 OK · 3 down" immediately and the uptime bars update in place.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { UptimeTracker } from '@/lib/api/uptime-tracker'
import { CacheService } from '@/lib/api/cache.service'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'admin')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }

  try {
    const results = await UptimeTracker.runProbes({ includeWritePaths: true })
    return NextResponse.json(
      {
        checkedAt: Date.now(),
        results,
        ok: results.filter((r) => r.status === 'ok').length,
        degraded: results.filter((r) => r.status === 'degraded').length,
        down: results.filter((r) => r.status === 'down').length,
      },
      { headers: { ...CORS, ...CacheService.noCacheHeaders() } }
    )
  } catch (error) {
    console.error('Diagnostics check error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

/**
 * POST /api/admin/maintenance   { feature, reason, active }
 * GET  /api/admin/maintenance
 *
 * Lets a developer flag a feature/endpoint as under maintenance while
 * debugging, so the status dashboard and the live frontend (via the
 * `system:maintenance` SSE frame + /api/status) can tell users not to
 * expect it to work right now instead of just erroring silently.
 *
 * In-memory (lib/api/maintenance-store.ts) — clears on redeploy/restart.
 */
import { NextRequest, NextResponse } from 'next/server'
import { MaintenanceStore } from '@/lib/api/maintenance-store'
import { CacheService } from '@/lib/api/cache.service'
import { PROCESS_STARTED_AT } from '@/lib/api/process-info'

export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false // refuse to operate with no token configured
  return request.headers.get('x-admin-token') === token
}

export async function GET() {
  return NextResponse.json(
    { flags: MaintenanceStore.getAll(), processStartedAt: PROCESS_STARTED_AT },
    { headers: CacheService.noCacheHeaders() }
  )
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { feature, reason, active } = body as { feature?: string; reason?: string; active?: boolean }

    if (!feature || typeof feature !== 'string') {
      return NextResponse.json({ error: 'feature is required' }, { status: 400 })
    }

    if (active === false) {
      MaintenanceStore.clear(feature)
    } else {
      MaintenanceStore.set(feature, reason || 'Under maintenance')
    }

    return NextResponse.json({ success: true, flags: MaintenanceStore.getAll() }, { headers: CacheService.noCacheHeaders() })
  } catch (error) {
    console.error('Maintenance admin API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * GET /api/uptime
 *
 * Per-endpoint uptime history for the Render-style 90-day bars on the public
 * status page and the admin dashboard. Reads the durable `uptime_checks`
 * table (hydrated on boot — lib/api/uptime-tracker.ts) and aggregates it into
 * per-day buckets. Public and read-only: it returns aggregated counts only,
 * never raw rows, and the underlying table is RLS-locked to service_role.
 */

import { NextResponse } from 'next/server'
import { UptimeTracker } from '@/lib/api/uptime-tracker'
import { CacheService } from '@/lib/api/cache.service'

export const dynamic = 'force-dynamic'

export async function GET() {
  await UptimeTracker.ensureHydrated()
  const days = 90
  return NextResponse.json(
    {
      days,
      endpoints: UptimeTracker.getAllHistory(days),
      ...UptimeTracker.getDurability(),
    },
    { headers: CacheService.noCacheHeaders() }
  )
}

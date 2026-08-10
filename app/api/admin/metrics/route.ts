import { NextRequest, NextResponse } from 'next/server'
import { RequestMetrics } from '@/lib/api/request-metrics'
import { cacheStats } from '@/lib/api/ttl-cache'
import { redisHealth } from '@/lib/api/redis'
import { getLiveSyncState } from '@/lib/api/live-sync'
import { LoadAlerts } from '@/lib/api/load-alerts'
import { TelemetryService, MAX_SSE_CONNECTIONS } from '@/lib/api/telemetry.service'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'

/**
 * GET /api/admin/metrics — live load view for the admin console.
 *
 * Admin-gated by middleware.ts (any /api/admin/* path requires a session).
 * Aggregates the in-memory RequestMetrics ring (request counts from
 * middleware, status + latency from route handlers), the SSE connection
 * gauge, and TTL-cache hit/miss stats.
 */
export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await requireRole(request, auth.email, 'admin')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const snapshot = RequestMetrics.snapshot()
  const cache = cacheStats()

  // Evaluate thresholds against this poll's totals — the Load panel watches
  // every 10 s, so alert episodes appear the moment someone is looking.
  LoadAlerts.evaluate(snapshot.totals)

  return NextResponse.json({
    ...snapshot,
    sse: {
      active: TelemetryService.activeSSEConnections,
      max: MAX_SSE_CONNECTIONS,
    },
    cache: {
      ...cache,
      hitRate: cache.hits + cache.misses > 0 ? cache.hits / (cache.hits + cache.misses) : 0,
    },
    redis: {
      connected: await redisHealth(),
      // Pub/sub bridge state — attached when this instance is sharing the
      // live vehicle store across instances.
      pubsub: getLiveSyncState(),
    },
    alerts: LoadAlerts.snapshot(),
  })
}

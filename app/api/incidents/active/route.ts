/**
 * GET /api/incidents/active
 *
 * Snapshot of currently-active (non-expired) incidents. Incidents were
 * previously only delivered over the SSE stream, so a client connecting
 * after a report never saw it — this fills that gap for late joiners
 * (docs/BACKEND_HANDOFF.md #8).
 */

import { NextRequest, NextResponse } from 'next/server'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { CacheService } from '@/lib/api/cache.service'
import { CORS, corsPreflight } from '@/lib/api/cors'
import { bareRouteId } from '@/lib/api/geo'
import { withRequestMetrics } from '@/lib/api/request-metrics'

export async function GET(request: NextRequest) {
  return withRequestMetrics('incidents.active', () => handleGet(request))
}

async function handleGet(request: NextRequest) {
  // Optional ?routes=101,105 — mirrors the SSE stream's scoping so a client
  // merging this snapshot with a scoped stream doesn't re-import the clutter
  // the stream just filtered out. Route-less incidents always pass.
  const routesParam = request.nextUrl.searchParams.get('routes')
  const routeFilter: Set<string> | null = routesParam
    ? new Set(routesParam.split(',').map((r) => bareRouteId(r.trim())).filter(Boolean))
    : null

  const incidents = LiveVehicleStore.getIncidents()
    .filter((inc) => !routeFilter || !inc.route_id || routeFilter.has(bareRouteId(inc.route_id)))
    .map((inc) => ({
    // Same id + reportedAt (ms) the SSE incident:alert frames carry, so a
    // client that merges this snapshot with the live stream dedups the same
    // incident to ONE entry instead of deriving a second identity for it.
    id: inc.id,
    reportedAt: inc.reportedAt,
    vehicle_id: inc.vehicle_id,
    route_id: inc.route_id,
    type: inc.type,
    description: inc.description,
    destination_stop_id: inc.destination_stop_id,
    lat: inc.lat,
    lon: inc.lon,
    reported_at: new Date(inc.reportedAt).toISOString(),
  }))

  return NextResponse.json(
    { incidents, total: incidents.length },
    { headers: { ...CORS, ...(CacheService.liveHeaders() as Record<string, string>) } }
  )
}

export async function OPTIONS() {
  return corsPreflight()
}

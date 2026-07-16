/**
 * GET /api/incidents/active
 *
 * Snapshot of currently-active (non-expired) incidents. Incidents were
 * previously only delivered over the SSE stream, so a client connecting
 * after a report never saw it — this fills that gap for late joiners
 * (docs/BACKEND_HANDOFF.md #8).
 */

import { NextResponse } from 'next/server'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { CacheService } from '@/lib/api/cache.service'
import { CORS, corsPreflight } from '@/lib/api/cors'

export async function GET() {
  const incidents = LiveVehicleStore.getIncidents().map((inc) => ({
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

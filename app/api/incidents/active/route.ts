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
    vehicleId: inc.vehicleId,
    routeId: inc.routeId,
    incidentType: inc.incidentType,
    description: inc.description,
    destinationStopId: inc.destinationStopId,
    lat: inc.lat,
    lng: inc.lng,
    reportedAt: new Date(inc.reportedAt).toISOString(),
  }))

  return NextResponse.json(
    { incidents, total: incidents.length },
    { headers: { ...CORS, ...(CacheService.liveHeaders() as Record<string, string>) } }
  )
}

export async function OPTIONS() {
  return corsPreflight()
}

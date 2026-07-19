/**
 * GET /api/vehicles/live
 *
 * Current vehicle positions from the shared realtime hub — the same state
 * the SSE stream broadcasts, so REST polls and the stream never disagree.
 * Crowdsourced broadcaster pings take precedence; simulation fills the rest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { VehicleSchema } from '@/lib/api/validation'
import { CacheService } from '@/lib/api/cache.service'
import { realtimeHub } from '@/lib/api/realtime-hub'
import { withLatencyTracking } from '@/lib/api/telemetry.service'
import { bareRouteId } from '@/lib/api/geo'
import { ErrorLog } from '@/lib/api/error-log'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withLatencyTracking(() => handleGet(request))
}

async function handleGet(request: NextRequest) {
  try {
    // Optional ?routes=101,105 and ?direction=0|1 — same scoping semantics
    // as the SSE stream, so a client polling this as a stream fallback gets
    // the same filtered view. Untagged vehicles pass the direction filter.
    const routesParam = request.nextUrl.searchParams.get('routes')
    const routeFilter: Set<string> | null = routesParam
      ? new Set(routesParam.split(',').map((r) => bareRouteId(r.trim())).filter(Boolean))
      : null
    const rawDirection = request.nextUrl.searchParams.get('direction')
    const directionFilter =
      rawDirection === '0' || rawDirection === '1' ? Number(rawDirection) : null

    const snapshot = realtimeHub.getSnapshot().filter((v) => {
      if (routeFilter && !routeFilter.has(v.route_id)) return false
      if (
        directionFilter !== null &&
        v.direction_id !== undefined &&
        v.direction_id !== directionFilter
      ) {
        return false
      }
      return true
    })
    const hasLive = snapshot.some((v) => v.live)

    // Validate through Zod
    const validated = snapshot.map((v) =>
      VehicleSchema.parse({
        id: v.id,
        route_id: v.route_id,
        lat: v.lat,
        lon: v.lon,
        brg: v.brg,
        spd: v.spd,
        occupancy: v.occupancy,
        live: v.live,
        reporters: v.reporters,
        direction_id: v.direction_id,
        destination_stop_id: v.destination_stop_id,
        plate: v.plate,
        operator: v.operator,
        driver: v.driver,
      })
    )

    return NextResponse.json(
      {
        vehicles: validated,
        metadata: {
          timestamp: new Date().toISOString(),
          freshness: 'live',
          source: hasLive ? 'crowdsourced_and_simulation' : 'simulation_engine',
        },
      },
      { headers: CacheService.liveHeaders() }
    )
  } catch (error) {
    console.error('Vehicles API Error:', error)
    ErrorLog.record({ path: '/api/vehicles/live', method: 'GET', status: 500, message: error instanceof Error ? error.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

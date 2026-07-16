/**
 * GET /api/vehicles/live
 *
 * Current vehicle positions from the shared realtime hub — the same state
 * the SSE stream broadcasts, so REST polls and the stream never disagree.
 * Crowdsourced broadcaster pings take precedence; simulation fills the rest.
 */

import { NextResponse } from 'next/server'
import { VehicleSchema } from '@/lib/api/validation'
import { CacheService } from '@/lib/api/cache.service'
import { realtimeHub } from '@/lib/api/realtime-hub'
import { withLatencyTracking } from '@/lib/api/telemetry.service'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withLatencyTracking(handleGet)
}

async function handleGet() {
  try {
    const snapshot = realtimeHub.getSnapshot()
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
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getAllStops } from '@/lib/api/stops-cache'
import { haversineMeters } from '@/lib/api/geo'
import { CacheService } from '@/lib/api/cache.service'
import { withRequestMetrics } from '@/lib/api/request-metrics'

// Hubs with coordinates — the route handler resolves these to real GTFS stop_ids
const HUB_DEFINITIONS = [
  {
    id: 'hub-nyabugogo',
    name: 'Nyabugogo Transit Hub',
    lat: -1.9367,
    lon: 30.0485,
    description: 'Major terminal',
  },
  {
    id: 'hub-downtown',
    name: 'Downtown City Center',
    lat: -1.9450,
    lon: 30.0590,
    description: 'Central hub',
  },
  {
    id: 'hub-remera',
    name: 'Remera Bus Park',
    lat: -1.9520,
    lon: 30.0920,
    description: 'East terminal',
  },
  {
    id: 'hub-kimironko',
    name: 'Kimironko Market Hub',
    lat: -1.9320,
    lon: 30.1050,
    description: 'Northeast hub',
  },
]

export async function GET() {
  return withRequestMetrics('gtfs.hubs', () => handleGet())
}

async function handleGet() {
  try {
    const allStops = await getAllStops()

    // Resolve each hub to the nearest real GTFS stop
    const hubs = HUB_DEFINITIONS.map(hub => {
      let nearestId: string | null = null
      let nearestDist = Infinity

      for (const stop of allStops) {
        const dist = haversineMeters(hub.lat, hub.lon, stop.lat, stop.lon)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestId = stop.id
        }
      }

      return {
        id: nearestId || hub.id, // Use real GTFS stop_id, fallback to synthetic
        name: hub.name,
        description: hub.description,
        lat: hub.lat,
        lon: hub.lon,
        type: 'hub',
      }
    })

    return NextResponse.json(
      { hubs, metadata: { source: 'gtfs_resolved', total: hubs.length } },
      { headers: CacheService.staticHeaders() }
    )
  } catch (err) {
    console.error('[GET /api/gtfs/hubs] Unexpected error:', err)
    return NextResponse.json(
      { hubs: HUB_DEFINITIONS, metadata: { source: 'static_fallback', total: HUB_DEFINITIONS.length } },
      { headers: CacheService.staticHeaders() }
    )
  }
}

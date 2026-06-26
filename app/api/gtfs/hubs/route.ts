import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { CacheService } from '@/lib/api/cache.service'

// Hubs with coordinates — the route handler resolves these to real GTFS stop_ids
const HUB_DEFINITIONS = [
  {
    id: 'hub-nyabugogo',
    name: 'Nyabugogo Transit Hub',
    latitude: -1.9367,
    longitude: 30.0485,
    description: 'Major terminal',
  },
  {
    id: 'hub-downtown',
    name: 'Downtown City Center',
    latitude: -1.9450,
    longitude: 30.0590,
    description: 'Central hub',
  },
  {
    id: 'hub-remera',
    name: 'Remera Bus Park',
    latitude: -1.9520,
    longitude: 30.0920,
    description: 'East terminal',
  },
  {
    id: 'hub-kimironko',
    name: 'Kimironko Market Hub',
    latitude: -1.9320,
    longitude: 30.1050,
    description: 'Northeast hub',
  },
]

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function GET() {
  try {
    const supabase = getSupabaseServer()

    // Fetch all stops to resolve hubs to real GTFS stop_ids
    const { data: allStops, error } = await supabase
      .from('stops')
      .select('stop_id, stop_name, stop_lat, stop_lon')
      .not('stop_lat', 'is', null)
      .not('stop_lon', 'is', null)

    if (error) {
      console.warn('[hubs] Supabase error, returning hubs without resolved stops:', error.message)
      // Fallback: return hubs without resolved stop IDs
      return NextResponse.json(
        { hubs: HUB_DEFINITIONS, metadata: { source: 'static_hubs_unresolved', total: HUB_DEFINITIONS.length } },
        { headers: CacheService.staticHeaders() }
      )
    }

    // Resolve each hub to the nearest real GTFS stop
    const hubs = HUB_DEFINITIONS.map(hub => {
      let nearestId: string | null = null
      let nearestDist = Infinity

      for (const stop of allStops ?? []) {
        const dist = haversineMeters(hub.latitude, hub.longitude, stop.stop_lat as number, stop.stop_lon as number)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestId = String(stop.stop_id)
        }
      }

      return {
        id: nearestId || hub.id, // Use real GTFS stop_id, fallback to synthetic
        name: hub.name,
        description: hub.description,
        latitude: hub.latitude,
        longitude: hub.longitude,
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

import { supabase } from '@/lib/supabase'
import { haversineMeters, walkingMinutes } from './geo'
import { getCanonicalStops } from './stops-cache'
import { getRoutesServingStop } from './gtfs-parser'

// Canonical stop shape (docs/BACKEND_HANDOFF.md #4): id/name/lat/lon/type,
// plus walking-distance extras. Not the legacy `BusStop` (latitude/longitude)
// used by the deprecated mock-data path in lib/kigali-gtfs.ts.
interface StopResult {
  id: string
  name: string
  lat: number
  lon: number
  type: 'stop'
  walkingDistance: number
  walkingMeters: number
  routes?: string[]
}

export class SpatialService {
  /**
   * Fetch nearby stops using the PostGIS `get_nearby_stops` RPC
   * (see scripts/enable_postgis.mjs). Falls back to the in-memory stops
   * cache with a proper haversine scan when the RPC isn't deployed.
   */
  static async getNearbyStops(lat: number, lng: number, radiusMeters: number, limit: number): Promise<StopResult[]> {
    try {
      const { data, error } = await supabase.rpc('get_nearby_stops', {
        user_lat: lat,
        user_lon: lng,
        radius_meters: radiusMeters,
        max_results: limit
      })

      if (error) {
        throw error
      }

      return data.map((stop: any) => ({
        id: stop.stop_id,
        name: stop.stop_name,
        lat: stop.lat,
        lon: stop.lon,
        type: 'stop' as const,
        walkingDistance: walkingMinutes(stop.distance_meters),
        walkingMeters: Math.round(stop.distance_meters)
      }))
    } catch (error) {
      console.warn('PostGIS RPC failed. Falling back to in-memory stops cache:', error)

      const stops = await getCanonicalStops()
      return stops
        .map((s) => {
          const dist = haversineMeters(lat, lng, s.lat, s.lon)
          return {
            id: s.id,
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            type: 'stop' as const,
            walkingMeters: Math.round(dist),
            walkingDistance: walkingMinutes(dist),
          }
        })
        .filter((s) => s.walkingMeters <= radiusMeters)
        .sort((a, b) => a.walkingMeters - b.walkingMeters)
        .slice(0, limit)
    }
  }

  /**
   * Search stops by name. Backed by a pg_trgm GIN index on stops.stop_name
   * (supabase/migrations/0004_gtfs_indexes.sql) so the leading-wildcard
   * ILIKE below can use an index scan instead of a full table scan. Route
   * badges come from the real GTFS stop_times → trips → routes index
   * (previously this decorated results with a hardcoded mock mapping that
   * never matched real stop IDs).
   */
  static async searchStops(query: string, limit: number = 5): Promise<StopResult[]> {
    // Curator soft-state (migration 0014): merged + hidden stops never appear
    // in public search. Falls back to the plain query if the migration isn't
    // applied yet on an older deploy.
    let result = await supabase
      .from('stops')
      .select('stop_id, stop_name, stop_lat, stop_lon')
      .ilike('stop_name', `%${query}%`)
      .eq('status', 'active')
      .limit(limit)
    if (result.error) {
      result = await supabase
        .from('stops')
        .select('stop_id, stop_name, stop_lat, stop_lon')
        .ilike('stop_name', `%${query}%`)
        .limit(limit)
    }
    const { data, error } = result
    if (error) throw error

    return Promise.all(
      (data || []).map(async (s) => {
        let routeNumbers: string[] = []
        try {
          routeNumbers = (await getRoutesServingStop(String(s.stop_id))).map((r) => r.number)
        } catch {
          // GTFS files unavailable — suggestions still work, just without route badges
        }
        return {
          id: s.stop_id,
          name: s.stop_name,
          lat: s.stop_lat,
          lon: s.stop_lon,
          type: 'stop' as const,
          walkingDistance: 0,
          walkingMeters: 0,
          routes: routeNumbers,
        }
      })
    )
  }
}

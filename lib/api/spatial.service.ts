import { supabase } from '@/lib/supabase'
import { BusStop } from '@/lib/types'
import { haversineMeters, walkingMinutes } from './geo'
import { getCanonicalStops } from './stops-cache'
import { getRoutesServingStop } from './gtfs-parser'

export class SpatialService {
  /**
   * Fetch nearby stops using the PostGIS `get_nearby_stops` RPC
   * (see scripts/enable_postgis.mjs). Falls back to the in-memory stops
   * cache with a proper haversine scan when the RPC isn't deployed.
   */
  static async getNearbyStops(lat: number, lng: number, radiusMeters: number, limit: number): Promise<BusStop[]> {
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
        latitude: stop.lat,
        longitude: stop.lon,
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
            latitude: s.lat,
            longitude: s.lon,
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
   * Search stops by name. Route badges come from the real GTFS
   * stop_times → trips → routes index (previously this decorated results
   * with a hardcoded mock mapping that never matched real stop IDs).
   */
  static async searchStops(query: string, limit: number = 5): Promise<BusStop[]> {
    const { data, error } = await supabase
      .from('stops')
      .select('stop_id, stop_name, stop_lat, stop_lon')
      .ilike('stop_name', `%${query}%`)
      .limit(limit)

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
          latitude: s.stop_lat,
          longitude: s.stop_lon,
          walkingDistance: 0,
          walkingMeters: 0,
          routes: routeNumbers,
        } as any // routes is an extension of the BusStop shape
      })
    )
  }
}

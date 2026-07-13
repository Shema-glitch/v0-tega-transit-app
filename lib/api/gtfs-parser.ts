import fs from 'fs/promises'
import path from 'path'
import { parse } from 'csv-parse/sync'
import { haversineMeters } from './geo'

// In-memory cache: GTFS files are parsed once per server instance
let tripsCache: any[] | null = null
let stopTimesCache: any[] | null = null
let routesCache: any[] | null = null
let stopsCache: Map<string, any> | null = null
let stopIdMap: Map<string, string> | null = null

// Derived index: stop_id → Set of route_ids serving it (built lazily)
let stopRoutesIndex: Map<string, Set<string>> | null = null

let loadPromise: Promise<void> | null = null

function parseCsv(content: string): any[] {
  return parse(content, { columns: true, skip_empty_lines: true, trim: true })
}

// Lazy loader — concurrent callers share one in-flight load
async function loadGtfsData() {
  if (tripsCache && stopTimesCache && stopsCache && stopIdMap && routesCache) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const gtfsDir = path.join(process.cwd(), 'kigali_gtfs')

    const [tripsRaw, stopTimesRaw, stopsRaw, routesRaw] = await Promise.all([
      fs.readFile(path.join(gtfsDir, 'trips.txt'), 'utf-8'),
      fs.readFile(path.join(gtfsDir, 'stop_times.txt'), 'utf-8'),
      fs.readFile(path.join(gtfsDir, 'stops.txt'), 'utf-8'),
      fs.readFile(path.join(gtfsDir, 'routes.txt'), 'utf-8'),
    ])

    tripsCache = parseCsv(tripsRaw)
    stopTimesCache = parseCsv(stopTimesRaw)
    routesCache = parseCsv(routesRaw)

    const parsedStops = parseCsv(stopsRaw)
    stopsCache = new Map()
    for (const stop of parsedStops) {
      if (stop.stop_id) {
        stopsCache.set(stop.stop_id, stop)
      }
    }

    // Build stopIdMap to redirect duplicate stop_ids to their primary representation
    const stopsList = parsedStops.filter((s: any) => s.stop_id && s.stop_lat && s.stop_lon)
    stopIdMap = new Map()
    const primaryStops: any[] = []

    for (const stop of stopsList) {
      const lat = parseFloat(stop.stop_lat)
      const lon = parseFloat(stop.stop_lon)
      if (isNaN(lat) || isNaN(lon)) continue

      const duplicate = primaryStops.find(
        (existing) => haversineMeters(parseFloat(existing.stop_lat), parseFloat(existing.stop_lon), lat, lon) < 50
      )

      if (duplicate) {
        stopIdMap.set(stop.stop_id, duplicate.stop_id)
      } else {
        primaryStops.push(stop)
        stopIdMap.set(stop.stop_id, stop.stop_id)
      }
    }
  })().finally(() => {
    loadPromise = null
  })

  return loadPromise
}

export async function getRouteSequence(routeId: string, directionId: string = '0') {
  try {
    await loadGtfsData()
  } catch (error) {
    console.error('Failed to load GTFS files:', error)
    throw new Error('GTFS data unavailable')
  }

  // 1. Find a matching trip for the route and direction
  // Note: GTFS sometimes pads string IDs or lacks direction_id, so we fallback safely
  let trip = tripsCache!.find(t => t.route_id === routeId && t.direction_id === directionId)

  if (!trip) {
    // Fallback: Just get the first trip for this route regardless of direction
    trip = tripsCache!.find(t => t.route_id === routeId)
  }

  if (!trip) {
    return null
  }

  const targetTripId = trip.trip_id

  // 2. Find all stop_times for this trip
  const tripStops = stopTimesCache!.filter(st => st.trip_id === targetTripId)

  // 3. Sort correctly by stop_sequence
  tripStops.sort((a, b) => parseInt(a.stop_sequence || '0') - parseInt(b.stop_sequence || '0'))

  // 4. Map to actual stop details and resolve primary stop IDs
  const rawSequence = tripStops.map(st => {
    const primaryStopId = stopIdMap!.get(st.stop_id) || st.stop_id
    const stopInfo = stopsCache!.get(primaryStopId)
    return {
      stopSequence: parseInt(st.stop_sequence || '0'),
      stopId: primaryStopId,
      name: stopInfo?.stop_name || 'Unknown Stop',
      lat: parseFloat(stopInfo?.stop_lat || '0'),
      lng: parseFloat(stopInfo?.stop_lon || '0')
    }
  })

  // Deduplicate adjacent duplicate stop nodes in the timeline
  const sequence: typeof rawSequence = []
  for (const node of rawSequence) {
    if (sequence.length === 0 || sequence[sequence.length - 1].stopId !== node.stopId) {
      sequence.push({
        ...node,
        stopSequence: sequence.length + 1 // normalize sequence numbering
      })
    }
  }

  return {
    routeId,
    directionId: trip.direction_id || 'unknown',
    tripId: targetTripId,
    sequence,
    metadata: {
      source: 'gtfs_real_data',
      stopCount: sequence.length
    }
  }
}

/**
 * All routes serving a given stop, resolved via stop_times → trips → routes.
 * The stop→routes index is built once and reused across requests.
 */
export async function getRoutesServingStop(
  stopId: string
): Promise<{ id: string; number: string; name: string; color: string }[]> {
  await loadGtfsData()

  if (!stopRoutesIndex) {
    const tripToRoute = new Map<string, string>()
    for (const t of tripsCache!) {
      tripToRoute.set(t.trip_id, t.route_id)
    }

    stopRoutesIndex = new Map()
    for (const st of stopTimesCache!) {
      const routeId = tripToRoute.get(st.trip_id)
      if (!routeId) continue
      let set = stopRoutesIndex.get(st.stop_id)
      if (!set) {
        set = new Set()
        stopRoutesIndex.set(st.stop_id, set)
      }
      set.add(routeId)
    }
  }

  const routeIds = stopRoutesIndex.get(stopId)
  if (!routeIds || routeIds.size === 0) return []

  return routesCache!
    .filter((r: any) => routeIds.has(r.route_id))
    .map((route: any) => ({
      id: route.route_id,
      number: route.route_short_name,
      name: route.route_long_name,
      color: route.route_color ? `#${route.route_color}` : '#00a896',
    }))
}

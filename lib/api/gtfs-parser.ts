import fs from 'fs/promises'
import path from 'path'

// In-memory cache to ensure "smart" and fast reads
let tripsCache: any[] | null = null
let stopTimesCache: any[] | null = null
let stopsCache: Map<string, any> | null = null

// Simple CSV Parser
function parseCsv(content: string) {
  const lines = content.trim().split('\n')
  if (lines.length === 0) return []
  const headers = lines[0].split(',').map(h => h.trim())
  
  return lines.slice(1).map(line => {
    const values = line.split(',')
    const obj: Record<string, string> = {}
    headers.forEach((header, index) => {
      // Remove carriage returns if present
      obj[header] = values[index]?.trim().replace(/\r$/, '')
    })
    return obj
  })
}

// Lazy loader
async function loadGtfsData() {
  if (tripsCache && stopTimesCache && stopsCache) return

  const gtfsDir = path.join(process.cwd(), 'kigali_gtfs')
  
  const [tripsRaw, stopTimesRaw, stopsRaw] = await Promise.all([
    fs.readFile(path.join(gtfsDir, 'trips.txt'), 'utf-8'),
    fs.readFile(path.join(gtfsDir, 'stop_times.txt'), 'utf-8'),
    fs.readFile(path.join(gtfsDir, 'stops.txt'), 'utf-8')
  ])

  tripsCache = parseCsv(tripsRaw)
  stopTimesCache = parseCsv(stopTimesRaw)
  
  const parsedStops = parseCsv(stopsRaw)
  stopsCache = new Map()
  for (const stop of parsedStops) {
    if (stop.stop_id) {
      stopsCache.set(stop.stop_id, stop)
    }
  }
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

  // 4. Map to actual stop details
  const sequence = tripStops.map(st => {
    const stopInfo = stopsCache!.get(st.stop_id)
    return {
      stopSequence: parseInt(st.stop_sequence || '0'),
      stopId: st.stop_id,
      name: stopInfo?.stop_name || 'Unknown Stop',
      lat: parseFloat(stopInfo?.stop_lat || '0'),
      lng: parseFloat(stopInfo?.stop_lon || '0')
    }
  })

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

import { NextRequest } from 'next/server'
import { kigaliRoutes, calculateDistance } from '@/lib/kigali-gtfs'
import { TelemetryService } from '@/lib/api/telemetry.service'
import { Vehicle } from '@/lib/api/validation'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { truncateGeo } from '@/lib/api/compression'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Connection limiting to prevent OOM
  if (TelemetryService.activeSSEConnections >= 100) {
    return new Response(JSON.stringify({ error: 'Too Many Connections' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const searchParams = request.nextUrl.searchParams
  const userLat = parseFloat(searchParams.get('lat') || '0')
  const userLng = parseFloat(searchParams.get('lng') || '0')
  const radius = parseFloat(searchParams.get('radius') || '2000')

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const clientId = crypto.randomUUID()

  console.log(`[SSE] Client connected: ${clientId} | Region: [${userLat}, ${userLng}] | Radius: ${radius}m`)
  TelemetryService.clientConnected()

  // State map to track previous payloads for delta calculation
  const clientVehicleState = new Map<string, Vehicle>()

  // Track which routes this client is viewing (for viewer counts)
  const clientViewingRoutes = new Set<string>()

  // Send initial connection success event
  writer.write(encoder.encode('event: connected\ndata: {"status": "streaming_deltas"}\n\n'))

  // Helper function to broadcast only what has changed
  const broadcastDeltas = () => {
    try {
      const updates: Partial<Vehicle>[] = []
      
      // Simulate moving buses around the city
      kigaliRoutes.forEach((route, i) => {
        const vehicleId = `bus-${route.id}-active`
        
        let newLat, newLng, newSpeed, newBearing;
        
        // Check if there is a live crowdsourced ping for this route
        const liveBuses = LiveVehicleStore.getVehicles().filter(v => v.routeId === route.id)
        if (liveBuses.length > 0) {
          // Use crowdsourced data directly
          const liveBus = liveBuses[0]
          newLat = truncateGeo(liveBus.lat, 5)
          newLng = truncateGeo(liveBus.lng, 5)
          newSpeed = liveBus.speedKmh
          newBearing = liveBus.heading || 0
        } else {
          // Mock realtime movement for simulation purposes
          newLat = truncateGeo(-1.9536 + (Math.random() - 0.5) * 0.05, 5)
          newLng = truncateGeo(30.0605 + (Math.random() - 0.5) * 0.05, 5)
          newSpeed = Math.floor(Math.random() * 45) + 15
          newBearing = Math.floor(Math.random() * 360)
        }

        // Check if vehicle is inside user's requested region
        const distanceToUser = (userLat && userLng) 
          ? calculateDistance(userLat, userLng, newLat, newLng) 
          : 0
          
        const isNearby = distanceToUser <= radius

        // Create the new full vehicle state internally
        const nextState: Vehicle = {
          id: vehicleId,
          routeId: route.id,
          lat: newLat,
          lng: newLng,
          brg: newBearing,
          spd: newSpeed,
          occupancy: liveBuses.length > 0 ? 'full' : (i % 3 === 0 ? 'full' : 'standing_room_only'),
        }

        const prevState = clientVehicleState.get(vehicleId)
        let hasSignificantChange = false

        if (!prevState) {
          hasSignificantChange = true
        } else {
          // Delta logic: Only send if moved significantly, or speed/bearing changed drastically
          const movedMeters = calculateDistance(prevState.lat, prevState.lng, newLat, newLng)
          if (movedMeters > 5 || Math.abs(prevState.brg - newBearing) > 5) {
            hasSignificantChange = true
          }
        }

        if (hasSignificantChange) {
          clientVehicleState.set(vehicleId, nextState)
          
          // Only send essential deltas over the wire (omit static fields)
          const deltaPayload: Partial<Vehicle> = {
            id: vehicleId,
            lat: newLat,
            lng: newLng,
            brg: newBearing,
            spd: newSpeed
          }
          
          // Include static fields ONLY on the first broadcast to this client
          if (!prevState) {
            deltaPayload.routeId = route.id
            deltaPayload.occupancy = nextState.occupancy
            
            // Track viewer for this route
            clientViewingRoutes.add(route.id)
            LiveVehicleStore.addViewer(route.id, clientId)
            // Include broadcaster-submitted vehicle info if available
            const liveBus = liveBuses[0]
            if (liveBus) {
              if (liveBus.plate) deltaPayload.plate = liveBus.plate
              if (liveBus.occupancy) deltaPayload.occupancy = liveBus.occupancy
              if (liveBus.operator) deltaPayload.operator = liveBus.operator
              if (liveBus.driver) deltaPayload.driver = liveBus.driver
            }
          }
          
          updates.push(deltaPayload)
        }
      })

      if (updates.length > 0) {
        const payload = JSON.stringify({ type: 'vehicle:update', vehicles: updates })
        const encoded = encoder.encode(`event: message\ndata: ${payload}\n\n`)
        writer.write(encoded)

        // Telemetry
        TelemetryService.recordSSEMessage(encoded.byteLength)
      }

      // Send viewer counts for all routes with active broadcasters
      const viewerCounts = LiveVehicleStore.getAllViewerCounts()
      if (Object.keys(viewerCounts).length > 0) {
        const viewerPayload = JSON.stringify({ type: 'viewer:counts', counts: viewerCounts })
        const encoded = encoder.encode(`event: message\ndata: ${viewerPayload}\n\n`)
        writer.write(encoded)
      }

      // Check for active incidents and broadcast if they are nearby
      const allIncidents = LiveVehicleStore.getIncidents()
      const relevantIncidents = allIncidents.filter(inc => {
        const distanceToUser = (userLat && userLng) 
          ? calculateDistance(userLat, userLng, inc.lat, inc.lng) 
          : 0
        return distanceToUser <= radius
      })

      if (relevantIncidents.length > 0) {
        // Format incident message
        const incidentPayload = relevantIncidents.map(inc => ({
          vehicleId: inc.vehicleId,
          routeId: inc.routeId,
          incidentType: inc.incidentType,
          message: `Alert — Bus ${inc.routeId} reported ${inc.incidentType.replace('_', ' ')}.`
        }))
        const payload = JSON.stringify({ type: 'incident:alert', incidents: incidentPayload })
        const encoded = encoder.encode(`event: message\ndata: ${payload}\n\n`)
        writer.write(encoded)
        TelemetryService.recordSSEMessage(encoded.byteLength)
      }
    } catch (error) {
      console.error(`[SSE] Broadcast error for ${clientId}:`, error)
    }
  }

  // Dual-Loop Priority Architecture
  // 1. High Priority (2 seconds): We normally only process nearby vehicles in a real DB
  // 2. Low Priority (10 seconds): distant vehicles. 
  // For this simulation, we use a single fast loop but filter by delta.
  const intervalId = setInterval(broadcastDeltas, 2000)

  // Handle client disconnect — clean up viewer tracking
  request.signal.addEventListener('abort', () => {
    console.log(`[SSE] Client disconnected: ${clientId}`)
    clearInterval(intervalId)
    // Remove this client from all route viewer counts
    for (const routeId of clientViewingRoutes) {
      LiveVehicleStore.removeViewer(routeId, clientId)
    }
    TelemetryService.clientDisconnected()
    writer.close().catch(() => {})
  })

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

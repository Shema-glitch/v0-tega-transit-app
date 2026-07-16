/**
 * GET /api/realtime/sse
 *
 * Server-Sent Events stream of vehicle position deltas, viewer counts, and
 * nearby incident alerts.
 *
 * Vehicle state comes from the shared realtime hub (one simulation/ingest
 * loop per process, regardless of client count). This handler only does the
 * per-client work: region filtering, delta compression against the client's
 * last-known state, and viewer tracking.
 *
 * Wire protocol (unchanged):
 *   event: connected  → {"status": "streaming_deltas"}
 *   event: message    → { type: 'vehicle:update', vehicles: Partial<Vehicle>[] }
 *   event: message    → { type: 'viewer:counts', counts: Record<routeId, number> }
 *   event: message    → { type: 'incident:alert', incidents: [...] }
 */

import { NextRequest } from 'next/server'
import { haversineMeters } from '@/lib/api/geo'
import { TelemetryService } from '@/lib/api/telemetry.service'
import { Vehicle } from '@/lib/api/validation'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { realtimeHub, HubVehicle } from '@/lib/api/realtime-hub'

export const dynamic = 'force-dynamic'

const MAX_CONNECTIONS = 100
// Kigali city center — used when a client omits lat/lng so the stream isn't
// silently empty forever (docs/BACKEND_HANDOFF.md #5).
const DEFAULT_LAT = -1.9536
const DEFAULT_LNG = 30.0605
const DEFAULT_RADIUS = 15000

export async function GET(request: NextRequest) {
  // Connection limiting to prevent OOM
  if (TelemetryService.activeSSEConnections >= MAX_CONNECTIONS) {
    return new Response(JSON.stringify({ error: 'Too Many Connections' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const searchParams = request.nextUrl.searchParams
  const rawLat = parseFloat(searchParams.get('lat') || '')
  const rawLng = parseFloat(searchParams.get('lng') || '')
  const userLat = Number.isFinite(rawLat) ? rawLat : DEFAULT_LAT
  const userLng = Number.isFinite(rawLng) ? rawLng : DEFAULT_LNG
  const radius = parseFloat(searchParams.get('radius') || String(DEFAULT_RADIUS))

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const clientId = crypto.randomUUID()

  console.log(`[SSE] Client connected: ${clientId} | Region: [${userLat}, ${userLng}] | Radius: ${radius}m`)
  TelemetryService.clientConnected()

  // Per-client state for delta calculation
  const clientVehicleState = new Map<string, Vehicle>()
  // Routes this client is viewing (for viewer counts)
  const clientViewingRoutes = new Set<string>()

  writer.write(encoder.encode('event: connected\ndata: {"status": "streaming_deltas"}\n\n'))

  const send = (payload: object) => {
    const encoded = encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
    writer.write(encoded)
    TelemetryService.recordSSEMessage(encoded.byteLength)
  }

  // Called by the hub on every shared tick
  const onTick = (vehicles: HubVehicle[]) => {
    try {
      const updates: Partial<Vehicle>[] = []

      for (const v of vehicles) {
        const nextState: Vehicle = {
          id: v.id,
          route_id: v.route_id,
          lat: v.lat,
          lon: v.lon,
          brg: v.brg,
          spd: v.spd,
          occupancy: v.occupancy,
        }

        const prevState = clientVehicleState.get(v.id)
        let hasSignificantChange = false

        if (!prevState) {
          hasSignificantChange = true
        } else {
          // Delta logic: only send if moved significantly or bearing changed drastically
          const movedMeters = haversineMeters(prevState.lat, prevState.lon, v.lat, v.lon)
          if (movedMeters > 5 || Math.abs((prevState.brg ?? 0) - v.brg) > 5) {
            hasSignificantChange = true
          }
        }

        if (!hasSignificantChange) continue
        clientVehicleState.set(v.id, nextState)

        // Only send essential deltas over the wire (omit static fields)
        const deltaPayload: Partial<Vehicle> = {
          id: v.id,
          lat: v.lat,
          lon: v.lon,
          brg: v.brg,
          spd: v.spd,
        }

        // Include static fields ONLY on the first broadcast to this client
        if (!prevState) {
          deltaPayload.route_id = v.route_id
          deltaPayload.occupancy = v.occupancy

          // Track viewer for this route
          clientViewingRoutes.add(v.route_id)
          LiveVehicleStore.addViewer(v.route_id, clientId)

          // Broadcaster-submitted vehicle info if available
          if (v.plate) deltaPayload.plate = v.plate
          if (v.operator) deltaPayload.operator = v.operator
          if (v.driver) deltaPayload.driver = v.driver
        }

        updates.push(deltaPayload)
      }

      if (updates.length > 0) {
        send({ type: 'vehicle:update', vehicles: updates })
      }

      // Viewer counts for all routes with active viewers.
      // `viewers` is the shape the frontend actually listens for; `counts` is
      // kept for back-compat with anything relying on the original shape.
      const viewerCounts = LiveVehicleStore.getAllViewerCounts()
      if (Object.keys(viewerCounts).length > 0) {
        send({ type: 'viewer:counts', counts: viewerCounts, viewers: viewerCounts })
      }

      // Active incidents within the client's region.
      // Incidents without coordinates (e.g. "missing_stop" reports) have no
      // location to filter by, so they're always included.
      const relevantIncidents = LiveVehicleStore.getIncidents().filter((inc) => {
        if (inc.lat === undefined || inc.lon === undefined) return true
        return haversineMeters(userLat, userLng, inc.lat, inc.lon) <= radius
      })

      if (relevantIncidents.length > 0) {
        send({
          type: 'incident:alert',
          incidents: relevantIncidents.map((inc) => ({
            vehicle_id: inc.vehicle_id,
            route_id: inc.route_id,
            type: inc.type,
            description: inc.description,
            message: inc.route_id
              ? `Alert — Bus ${inc.route_id} reported ${inc.type.replace('_', ' ')}.`
              : `Alert — ${inc.type.replace('_', ' ')} reported.`,
          })),
        })
      }
    } catch (error) {
      console.error(`[SSE] Broadcast error for ${clientId}:`, error)
    }
  }

  const unsubscribe = realtimeHub.subscribe(onTick)

  // Handle client disconnect — clean up viewer tracking and hub subscription
  request.signal.addEventListener('abort', () => {
    console.log(`[SSE] Client disconnected: ${clientId}`)
    unsubscribe()
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

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
 *   event: message    → { type: 'system:maintenance', flags: [{feature, reason, since}] }
 *
 * Optional scoping params (reduce clutter for a rider waiting at a stop):
 *   ?routes=101,105  → vehicle + incident frames only for these routes
 *                      (incidents without a route are always included)
 *   ?direction=0|1   → additionally hide vehicles explicitly tagged with the
 *                      OTHER direction (untagged vehicles still stream)
 * Omit both for the original everything-in-region behavior.
 */

import { NextRequest } from 'next/server'
import { haversineMeters, bareRouteId } from '@/lib/api/geo'
import { TelemetryService } from '@/lib/api/telemetry.service'
import { Vehicle } from '@/lib/api/validation'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { realtimeHub, HubVehicle } from '@/lib/api/realtime-hub'
import { MaintenanceStore } from '@/lib/api/maintenance-store'

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
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const searchParams = request.nextUrl.searchParams
  const rawLat = parseFloat(searchParams.get('lat') || '')
  const rawLng = parseFloat(searchParams.get('lng') || '')
  const userLat = Number.isFinite(rawLat) ? rawLat : DEFAULT_LAT
  const userLng = Number.isFinite(rawLng) ? rawLng : DEFAULT_LNG
  const radius = parseFloat(searchParams.get('radius') || String(DEFAULT_RADIUS))

  // Optional scoping: only stream what this rider actually cares about
  const routesParam = searchParams.get('routes')
  const routeFilter: Set<string> | null = routesParam
    ? new Set(routesParam.split(',').map((r) => bareRouteId(r.trim())).filter(Boolean))
    : null
  const rawDirection = searchParams.get('direction')
  const directionFilter = rawDirection === '0' || rawDirection === '1' ? Number(rawDirection) : null

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
  // Last maintenance snapshot sent to THIS client, so we only push on change
  // (including the transition back to zero flags — see note below)
  let lastMaintenanceJSON: string | null = null

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
        // Scoping: a rider watching route 101 direction 0 shouldn't get the
        // whole city's buses. Vehicles without an explicit direction tag are
        // never hidden by the direction filter — unknown ≠ irrelevant.
        if (routeFilter && !routeFilter.has(v.route_id)) continue
        if (
          directionFilter !== null &&
          v.direction_id !== undefined &&
          v.direction_id !== directionFilter
        ) {
          continue
        }

        const nextState: Vehicle = {
          id: v.id,
          route_id: v.route_id,
          lat: v.lat,
          lon: v.lon,
          brg: v.brg,
          spd: v.spd,
          occupancy: v.occupancy,
          reporters: v.reporters,
        }

        const prevState = clientVehicleState.get(v.id)
        let hasSignificantChange = false

        if (!prevState) {
          hasSignificantChange = true
        } else {
          // Delta logic: only send if moved significantly, bearing changed
          // drastically, or the co-riding broadcaster count changed
          const movedMeters = haversineMeters(prevState.lat, prevState.lon, v.lat, v.lon)
          if (
            movedMeters > 5 ||
            Math.abs((prevState.brg ?? 0) - v.brg) > 5 ||
            prevState.reporters !== v.reporters
          ) {
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
        if (v.reporters !== undefined) deltaPayload.reporters = v.reporters

        // Include static fields ONLY on the first broadcast to this client
        if (!prevState) {
          deltaPayload.route_id = v.route_id
          deltaPayload.occupancy = v.occupancy
          deltaPayload.live = v.live

          // Track viewer for this route
          clientViewingRoutes.add(v.route_id)
          LiveVehicleStore.addViewer(v.route_id, clientId)

          // Broadcaster-submitted vehicle + journey info if available
          if (v.plate) deltaPayload.plate = v.plate
          if (v.operator) deltaPayload.operator = v.operator
          if (v.driver) deltaPayload.driver = v.driver
          if (v.direction_id !== undefined) deltaPayload.direction_id = v.direction_id
          if (v.destination_stop_id) deltaPayload.destination_stop_id = v.destination_stop_id
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

      // Active incidents within the client's region (and route scope, when
      // the client asked for one — a rider waiting on 101 shouldn't get 105's
      // detour alerts). Incidents without coordinates (e.g. "missing_stop"
      // reports) have no location to filter by, so they pass the region
      // check; incidents without a route pass the route check.
      const relevantIncidents = LiveVehicleStore.getIncidents().filter((inc) => {
        if (routeFilter && inc.route_id && !routeFilter.has(bareRouteId(inc.route_id))) {
          return false
        }
        if (inc.lat === undefined || inc.lon === undefined) return true
        return haversineMeters(userLat, userLng, inc.lat, inc.lon) <= radius
      })

      if (relevantIncidents.length > 0) {
        send({
          type: 'incident:alert',
          incidents: relevantIncidents.map((inc) => ({
            // Server id + timestamp so clients can dedup/dismiss on a real
            // identity instead of deriving one (a derived id made "dismiss"
            // silently swallow every later incident of the same type).
            id: inc.id,
            reportedAt: inc.reportedAt,
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

      // Maintenance flags — sent on connect and again only when the set
      // changes, INCLUDING the transition back to an empty array. Unlike
      // incidents/viewers above, this must fire on the empty case too, or a
      // client would never learn a flag was cleared and would show a stale
      // "under maintenance" notice forever.
      const maintenanceFlags = MaintenanceStore.getAll()
      const maintenanceJSON = JSON.stringify(maintenanceFlags)
      if (maintenanceJSON !== lastMaintenanceJSON) {
        lastMaintenanceJSON = maintenanceJSON
        send({ type: 'system:maintenance', flags: maintenanceFlags })
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

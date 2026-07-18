/**
 * Shared realtime vehicle hub.
 *
 * Previously every SSE connection ran its own setInterval and re-simulated
 * every vehicle independently (N clients = N simulations, each with divergent
 * positions). The hub runs ONE simulation/ingest loop and fans the resulting
 * snapshot out to subscribers; per-client concerns (region filtering, delta
 * compression, viewer tracking) stay in the connection handler.
 *
 * The loop only runs while there is at least one subscriber. REST consumers
 * (e.g. /api/vehicles/live) use getSnapshot(), which computes a fresh tick on
 * demand when the loop is idle — so SSE and REST report consistent positions.
 *
 * The instance is stored on globalThis so the broadcast route, the SSE route,
 * and dev-server hot reloads all share the same state.
 */

import { kigaliRoutes, kigaliRouteGeometries } from '../kigali-gtfs'
import { LiveVehicleStore } from './live-store'
import { truncateGeo } from './compression'
import { bareRouteId, haversineMeters } from './geo'

export interface HubVehicle {
  id: string
  route_id: string
  lat: number
  lon: number
  brg: number
  spd: number
  occupancy: string
  /** true when position comes from a crowdsourced broadcaster ping */
  live: boolean
  plate?: string
  operator?: string
  driver?: string
}

export const TICK_INTERVAL_MS = 2000

type Listener = (vehicles: HubVehicle[]) => void

// ─── simulated path-following ─────────────────────────────────────────────────
// Fallback buses used to get a fresh random position inside a ~5km box every
// tick, so on a map they teleported chaotically instead of driving. Now each
// simulated bus keeps persistent state and travels along its route's real
// polyline (lib/kigali-gtfs.ts geometries): advance by speed × elapsed time,
// interpolate the position on the path, derive bearing from the current
// segment, and take a short layover at each terminal before heading back.

interface SimPath {
  coords: [number, number][] // [lon, lat] polyline vertices
  cumM: number[] // cumulative metres at each vertex
  totalM: number
}

interface SimBusState {
  distM: number // distance travelled along the path
  dir: 1 | -1 // ping-pong direction
  speedKmh: number // random-walked each tick so movement isn't robotic
  dwellUntilMs: number // stopped at a terminal until this timestamp
}

function buildSimPaths(): Map<string, SimPath> {
  const map = new Map<string, SimPath>()
  for (const geom of kigaliRouteGeometries) {
    const coords = geom.coordinates as [number, number][]
    if (coords.length < 2) continue
    const cumM = [0]
    for (let i = 1; i < coords.length; i++) {
      const [lon1, lat1] = coords[i - 1]
      const [lon2, lat2] = coords[i]
      cumM.push(cumM[i - 1] + haversineMeters(lat1, lon1, lat2, lon2))
    }
    map.set(geom.routeId, { coords, cumM, totalM: cumM[cumM.length - 1] })
  }
  return map
}

/** Initial compass bearing (degrees, 0–360) from point 1 to point 2. */
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360
}

class RealtimeHub {
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSnapshot: HubVehicle[] = []
  private lastTickAt = 0
  private simPaths = buildSimPaths()
  private simStates = new Map<string, SimBusState>()

  /** Advance one simulated bus along its route polyline and return its pose. */
  private simulate(
    routeId: string,
    elapsedMs: number,
    now: number
  ): { lat: number; lon: number; brg: number; spd: number } | null {
    const path = this.simPaths.get(routeId)
    if (!path) return null

    let s = this.simStates.get(routeId)
    if (!s) {
      // Stagger buses at random offsets so they don't all start bunched up
      s = {
        distM: Math.random() * path.totalM,
        dir: Math.random() < 0.5 ? 1 : -1,
        speedKmh: 20 + Math.random() * 20,
        dwellUntilMs: 0,
      }
      this.simStates.set(routeId, s)
    }

    const dwelling = now < s.dwellUntilMs
    if (!dwelling) {
      s.speedKmh = Math.min(50, Math.max(12, s.speedKmh + (Math.random() - 0.5) * 6))
      s.distM += s.dir * (s.speedKmh / 3.6) * (elapsedMs / 1000)
      // Terminal turnaround: clamp, reverse, brief layover like a real bus
      if (s.distM >= path.totalM) {
        s.distM = path.totalM
        s.dir = -1
        s.dwellUntilMs = now + 5_000 + Math.random() * 10_000
      } else if (s.distM <= 0) {
        s.distM = 0
        s.dir = 1
        s.dwellUntilMs = now + 5_000 + Math.random() * 10_000
      }
    }

    // Locate the current segment and interpolate the position within it
    const { coords, cumM } = path
    let i = 1
    while (i < cumM.length - 1 && cumM[i] < s.distM) i++
    const segStart = coords[i - 1]
    const segEnd = coords[i]
    const segLen = cumM[i] - cumM[i - 1]
    const t = segLen > 0 ? (s.distM - cumM[i - 1]) / segLen : 0
    const lon = segStart[0] + (segEnd[0] - segStart[0]) * t
    const lat = segStart[1] + (segEnd[1] - segStart[1]) * t
    const [fromLon, fromLat] = s.dir === 1 ? segStart : segEnd
    const [toLon, toLat] = s.dir === 1 ? segEnd : segStart
    return {
      lat,
      lon,
      brg: Math.round(bearingDeg(fromLat, fromLon, toLat, toLon)),
      spd: dwelling ? 0 : Math.round(s.speedKmh),
    }
  }

  /** Compute the current vehicle state: crowdsourced pings win, simulation fills the rest. */
  private tick(): HubVehicle[] {
    const liveVehicles = LiveVehicleStore.getVehicles()
    const now = Date.now()
    // Real elapsed time keeps SSE-loop ticks and on-demand REST ticks
    // consistent; clamp so a bus doesn't teleport after an idle stretch.
    const elapsedMs = this.lastTickAt ? Math.min(now - this.lastTickAt, 10_000) : TICK_INTERVAL_MS

    const snapshot: HubVehicle[] = kigaliRoutes.map((route, i) => {
      // Bare-ID comparison: crowdsourced pings may arrive as "101" or
      // "route-101" depending on the broadcaster client version.
      const liveBus = liveVehicles.find((v) => bareRouteId(v.routeId) === bareRouteId(route.id))

      if (liveBus) {
        return {
          id: `bus-${bareRouteId(route.id)}-active`,
          route_id: bareRouteId(route.id),
          lat: truncateGeo(liveBus.lat, 5),
          lon: truncateGeo(liveBus.lng, 5),
          brg: liveBus.heading || 0,
          spd: liveBus.speedKmh,
          occupancy: liveBus.occupancy || 'full',
          live: true,
          plate: liveBus.plate,
          operator: liveBus.operator,
          driver: liveBus.driver,
        }
      }

      // Simulated fallback: drive along the route's real polyline
      const sim = this.simulate(route.id, elapsedMs, now)
      return {
        id: `bus-${bareRouteId(route.id)}-active`,
        route_id: bareRouteId(route.id),
        lat: truncateGeo(sim?.lat ?? -1.9536, 5),
        lon: truncateGeo(sim?.lon ?? 30.0605, 5),
        brg: sim?.brg ?? 0,
        spd: sim?.spd ?? 0,
        occupancy: i % 3 === 0 ? 'full' : 'standing_room_only',
        live: false,
      }
    })

    this.lastSnapshot = snapshot
    this.lastTickAt = now
    return snapshot
  }

  private broadcast = () => {
    const snapshot = this.tick()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (err) {
        console.error('[realtime-hub] listener error:', err)
      }
    }
  }

  /** Subscribe to ticks. Starts the loop on first subscriber. Returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (!this.timer) {
      this.timer = setInterval(this.broadcast, TICK_INTERVAL_MS)
      // Immediate first tick so new subscribers don't wait a full interval
      this.broadcast()
    } else {
      // Deliver current state to the new subscriber right away
      listener(this.lastSnapshot)
    }

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  /** Current vehicle state for REST consumers; ticks on demand when the loop is idle. */
  getSnapshot(): HubVehicle[] {
    if (Date.now() - this.lastTickAt < TICK_INTERVAL_MS && this.lastSnapshot.length > 0) {
      return this.lastSnapshot
    }
    return this.tick()
  }

  get subscriberCount(): number {
    return this.listeners.size
  }
}

// globalThis singleton — survives route-bundle duplication and dev hot reloads
const HUB_KEY = Symbol.for('tega.realtime-hub')
type GlobalWithHub = typeof globalThis & { [HUB_KEY]?: RealtimeHub }

const g = globalThis as GlobalWithHub
if (!g[HUB_KEY]) {
  g[HUB_KEY] = new RealtimeHub()
}

export const realtimeHub: RealtimeHub = g[HUB_KEY]!

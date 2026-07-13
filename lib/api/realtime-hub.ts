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

import { kigaliRoutes } from '../kigali-gtfs'
import { LiveVehicleStore } from './live-store'
import { truncateGeo } from './compression'

export interface HubVehicle {
  id: string
  routeId: string
  lat: number
  lng: number
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

class RealtimeHub {
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSnapshot: HubVehicle[] = []
  private lastTickAt = 0

  /** Compute the current vehicle state: crowdsourced pings win, simulation fills the rest. */
  private tick(): HubVehicle[] {
    const liveVehicles = LiveVehicleStore.getVehicles()

    const snapshot: HubVehicle[] = kigaliRoutes.map((route, i) => {
      const liveBus = liveVehicles.find((v) => v.routeId === route.id)

      if (liveBus) {
        return {
          id: `bus-${route.id}-active`,
          routeId: route.id,
          lat: truncateGeo(liveBus.lat, 5),
          lng: truncateGeo(liveBus.lng, 5),
          brg: liveBus.heading || 0,
          spd: liveBus.speedKmh,
          occupancy: liveBus.occupancy || 'full',
          live: true,
          plate: liveBus.plate,
          operator: liveBus.operator,
          driver: liveBus.driver,
        }
      }

      // Simulated fallback movement around the city centre
      return {
        id: `bus-${route.id}-active`,
        routeId: route.id,
        lat: truncateGeo(-1.9536 + (Math.random() - 0.5) * 0.05, 5),
        lng: truncateGeo(30.0605 + (Math.random() - 0.5) * 0.05, 5),
        brg: Math.floor(Math.random() * 360),
        spd: Math.floor(Math.random() * 45) + 15,
        occupancy: i % 3 === 0 ? 'full' : 'standing_room_only',
        live: false,
      }
    })

    this.lastSnapshot = snapshot
    this.lastTickAt = Date.now()
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

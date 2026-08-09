import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LiveVehicleStore } from '../live-store'
import {
  publishVehiclePing,
  publishIncident,
  attachLiveSync,
  getLiveSyncState,
  VEHICLE_CHANNEL,
  INCIDENT_CHANNEL,
} from '../live-sync'
import type { PingPayload, IncidentPayload } from '../live-sync'

// Fake @upstash/redis subscriber: the real one is an EventTarget that
// dispatches 'message' / 'error'. We need to emit events from the tests, so
// the fake exposes emit() and records every instance created. `setClient`
// lets a test simulate Redis being unconfigured (getRedisClient → null).
const h = vi.hoisted(() => {
  class FakeSub {
    channels: string[]
    listeners = new Map<string, Set<(data: unknown) => void>>()
    constructor(channels: string[]) {
      this.channels = channels
    }
    on(type: string, fn: (data: unknown) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type)!.add(fn)
    }
    emit(type: string, data: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn(data)
    }
    unsubscribe() {
      return Promise.resolve()
    }
  }
  const subs: FakeSub[] = []
  const publish = vi.fn()
  const subscribe = vi.fn((channels: string[]) => {
    const sub = new FakeSub(channels)
    subs.push(sub)
    return sub
  })
  let currentClient: { publish: typeof publish; subscribe: typeof subscribe } | null = {
    publish,
    subscribe,
  }
  return {
    publish,
    subscribe,
    subs,
    getClient: () => currentClient,
    setClient: (c: typeof currentClient) => {
      currentClient = c
    },
  }
})

vi.mock('@/lib/api/redis', () => ({
  getRedisClient: () => h.getClient(),
  __resetRedisForTests: () => {},
}))

// Importing live-store triggers attachLiveSync() at module init with the
// mocked client, so `subs[0]` is the process-wide subscription.
const ping: PingPayload = {
  vehicleId: 'test-vehicle-1',
  routeId: '101',
  clientId: 'test-client',
  lat: -1.9536,
  lng: 30.0605,
  speedKmh: 42,
  heading: 90,
}

const incident: IncidentPayload = {
  id: 'test-incident-1',
  vehicle_id: 'test-vehicle-1',
  route_id: '101',
  clientId: 'test-client',
  type: 'traffic_delay',
  lat: -1.9536,
  lon: 30.0605,
}

describe('live-sync (Redis pub/sub bridge)', () => {
  beforeEach(() => {
    h.publish.mockClear()
    h.publish.mockResolvedValue(1)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a subscription covering both channels', () => {
    expect(h.subs[0].channels).toEqual([VEHICLE_CHANNEL, INCIDENT_CHANNEL])
    expect(getLiveSyncState()).toEqual({ attached: true, channels: [VEHICLE_CHANNEL, INCIDENT_CHANNEL] })
  })

  it('publishes a ping to the vehicle channel as JSON', () => {
    publishVehiclePing(ping)
    expect(h.publish).toHaveBeenCalledWith(VEHICLE_CHANNEL, JSON.stringify(ping))
  })

  it('publishes an incident to the incident channel as JSON', () => {
    publishIncident(incident)
    expect(h.publish).toHaveBeenCalledWith(INCIDENT_CHANNEL, JSON.stringify(incident))
  })

  it('applies an incoming vehicle message to the local store', () => {
    const remotePing: PingPayload = { ...ping, vehicleId: 'remote-vehicle-1' }
    h.subs[0].emit('message', { channel: VEHICLE_CHANNEL, message: remotePing })

    const found = LiveVehicleStore.getVehicles().find((v) => v.vehicleId === 'remote-vehicle-1')
    expect(found).toMatchObject({ routeId: '101', lat: remotePing.lat, lng: remotePing.lng })
  })

  it('applies an incoming incident message to the local store', () => {
    const remoteIncident: IncidentPayload = { ...incident, id: 'remote-incident-1' }
    h.subs[0].emit('message', { channel: INCIDENT_CHANNEL, message: remoteIncident })

    const found = LiveVehicleStore.getIncidents().find((i) => i.id === 'remote-incident-1')
    expect(found).toMatchObject({ type: 'traffic_delay', route_id: '101' })
  })

  it('re-applying the same event is idempotent (same key, no duplicates)', () => {
    h.subs[0].emit('message', { channel: VEHICLE_CHANNEL, message: { ...ping, vehicleId: 'dup-vehicle' } })
    h.subs[0].emit('message', { channel: VEHICLE_CHANNEL, message: { ...ping, vehicleId: 'dup-vehicle' } })
    const matches = LiveVehicleStore.getVehicles().filter((v) => v.vehicleId === 'dup-vehicle')
    expect(matches).toHaveLength(1)
  })

  it('reconnects with backoff after a stream error', async () => {
    vi.useFakeTimers()
    const before = h.subs.length
    h.subs[before - 1].emit('error', new Error('stream closed'))

    expect(h.subs).toHaveLength(before) // backoff pending, not re-subscribed yet
    await vi.advanceTimersByTimeAsync(2_000)
    expect(h.subs).toHaveLength(before + 1)
    expect(getLiveSyncState().attached).toBe(true)
  })

  it('does not tear down the stream on a per-message parse error', () => {
    const before = h.subs.length
    h.subs[before - 1].emit('error', new Error('Failed to parse message: unexpected token'))
    expect(h.subs).toHaveLength(before) // no reconnect scheduled, same stream
  })

  it('swallows publish failures without throwing', async () => {
    h.publish.mockRejectedValueOnce(new Error('redis down'))
    expect(() => publishVehiclePing(ping)).not.toThrow()
    await new Promise((r) => setTimeout(r, 0)) // let the fire-and-forget rejection settle
    expect(h.publish).toHaveBeenCalled()
  })

  it('publish and attach are silent no-ops when Redis is unconfigured', () => {
    h.setClient(null)
    expect(() => publishVehiclePing(ping)).not.toThrow()
    expect(() => publishIncident(incident)).not.toThrow()
    expect(h.publish).not.toHaveBeenCalled()
    const before = h.subs.length
    expect(() => attachLiveSync()).not.toThrow() // never throws, schedules nothing
    expect(h.subs).toHaveLength(before)
    h.setClient({ publish: h.publish, subscribe: h.subscribe })
  })
})

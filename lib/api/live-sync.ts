/**
 * lib/api/live-sync.ts — Redis pub/sub bridge for the live vehicle store.
 *
 * The live store (crowdsourced pings + incidents) is per-process memory, so
 * in a multi-instance deployment a broadcast landing on instance A would be
 * invisible to SSE subscribers on instance B. This bridge event-sources the
 * store through Redis pub/sub:
 *
 *   writer route → LiveVehicleStore.ingest/reportIncident (local, always)
 *                → publishVehiclePing/publishIncident (fire-and-forget)
 *   every instance's subscriber → applies the event to its own local store
 *
 * Delivery is at-least-once and the apply step is idempotent (both store
 * methods key by vehicle/incident id), so duplicate delivery from a
 * reconnect window is harmless. Pub/sub is ephemeral by nature: an instance
 * that is down when an event is published never replays it — acceptable
 * here because pings expire after 5 minutes and the next ping re-syncs.
 *
 * Graceful by design, matching lib/api/redis.ts: when Redis is unconfigured
 * nothing is published, no subscription is opened, and the app behaves
 * exactly as it did before — single-instance, in-process only.
 */

import { getRedisClient } from './redis'
import { LiveVehicleStore } from './live-store'
import type { LiveVehicle, ActiveIncident } from './live-store'

export const VEHICLE_CHANNEL = 'tega:live-vehicle'
export const INCIDENT_CHANNEL = 'tega:incident'
export const LIVE_SYNC_CHANNELS = [VEHICLE_CHANNEL, INCIDENT_CHANNEL] as const

export type PingPayload = Omit<LiveVehicle, 'lastPing'>
export type IncidentPayload = Omit<ActiveIncident, 'reportedAt'>

// Reconnect backoff (ms) after a stream error: 2s → 5s → 10s → 20s → capped.
const BACKOFF_MS = [2_000, 5_000, 10_000, 20_000, 30_000]

// Subscriber state lives on globalThis (codebase pattern) so dev-server hot
// reloads or route-bundle duplicates never open a second subscription.
const SYNC_KEY = Symbol.for('tega.live-sync')
interface SyncState {
  subscriber: { unsubscribe: () => Promise<void> } | null
  attempts: number
  timer: ReturnType<typeof setTimeout> | null
}
type GlobalWithSync = typeof globalThis & { [SYNC_KEY]?: SyncState }

function getState(): SyncState {
  const g = globalThis as GlobalWithSync
  if (!g[SYNC_KEY]) g[SYNC_KEY] = { subscriber: null, attempts: 0, timer: null }
  return g[SYNC_KEY]!
}

/** True when this process holds an active Redis subscription. */
export function getLiveSyncState(): { attached: boolean; channels: string[] } {
  const state = getState()
  return state.subscriber ? { attached: true, channels: [...LIVE_SYNC_CHANNELS] } : { attached: false, channels: [] }
}

// ─── publish side ────────────────────────────────────────────────────────────

function safePublish(channel: string, payload: unknown): void {
  const redis = getRedisClient()
  if (!redis) return
  redis.publish(channel, JSON.stringify(payload)).catch((err: unknown) => {
    console.warn('[live-sync] publish failed:', err instanceof Error ? err.message : err)
  })
}

/** Share a crowdsourced ping with every instance's store. */
export function publishVehiclePing(ping: PingPayload): void {
  safePublish(VEHICLE_CHANNEL, ping)
}

/** Share an incident report with every instance's store. */
export function publishIncident(incident: IncidentPayload): void {
  safePublish(INCIDENT_CHANNEL, incident)
}

// ─── subscribe side ──────────────────────────────────────────────────────────

function scheduleReconnect(state: SyncState): void {
  if (state.timer) return
  const delay = BACKOFF_MS[Math.min(state.attempts, BACKOFF_MS.length - 1)]
  state.timer = setTimeout(() => {
    state.timer = null
    state.attempts += 1
    attachLiveSync()
  }, delay)
}

/**
 * Open (or re-open) the subscription. Idempotent per process — safe to call
 * at module init and again from the reconnect path. When Redis is
 * unconfigured this is a silent no-op, and it does NOT schedule retries
 * (the env either exists at boot or it doesn't).
 */
export function attachLiveSync(): void {
  const state = getState()
  if (state.subscriber) return

  const redis = getRedisClient()
  if (!redis) return

  try {
    // Default deserialization JSON-parses each message body back into the
    // ping/incident object we published.
    const sub = redis.subscribe<PingPayload | IncidentPayload>([...LIVE_SYNC_CHANNELS])
    sub.on('message', ({ channel, message }) => {
      try {
        if (channel === VEHICLE_CHANNEL) {
          LiveVehicleStore.ingest(message as PingPayload)
        } else if (channel === INCIDENT_CHANNEL) {
          LiveVehicleStore.reportIncident(message as IncidentPayload)
        }
      } catch (err) {
        console.warn('[live-sync] apply failed:', err instanceof Error ? err.message : err)
      }
    })
    sub.on('error', (err: unknown) => {
      // Per-message parse failures are dispatched as 'error' too — those do
      // NOT kill the stream, so don't tear the subscription down for them.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Failed to parse')) return
      console.warn('[live-sync] subscription stream error:', msg)
      state.subscriber = null
      scheduleReconnect(state)
    })
    state.subscriber = sub
    state.attempts = 0
    console.log(`[live-sync] subscribed: ${LIVE_SYNC_CHANNELS.join(', ')}`)
  } catch (err) {
    console.warn('[live-sync] subscribe failed:', err instanceof Error ? err.message : err)
    state.subscriber = null
    scheduleReconnect(state)
  }
}

// Open the subscription the moment this module loads — importing live-sync
// (for publishing, or via the realtime hub for SSE) is what makes an
// instance part of the cross-instance fan-out. No-op without Redis.
attachLiveSync()

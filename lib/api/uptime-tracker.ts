/**
 * lib/api/uptime-tracker.ts — durable per-endpoint uptime history.
 *
 * Powers the Render-style 90-day bar charts on the public status page and the
 * admin dashboard. Every probe (background sweep + the admin "re-run all
 * checks" action) is bucketed per endpoint per day and written through to the
 * `uptime_checks` Supabase table (supabase/migrations/0012), so the history
 * survives restarts instead of resetting to "no data" on every redeploy.
 *
 * Access model (same shape as maintenance-store/error-log):
 *   - In-memory per-day buckets are the fast path — reads never hit the DB.
 *   - `ensureHydrated()` loads the last ~95 days once at startup (awaited by
 *     the uptime routes), so the very first request after a restart already
 *     sees the persisted history.
 *   - `record()` updates memory immediately and fire-and-forgets the same row
 *     to Supabase; a DB failure loses only durability, never the current
 *     process's view.
 *   - A background sweep probes every endpoint every 5 minutes (a long-running
 *     Render process, same setInterval assumption as error-log) so the bars
 *     fill in automatically. It is deliberately skipped in test envs, probes
 *     in small batches, and treats maintenance-disabled endpoints as
 *     'degraded' (intentional) rather than 'down'.
 *
 * Day buckets use UTC dates (`toISOString().slice(0, 10)`) — Render's server
 * clock is UTC, and both consumers render the same window, so there is no
 * timezone drift between history and display.
 */

import { getSupabaseAdmin } from '../supabase-server'
import { MaintenanceStore } from './maintenance-store'
import { ENDPOINT_REGISTRY } from './endpoint-registry'

// ─── probe catalog ───────────────────────────────────────────────────────────
// Server-side mirror of the old public-page check list: every toggleable
// registry endpoint plus the meta endpoints (health/status/diagnostics/
// maintenance/feedback) that aren't disable-able but are worth watching.
// Sample params mirror what the client catalog used to hit.

export interface EndpointProbe {
  id: string
  method: 'GET' | 'POST'
  /** Display label — the registry label for registry entries, else the path. */
  label: string
  /** Plain-English service name for the public status page. */
  title: string
  /** One-line, non-technical description of what the service does. */
  description: string
  group: string
  url: string
  body?: object
  /** Requires the admin token header (only /api/admin/maintenance). */
  adminOnly?: boolean
  /**
   * True for endpoints that CREATE real data when called (broadcast a fake
   * vehicle ping, file a bug report, open a stop suggestion, raise an
   * incident). The automatic background sweep never touches these — riders
   * would see phantom events every 5 minutes. They run only on the explicit
   * admin "re-run all checks" action.
   */
  writePath?: boolean
}

const STOP_ID = '24626187'

const PROBES: EndpointProbe[] = [
  // Meta (not disable-able, but the bars look wrong without them)
  { id: 'meta.health', method: 'GET', label: '/api/health', title: 'Health check', description: 'Core service health', group: 'System', url: '/api/health' },
  { id: 'meta.status', method: 'GET', label: '/api/status', title: 'Status summary', description: 'Current overall status', group: 'System', url: '/api/status' },
  { id: 'meta.diagnostics', method: 'GET', label: '/api/diagnostics', title: 'Diagnostics', description: 'Deep system checks', group: 'System', url: '/api/diagnostics' },
  {
    id: 'meta.maintenance', method: 'GET', label: '/api/admin/maintenance', title: 'Maintenance flags', description: 'Which services are disabled', group: 'System', url: '/api/admin/maintenance',
    adminOnly: true,
  },
  {
    id: 'meta.feedback', method: 'POST', label: '/api/feedback/report', title: 'Feedback reports', description: 'Bug and feedback intake', group: 'System', url: '/api/feedback/report',
    body: { subject: 'Uptime probe', message: 'Automated probe from the uptime tracker.', pageUrl: 'https://bus-go-track.vercel.app/' },
    writePath: true,
  },

  // Stops & Arrivals
  { id: 'stops.list', method: 'GET', label: '/api/stops', title: 'Bus stops', description: 'Every bus stop in Kigali', group: 'Stops & Arrivals', url: '/api/stops?lat=-1.9403&lng=30.0618&radius=3000&limit=5' },
  { id: 'stops.arrivals', method: 'GET', label: '/api/stops/{id}/arrivals', title: 'Live arrivals', description: 'Real-time arrivals for a stop', group: 'Stops & Arrivals', url: `/api/stops/${STOP_ID}/arrivals` },
  { id: 'search.suggest', method: 'GET', label: '/api/search/suggest', title: 'Search suggestions', description: 'Find stops and routes as you type', group: 'Stops & Arrivals', url: '/api/search/suggest?q=kimironko' },

  // GTFS Static
  { id: 'gtfs.stops', method: 'GET', label: '/api/gtfs/stops', title: 'Stop directory', description: 'Look up any stop by name', group: 'GTFS Static', url: '/api/gtfs/stops?q=nyabugogo' },
  { id: 'gtfs.stop.routes', method: 'GET', label: '/api/gtfs/stops/{id}/routes', title: 'Routes at a stop', description: 'Which routes serve a stop', group: 'GTFS Static', url: `/api/gtfs/stops/${STOP_ID}/routes` },
  { id: 'gtfs.hubs', method: 'GET', label: '/api/gtfs/hubs', title: 'Interchange hubs', description: 'Major transfer stations', group: 'GTFS Static', url: '/api/gtfs/hubs' },
  { id: 'gtfs.routes', method: 'GET', label: '/api/gtfs/routes', title: 'Route directory', description: 'The full route catalogue', group: 'GTFS Static', url: '/api/gtfs/routes' },
  { id: 'routes.list', method: 'GET', label: '/api/routes', title: 'Route list', description: 'Every route with its details', group: 'GTFS Static', url: '/api/routes' },
  { id: 'routes.shape', method: 'GET', label: '/api/routes/{id}/shape', title: 'Route paths', description: 'The map path a route follows', group: 'GTFS Static', url: '/api/routes/101/shape' },
  { id: 'routes.sequence', method: 'GET', label: '/api/routes/{id}/sequence', title: 'Stop sequence', description: 'The order stops are served', group: 'GTFS Static', url: '/api/routes/101/sequence' },

  // Realtime
  { id: 'vehicles.live', method: 'GET', label: '/api/vehicles/live', title: 'Live buses', description: 'Where buses are right now', group: 'Realtime', url: '/api/vehicles/live' },
  // SSE never terminates — fetch just the headers with a short abort so the
  // "is it serving?" answer is cheap and the connection is closed promptly.
  { id: 'realtime.sse', method: 'GET', label: '/api/realtime/sse', title: 'Live stream', description: 'Continuous live position updates', group: 'Realtime', url: '/api/realtime/sse?lat=-1.9403&lng=30.0618&radius=5000' },
  {
    id: 'realtime.broadcast', method: 'POST', label: '/api/realtime/broadcast', title: 'Vehicle broadcast', description: 'Publish a live vehicle ping', group: 'Realtime', url: '/api/realtime/broadcast',
    body: { vehicle_id: 'uptime-probe', route_id: '101', client_id: 'uptime-tracker', latitude: -1.9403, longitude: 30.0618, speed_kmh: 25, heading: 90 },
    writePath: true,
  },
  {
    id: 'incidents.report', method: 'POST', label: '/api/incidents/report', title: 'Incident reports', description: 'Report a delay or disruption', group: 'Realtime', url: '/api/incidents/report',
    body: { vehicle_id: 'uptime-probe', route_id: '101', client_id: 'uptime-tracker', incident_type: 'traffic_delay', latitude: -1.9403, longitude: 30.0618 },
    writePath: true,
  },
  { id: 'incidents.active', method: 'GET', label: '/api/incidents/active', title: 'Alerts & incidents', description: 'Current delays and disruptions', group: 'Realtime', url: '/api/incidents/active' },

  // Community
  {
    id: 'stops.suggest', method: 'POST', label: '/api/stops/suggest', title: 'Stop suggestions', description: 'Propose a stop edit', group: 'Community', url: '/api/stops/suggest',
    body: { stop_id: STOP_ID, proposed_name: null, proposed_lat: -1.9403, proposed_lon: 30.0618, reason: 'Uptime probe', client_id: 'uptime-tracker' },
    writePath: true,
  },

  // Deprecated
  { id: 'arrivals.legacy', method: 'GET', label: '/api/arrivals', title: 'Legacy arrivals', description: 'Deprecated — replaced by live arrivals', group: 'Deprecated', url: '/api/arrivals' },
]

// Registry order for display: registry entries first (canonical), meta probes
// appended in the order above. The bars render in this order.
export const ENDPOINT_PROBES: EndpointProbe[] = [
  ...ENDPOINT_REGISTRY.map((e) => PROBES.find((p) => p.id === e.id)!).filter(Boolean),
  ...PROBES.filter((p) => !ENDPOINT_REGISTRY.some((e) => e.id === p.id)),
]

// ─── bucket model ────────────────────────────────────────────────────────────

export type ProbeStatus = 'ok' | 'degraded' | 'down'

export interface DayBucket {
  /** UTC date key, e.g. '2026-08-08'. */
  day: string
  ok: number
  degraded: number
  down: number
}

export interface EndpointUptime {
  id: string
  method: 'GET' | 'POST'
  label: string
  title: string
  description: string
  group: string
  /** Percentage of samples that were fully ok across the requested window. */
  uptimePct: number
  samples: number
  /** Status of the most recent bucket with data ('ok'|'degraded'|'down'|null). */
  last: ProbeStatus | null
  buckets: DayBucket[]
}

const RETENTION_DAYS = 95
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const SWEEP_BATCH = 4
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
const PROBE_TIMEOUT_MS = 6_000
const SSE_HEADER_TIMEOUT_MS = 3_000

interface Row {
  endpoint: string
  checked_at: string
  status: ProbeStatus
}

class Tracker {
  /** endpoint id → day key → bucket. */
  private days = new Map<string, Map<string, DayBucket>>()
  /** endpoint id → most recent status (for `last`). */
  private lastStatus = new Map<string, ProbeStatus | null>()
  private hydrated = false
  private hydrating: Promise<void> | null = null
  private retryAt = 0
  private lastHydratedAt: number | null = null

  async ensureHydrated(): Promise<void> {
    if (this.hydrated) return
    if (Date.now() < this.retryAt) return // recent failure — retry later
    if (this.hydrating) return this.hydrating
    this.hydrating = this.hydrate()
    return this.hydrating
  }

  private async hydrate(): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('uptime_checks')
        .select('endpoint, checked_at, status')
        .gte('checked_at', cutoff)
      if (error || !Array.isArray(data)) throw new Error(error?.message ?? 'no data')
      const next = new Map<string, Map<string, DayBucket>>()
      for (const row of data as unknown as Row[]) {
        const day = new Date(row.checked_at).toISOString().slice(0, 10)
        const ep = next.get(row.endpoint) ?? new Map<string, DayBucket>()
        const b = ep.get(day) ?? { day, ok: 0, degraded: 0, down: 0 }
        b[row.status]++
        ep.set(day, b)
        next.set(row.endpoint, ep)
      }
      this.days = next
      this.lastStatus = new Map()
      for (const [id, ep] of next) {
        const ordered = Array.from(ep.values()).sort((a, b) => (a.day < b.day ? -1 : 1))
        const last = ordered[ordered.length - 1]
        this.lastStatus.set(id, last ? worstOf(last) : null)
      }
      this.hydrated = true
      this.lastHydratedAt = Date.now()
    } catch {
      // Supabase down, table not migrated, or bad creds — keep in-memory data
      // (already-probed rows this process) and retry after the backoff.
      this.retryAt = Date.now() + 30_000
    } finally {
      this.hydrating = null
    }
  }

  /**
   * Record one probe result. Updates memory immediately; persists best-effort.
   */
  record(id: string, status: ProbeStatus, opts: { at?: number; detail?: string } = {}): void {
    const at = opts.at ?? Date.now()
    const day = new Date(at).toISOString().slice(0, 10)
    const ep = this.days.get(id) ?? new Map<string, DayBucket>()
    const b = ep.get(day) ?? { day, ok: 0, degraded: 0, down: 0 }
    b[status]++
    ep.set(day, b)
    this.days.set(id, ep)
    this.lastStatus.set(id, status)
    void this.persist(id, status, at, opts.detail)
  }

  /** Best-effort durable write. Swallows every failure by design. */
  private async persist(id: string, status: ProbeStatus, at: number, detail?: string): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      await supabase.from('uptime_checks').upsert(
        {
          endpoint: id,
          checked_at: new Date(at).toISOString(),
          status,
          detail: detail ?? null,
        },
        { onConflict: 'endpoint,checked_at' }
      )
    } catch {
      // Supabase down or table not migrated — the in-memory bucket still has
      // this probe; only durability across restarts is lost.
    }
  }

  /** Best-effort durable prune of rows older than `days`. */
  async pruneOld(days = RETENTION_DAYS): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('uptime_checks').delete().lt('checked_at', cutoff)
    } catch {
      /* Supabase down — rows keep accumulating until the next successful tick. */
    }
  }

  /**
   * Per-endpoint history for the last `days` days, newest bucket last.
   * Endpoints with no data still appear (all-empty buckets → gray bars).
   */
  getAllHistory(days = 90): EndpointUptime[] {
    const startMs = Date.now() - (days - 1) * 24 * 60 * 60 * 1000
    return ENDPOINT_PROBES.map((p) => {
      const ep = this.days.get(p.id) ?? new Map<string, DayBucket>()
      const buckets: DayBucket[] = []
      let ok = 0
      let degraded = 0
      let down = 0
      for (let i = 0; i < days; i++) {
        const day = utcDay(startMs + i * 24 * 60 * 60 * 1000)
        const b = ep.get(day)
        if (b) {
          ok += b.ok
          degraded += b.degraded
          down += b.down
        }
        buckets.push(b ?? { day, ok: 0, degraded: 0, down: 0 })
      }
      const samples = ok + degraded + down
      const uptimePct = samples === 0 ? 100 : Math.round((ok / samples) * 10000) / 100
      return {
        id: p.id,
        method: p.method,
        label: p.label,
        title: p.title,
        description: p.description,
        group: p.group,
        uptimePct,
        samples,
        last: this.lastStatus.get(p.id) ?? null,
        buckets,
      }
    })
  }

  getDurability(): { durable: boolean; lastHydratedAt: number | null } {
    return { durable: this.hydrated, lastHydratedAt: this.lastHydratedAt }
  }

  /**
   * Probe every endpoint once (used by the admin "re-run all checks" route and
   * the background sweep). Maintenance-disabled endpoints are recorded as
   * 'degraded' without fetching — a deliberate disable must read as amber,
   * not red. Returns per-endpoint results, newest probe order.
   */
  async runProbes(opts: { includeWritePaths?: boolean } = {}): Promise<
    Array<{ id: string; status: ProbeStatus; latencyMs: number | null; detail: string | null }>
  > {
    await MaintenanceStore.ensureHydrated()
    const targets = opts.includeWritePaths
      ? ENDPOINT_PROBES
      : ENDPOINT_PROBES.filter((p) => !p.writePath)
    const maintenance = new Set(MaintenanceStore.getAll().map((f) => f.feature))
    const adminToken = process.env.ADMIN_TOKEN
    const base = selfBaseUrl()

    const probeOne = async (p: EndpointProbe) => {
      if (maintenance.has(p.id)) {
        this.record(p.id, 'degraded', { detail: 'maintenance' })
        return { id: p.id, status: 'degraded' as const, latencyMs: null, detail: 'maintenance' }
      }
      const start = Date.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), p.id === 'realtime.sse' ? SSE_HEADER_TIMEOUT_MS : PROBE_TIMEOUT_MS)
      try {
        const res = await fetch(`${base}${p.url}`, {
          method: p.method,
          headers: {
            ...(p.body ? { 'Content-Type': 'application/json' } : {}),
            ...(p.adminOnly && adminToken ? { 'x-admin-token': adminToken } : {}),
          },
          body: p.body ? JSON.stringify(p.body) : undefined,
          signal: controller.signal,
          // The sweep is opportunistic — a slow probe must never pile up.
          cache: 'no-store',
        })
        const latencyMs = Date.now() - start
        const status: ProbeStatus = res.status < 400 ? 'ok' : res.status < 500 ? 'degraded' : 'down'
        this.record(p.id, status, { detail: res.status < 400 ? undefined : `HTTP ${res.status}` })
        return { id: p.id, status, latencyMs, detail: res.status < 400 ? null : `HTTP ${res.status}` }
      } catch (err) {
        const latencyMs = Date.now() - start
        const detail = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network error'
        this.record(p.id, 'down', { detail })
        return { id: p.id, status: 'down' as const, latencyMs, detail }
      } finally {
        clearTimeout(timeout)
      }
    }

    // Small batches so the server isn't slammed by its own probes.
    const results: Array<{ id: string; status: ProbeStatus; latencyMs: number | null; detail: string | null }> = []
    const queue = [...targets]
    while (queue.length > 0) {
      results.push(...(await Promise.all(queue.splice(0, SWEEP_BATCH).map(probeOne))))
    }
    return results
  }

  /** Test-only: reset the singleton so each unit test starts from a clean state. */
  resetForTests(): void {
    this.days = new Map()
    this.lastStatus = new Map()
    this.hydrated = false
    this.hydrating = null
    this.retryAt = 0
    this.lastHydratedAt = null
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function worstOf(b: DayBucket): ProbeStatus {
  if (b.down > 0) return 'down'
  if (b.degraded > 0) return 'degraded'
  return 'ok'
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Absolute origin for self-probes. Render sets RENDER_EXTERNAL_URL for us. */
export function selfBaseUrl(): string {
  return process.env.RENDER_EXTERNAL_URL ?? process.env.APP_URL ?? 'http://localhost:3000'
}

// ─── singleton + background sweep ────────────────────────────────────────────

const KEY = Symbol.for('tega.uptime-tracker')
type GlobalWithTracker = typeof globalThis & { [KEY]?: Tracker }

const g = globalThis as GlobalWithTracker
if (!g[KEY]) {
  const tracker = new Tracker()
  g[KEY] = tracker

  // Background sweep: fills the bars automatically. Long-running Render
  // process (not serverless), so setInterval survives for the process
  // lifetime — same assumption error-log/auth-log already rely on. Skipped in
  // test envs so a vitest run never starts probing real endpoints.
  if (process.env.NODE_ENV !== 'test') {
    const sweep = () => void tracker.runProbes().catch(() => {})
    setTimeout(sweep, 60_000).unref()
    setInterval(sweep, SWEEP_INTERVAL_MS).unref()
    void tracker.pruneOld()
    setInterval(() => void tracker.pruneOld(), PRUNE_INTERVAL_MS).unref()
  }
}

export const UptimeTracker: Tracker = g[KEY]!

/** Test-only: reset the singleton so each unit test starts from a clean state. */
export function __resetUptimeTrackerForTests(): void {
  g[KEY]!.resetForTests()
}

'use client'

/**
 * Developer status page for the BusGo Track API.
 *
 * This repo is API-only — the production frontend lives in a separate
 * repository. This page exists so a developer hitting the deployment root
 * can see at a glance whether every endpoint is behaving, and can exercise
 * each one (including the SSE stream) without leaving the browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ─── endpoint catalog ─────────────────────────────────────────────────────────

interface EndpointDef {
  method: 'GET' | 'POST'
  path: string // display path
  testPath: string // actually requested (sample params filled in)
  description: string
  group: string
  body?: object // for POST tests
  deprecated?: { replacement: string }
}

const ENDPOINTS: EndpointDef[] = [
  // System
  { group: 'System', method: 'GET', path: '/api/health', testPath: '/api/health', description: 'Liveness + database connectivity' },
  { group: 'System', method: 'GET', path: '/api/status', testPath: '/api/status', description: 'System status with SSE telemetry' },
  { group: 'System', method: 'GET', path: '/api/diagnostics', testPath: '/api/diagnostics', description: 'Per-vehicle health of crowdsourced pings' },
  { group: 'System', method: 'GET', path: '/api/admin/maintenance', testPath: '/api/admin/maintenance', description: 'Active maintenance flags (toggle from /admin)' },
  { group: 'System', method: 'GET', path: '/api/errors', testPath: '/api/errors', description: 'Recent endpoint failures ledger (shows in the panel above when non-empty; manage from /admin)' },
  { group: 'System', method: 'POST', path: '/api/feedback/report', testPath: '/api/feedback/report', description: 'Rider bug-report submission (public, no auth) — view + resolve from /admin', body: { subject: 'Test report', message: 'This is a test bug report from the dashboard.', pageUrl: 'https://bus-go-track.vercel.app/' } },

  // Stops & arrivals
  { group: 'Stops & Arrivals', method: 'GET', path: '/api/stops?lat&lng&radius&limit', testPath: '/api/stops?lat=-1.9403&lng=30.0618&radius=3000&limit=5', description: 'Deduplicated stops with optional proximity sort (cached)' },
  { group: 'Stops & Arrivals', method: 'GET', path: '/api/stops/{id}/arrivals', testPath: '/api/stops/24626187/arrivals', description: 'Scheduled + live arrivals for a stop' },
  { group: 'Stops & Arrivals', method: 'GET', path: '/api/search/suggest?q', testPath: '/api/search/suggest?q=kimironko', description: 'Stop name autocomplete with real route badges' },

  // GTFS static
  { group: 'GTFS Static', method: 'GET', path: '/api/gtfs/stops?q', testPath: '/api/gtfs/stops?q=nyabugogo', description: 'Name-validated canonical stops (cached)' },
  { group: 'GTFS Static', method: 'GET', path: '/api/gtfs/stops/{id}/routes', testPath: '/api/gtfs/stops/24626187/routes', description: 'Routes serving a stop (in-memory GTFS index)' },
  { group: 'GTFS Static', method: 'GET', path: '/api/gtfs/hubs', testPath: '/api/gtfs/hubs', description: 'Major hubs resolved to real GTFS stop IDs' },
  { group: 'GTFS Static', method: 'GET', path: '/api/gtfs/routes', testPath: '/api/gtfs/routes', description: 'All GTFS routes' },
  { group: 'GTFS Static', method: 'GET', path: '/api/routes', testPath: '/api/routes', description: 'Routes (legacy shape)' },
  { group: 'GTFS Static', method: 'GET', path: '/api/routes/{id}/shape', testPath: '/api/routes/101/shape', description: 'GeoJSON LineString for a route' },
  { group: 'GTFS Static', method: 'GET', path: '/api/routes/{id}/sequence', testPath: '/api/routes/101/sequence', description: 'Ordered stop sequence for a route' },

  // Realtime
  { group: 'Realtime', method: 'GET', path: '/api/vehicles/live', testPath: '/api/vehicles/live', description: 'Vehicle snapshot (same state as the SSE stream)' },
  {
    group: 'Realtime', method: 'POST', path: '/api/realtime/broadcast', testPath: '/api/realtime/broadcast',
    description: 'Crowdsourced vehicle ping ingest (sends a test ping)',
    body: {
      vehicle_id: 'status-page-test', route_id: '101', client_id: 'status-page',
      latitude: -1.9403, longitude: 30.0618, speed_kmh: 25, heading: 90,
    },
  },
  {
    group: 'Realtime', method: 'POST', path: '/api/incidents/report', testPath: '/api/incidents/report',
    description: 'Incident report ingest (sends a test report)',
    body: {
      vehicle_id: 'status-page-test', route_id: '101', client_id: 'status-page',
      incident_type: 'traffic_delay', latitude: -1.9403, longitude: 30.0618,
    },
  },

  // Deprecated
  {
    group: 'Deprecated', method: 'GET', path: '/api/arrivals', testPath: '/api/arrivals',
    description: 'Simulation-only demo — use /api/stops/{id}/arrivals',
    deprecated: { replacement: '/api/stops/{id}/arrivals' },
  },
]

const GROUPS = ['System', 'Stops & Arrivals', 'GTFS Static', 'Realtime', 'Deprecated']

// ─── per-endpoint check state ─────────────────────────────────────────────────

interface CheckResult {
  state: 'idle' | 'running' | 'done' | 'failed'
  status?: number
  latencyMs?: number
  preview?: string
}

const SLOW_MS = 500 // above this, a 2xx response is "degraded" not "healthy"

function statusColor(r: CheckResult, deprecated?: boolean): string {
  if (deprecated) return 'var(--text-dim)'
  if (r.state === 'running') return 'var(--warn)'
  if (r.state === 'idle') return 'var(--text-dim)'
  if (r.state === 'failed' || (r.status ?? 500) >= 500) return 'var(--err)'
  if ((r.status ?? 0) >= 400) return 'var(--warn)'
  if ((r.latencyMs ?? 0) > SLOW_MS) return 'var(--warn)'
  return 'var(--ok)'
}

// Status must never be color-alone — pair the dot with a short text label.
function statusLabel(r: CheckResult, deprecated?: boolean): string | null {
  if (deprecated) return 'DEPRECATED'
  if (r.state === 'idle' || r.state === 'running') return null
  if (r.state === 'failed' || (r.status ?? 500) >= 500) return 'DOWN'
  if ((r.status ?? 0) >= 400) return 'WARN'
  if ((r.latencyMs ?? 0) > SLOW_MS) return 'SLOW'
  return null
}

// ─── page ─────────────────────────────────────────────────────────────────────

interface MaintenanceFlag {
  feature: string
  reason: string
  since: number
}

// Mirrors lib/api/error-log.ts ErrorEntry — the recent-failures ledger.
interface ErrorEntry {
  path: string
  method: string
  status: number
  message: string
  details?: string
  count: number
  firstAt: number
  lastAt: number
}

// ─── SSE live diagnostic ──────────────────────────────────────────────────────
// The frontend consumes one long-lived SSE connection carrying several event
// types multiplexed by a `type` field. When the app "feels dead," the useful
// questions are: is the socket even open? which event types are actually
// arriving? and how long since the last frame (a live stream should never go
// quiet for long)? This diagnostic answers all three, live, without leaving
// the browser — a step up from the old fire-once-for-8s counter.

// The event types the SSE route emits (see app/api/realtime/sse/route.ts).
const SSE_EVENT_TYPES = [
  'connected',
  'vehicle:update',
  'viewer:counts',
  'incident:alert',
  'system:maintenance',
] as const

interface SseDiag {
  running: boolean
  state: string // human-readable connection state
  connectedAt: number | null // first successful open (for uptime)
  reconnects: number // times the browser silently re-opened the socket
  errors: number // onerror fires (transient during reconnect)
  total: number // all message frames seen
  byType: Record<string, number> // frames bucketed by `type`
  lastMessageAt: number | null // for the staleness clock
  lastPayload: string // truncated last frame, for eyeballing shape
}

const EMPTY_SSE_DIAG: SseDiag = {
  running: false,
  state: 'idle',
  connectedAt: null,
  reconnects: 0,
  errors: 0,
  total: 0,
  byType: {},
  lastMessageAt: null,
  lastPayload: '',
}

export default function StatusPage() {
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sse, setSse] = useState<SseDiag>(EMPTY_SSE_DIAG)
  const esRef = useRef<EventSource | null>(null)
  const openCountRef = useRef(0) // distinguishes first open from reconnects
  // Ticks once a second while streaming so the "since last frame" clock is live
  // even when no new frames are arriving (which is itself the thing to notice).
  const [now, setNow] = useState(() => Date.now())
  const [injecting, setInjecting] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceFlag[]>([])
  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [errorSource, setErrorSource] = useState<'supabase' | 'memory'>('memory')

  const refreshMaintenance = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/maintenance', { cache: 'no-store' })
      const data = await res.json()
      setMaintenance(data.flags ?? [])
    } catch { /* dashboard still works without this */ }
  }, [])

  const refreshErrors = useCallback(async () => {
    try {
      const res = await fetch('/api/errors', { cache: 'no-store' })
      const data = await res.json()
      setErrors(data.errors ?? [])
      setErrorSource(data.source === 'supabase' ? 'supabase' : 'memory')
    } catch { /* dashboard still works without this */ }
  }, [])

  const runCheck = useCallback(async (ep: EndpointDef) => {
    setResults((r) => ({ ...r, [ep.path]: { state: 'running' } }))
    const start = performance.now()
    try {
      const res = await fetch(ep.testPath, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        cache: 'no-store',
      })
      const latencyMs = Math.round(performance.now() - start)
      let preview = ''
      try {
        const text = await res.text()
        preview = text.length > 2000 ? text.slice(0, 2000) + ' …' : text
        try { preview = JSON.stringify(JSON.parse(preview.replace(/ …$/, '')), null, 2) } catch { /* keep raw */ }
      } catch { /* body unreadable */ }
      setResults((r) => ({ ...r, [ep.path]: { state: 'done', status: res.status, latencyMs, preview } }))
    } catch (err) {
      setResults((r) => ({
        ...r,
        [ep.path]: { state: 'failed', latencyMs: Math.round(performance.now() - start), preview: String(err) },
      }))
    }
  }, [])

  const runAll = useCallback(async () => {
    setCheckedAt(new Date().toLocaleTimeString())
    // Small batches so the dev server isn't slammed
    const queue = [...ENDPOINTS]
    while (queue.length > 0) {
      await Promise.all(queue.splice(0, 4).map(runCheck))
    }
  }, [runCheck])

  const stopSse = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setSse((s) => ({ ...s, running: false, state: 'stopped' }))
  }, [])

  const startSse = useCallback(() => {
    esRef.current?.close() // never leak a prior connection
    openCountRef.current = 0
    setSse({ ...EMPTY_SSE_DIAG, running: true, state: 'connecting' })

    const es = new EventSource('/api/realtime/sse?lat=-1.9403&lng=30.0618&radius=5000')
    esRef.current = es

    // The `connected` handshake is its own SSE event name, not a `message`.
    es.addEventListener('connected', () => {
      setSse((s) => ({
        ...s,
        state: 'streaming',
        byType: { ...s.byType, connected: (s.byType.connected ?? 0) + 1 },
      }))
    })

    es.onopen = () => {
      openCountRef.current += 1
      const isReconnect = openCountRef.current > 1
      setSse((s) => ({
        ...s,
        state: 'streaming',
        connectedAt: s.connectedAt ?? Date.now(),
        reconnects: isReconnect ? s.reconnects + 1 : s.reconnects,
      }))
    }

    es.addEventListener('message', (e) => {
      let type = 'unknown'
      try { type = (JSON.parse(e.data)?.type as string) ?? 'unknown' } catch { /* keep 'unknown' */ }
      const last = e.data.length > 400 ? e.data.slice(0, 400) + ' …' : e.data
      setSse((s) => ({
        ...s,
        state: 'streaming',
        total: s.total + 1,
        byType: { ...s.byType, [type]: (s.byType[type] ?? 0) + 1 },
        lastMessageAt: Date.now(),
        lastPayload: last,
      }))
    })

    // EventSource auto-reconnects on transient errors; we deliberately do NOT
    // close here, so the tool surfaces flapping (rising reconnect count) rather
    // than hiding it. readyState tells us whether it's retrying or truly dead.
    es.onerror = () => {
      const dead = es.readyState === EventSource.CLOSED
      setSse((s) => ({
        ...s,
        errors: s.errors + 1,
        state: dead ? 'connection closed by server' : 'reconnecting…',
      }))
    }
  }, [])

  // Fire a real vehicle ping + incident report so they round-trip back through
  // the SSE stream — proves the whole ingest→broadcast→client path end to end,
  // not just that the socket is open.
  const injectTestData = useCallback(async () => {
    setInjecting(true)
    try {
      const ping = ENDPOINTS.find((e) => e.path === '/api/realtime/broadcast')
      const incident = ENDPOINTS.find((e) => e.path === '/api/incidents/report')
      await Promise.all(
        [ping, incident].map((ep) =>
          ep?.body
            ? fetch(ep.testPath, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ep.body),
                cache: 'no-store',
              })
            : Promise.resolve()
        )
      )
    } catch { /* the SSE panel will simply show nothing new arrived */ }
    finally { setInjecting(false) }
  }, [])

  // Live staleness clock + cleanup. Only ticks while a stream is active.
  useEffect(() => {
    if (!sse.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [sse.running])

  useEffect(() => () => { esRef.current?.close() }, []) // close on unmount

  useEffect(() => {
    runAll()
    refreshMaintenance()
    refreshErrors()
    // Poll the error ledger so a failure that happens while the dashboard is
    // open surfaces on its own, without a manual refresh.
    const id = setInterval(refreshErrors, 15_000)
    return () => clearInterval(id)
  }, [runAll, refreshMaintenance, refreshErrors])

  const health = results['/api/health']
  const overall =
    !health || health.state === 'running' ? { label: 'CHECKING…', color: 'var(--warn)' }
    : health.state === 'done' && (health.status ?? 500) < 400 ? { label: 'OPERATIONAL', color: 'var(--ok)' }
    : health.state === 'done' && (health.status ?? 500) === 503 ? { label: 'DEGRADED', color: 'var(--warn)' }
    : { label: 'DOWN', color: 'var(--err)' }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl" style={{ color: 'var(--accent)' }}>▍</span>
            <h1 className="text-xl font-bold tracking-tight">BusGo Track API</h1>
            <span
              className="rounded px-2 py-0.5 text-xs font-bold"
              style={{ background: 'color-mix(in srgb, ' + overall.color + ' 15%, transparent)', color: overall.color }}
            >
              {overall.label}
            </span>
          </div>
          <a
            href="/admin"
            className="shrink-0 rounded border px-2.5 py-1 text-xs font-semibold hover:opacity-80"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            Admin →
          </a>
        </div>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-dim)' }}>
          GTFS + realtime transit API for Kigali. The production frontend lives in a separate
          repository — this page is the developer status board.
          {checkedAt && <> Last checked {checkedAt}.</>}
        </p>
        {maintenance.length > 0 && (
          <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--warn)' }}>
            ⚠ {maintenance.length} endpoint{maintenance.length > 1 ? 's' : ''} currently disabled — see /admin for details.
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={runAll}
            className="cursor-pointer rounded border px-3 py-1 text-xs hover:opacity-80"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            ↻ Re-run all checks
          </button>
          <button
            onClick={sse.running ? stopSse : startSse}
            className="cursor-pointer rounded border px-3 py-1 text-xs hover:opacity-80"
            style={
              sse.running
                ? { borderColor: 'var(--err)', color: 'var(--err)' }
                : { borderColor: 'var(--border)', color: 'var(--text-dim)' }
            }
          >
            {sse.running ? '■ Stop SSE stream' : '⚡ Start live SSE monitor'}
          </button>
          {sse.running && (
            <button
              onClick={injectTestData}
              disabled={injecting}
              className="cursor-pointer rounded border px-3 py-1 text-xs hover:opacity-80 disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
            >
              {injecting ? 'injecting…' : '💉 Inject test ping + incident'}
            </button>
          )}
        </div>
        {sse.state !== 'idle' && (
          <div className="mt-3 rounded border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {(() => {
              const staleSec = sse.lastMessageAt ? Math.floor((now - sse.lastMessageAt) / 1000) : null
              const upSec = sse.connectedAt ? Math.floor((now - sse.connectedAt) / 1000) : null
              // A live stream ticks every ~2s; >10s quiet while "streaming" is suspicious.
              const staleColor =
                staleSec === null ? 'var(--text-dim)'
                : staleSec > 10 ? 'var(--err)'
                : staleSec > 4 ? 'var(--warn)'
                : 'var(--ok)'
              return (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      SSE: <span style={{ color: 'var(--accent)' }}>{sse.state}</span>
                    </span>
                    <span>{sse.total} frames</span>
                    {upSec !== null && <span>up {upSec}s</span>}
                    {staleSec !== null && (
                      <span style={{ color: staleColor }}>last frame {staleSec}s ago</span>
                    )}
                    {sse.reconnects > 0 && (
                      <span style={{ color: 'var(--warn)' }}>{sse.reconnects} reconnect{sse.reconnects > 1 ? 's' : ''}</span>
                    )}
                    {sse.errors > 0 && (
                      <span style={{ color: 'var(--text-dim)' }}>{sse.errors} error{sse.errors > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {/* Per-type breakdown — a stream that's "connected" but with a
                      whole event type stuck at 0 is the real bug most of the time. */}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--text-dim)' }}>
                    {SSE_EVENT_TYPES.map((t) => {
                      const n = sse.byType[t] ?? 0
                      return (
                        <span key={t}>
                          {t}: <span style={{ color: n > 0 ? 'var(--ok)' : 'var(--text-dim)' }}>{n}</span>
                        </span>
                      )
                    })}
                  </div>
                  {sse.lastPayload && (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all" style={{ color: 'var(--text-dim)' }}>
                      {sse.lastPayload}
                    </pre>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </header>

      {/* Recent errors ledger — the "what broke while I was away" panel.
          Only rendered when there's something to show. */}
      {errors.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--err)' }}>
              ⚠ Recent errors ({errors.length})
            </h2>
            <a href="/admin" className="cursor-pointer rounded border px-2 py-0.5 text-xs hover:opacity-80" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
              Manage in /admin
            </a>
          </div>
          <div className="overflow-hidden rounded border" style={{ borderColor: 'var(--err)' }}>
            {errors.map((e, i) => {
              const agoSec = Math.floor((now - e.lastAt) / 1000)
              const ago =
                agoSec < 60 ? `${agoSec}s ago`
                : agoSec < 3600 ? `${Math.floor(agoSec / 60)}m ago`
                : `${Math.floor(agoSec / 3600)}h ago`
              return (
                <div
                  key={e.path + e.status + e.message}
                  className="px-3 py-2 text-xs"
                  style={{
                    background: 'var(--surface)',
                    borderBottom: i < errors.length - 1 ? '1px solid var(--border)' : undefined,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold" style={{ color: e.status >= 500 ? 'var(--err)' : 'var(--warn)' }}>
                      {e.status}
                    </span>
                    <code style={{ color: 'var(--accent)' }}>{e.method} {e.path}</code>
                    <span style={{ color: 'var(--text-dim)' }}>{ago}</span>
                    {e.count > 1 && (
                      <span className="rounded px-1.5 font-bold" style={{ background: 'color-mix(in srgb, var(--err) 15%, transparent)', color: 'var(--err)' }}>
                        ×{e.count}
                      </span>
                    )}
                  </div>
                  <div className="mt-1" style={{ color: 'var(--text)' }}>{e.message}</div>
                  {e.details && (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all" style={{ color: 'var(--text-dim)' }}>
                      {e.details}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-dim)' }}>
            {errorSource === 'supabase'
              ? 'Durable (Supabase) — survives redeploys. Auto-refreshes every 15s.'
              : 'In-memory only — clears on redeploy. Run supabase/migrations/0001_api_errors.sql to persist. Auto-refreshes every 15s.'}
          </p>
        </section>
      )}

      {/* Endpoint groups */}
      {GROUPS.map((group) => (
        <section key={group} className="mb-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
            {group}
          </h2>
          <div className="overflow-hidden rounded border" style={{ borderColor: 'var(--border)' }}>
            {ENDPOINTS.filter((e) => e.group === group).map((ep, i, arr) => {
              const r = results[ep.path] ?? { state: 'idle' as const }
              const isOpen = expanded === ep.path
              const label = statusLabel(r, !!ep.deprecated)
              const dotColor = statusColor(r, !!ep.deprecated)
              return (
                <div
                  key={ep.path}
                  style={{
                    background: 'var(--surface)',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : undefined,
                    opacity: ep.deprecated ? 0.6 : 1,
                  }}
                >
                  <div className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
                    <span
                      className="w-11 shrink-0 text-xs font-bold"
                      style={{ color: ep.method === 'GET' ? 'var(--method-get)' : 'var(--method-post)' }}
                    >
                      {ep.method}
                    </span>
                    <code
                      className="min-w-0 flex-1 truncate text-xs"
                      style={ep.deprecated ? { textDecoration: 'line-through' } : undefined}
                    >
                      {ep.path}
                    </code>
                    {ep.deprecated && (
                      <span
                        className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold sm:inline"
                        style={{ background: 'color-mix(in srgb, var(--clay-terracotta) 15%, transparent)', color: 'var(--clay-terracotta-deep)' }}
                      >
                        DEPRECATED
                      </span>
                    )}
                    <span className="hidden shrink-0 text-xs sm:inline" style={{ color: 'var(--text-dim)' }}>
                      {r.state === 'done' && <>{r.status} · {r.latencyMs}ms</>}
                      {r.state === 'failed' && 'network error'}
                      {r.state === 'running' && '…'}
                      {label && <> · <span style={{ color: dotColor, fontWeight: 700 }}>{label}</span></>}
                    </span>
                    <button
                      onClick={() => runCheck(ep)}
                      className="shrink-0 cursor-pointer text-xs hover:opacity-80"
                      style={{ color: 'var(--accent)' }}
                    >
                      run
                    </button>
                    <button
                      onClick={() => setExpanded(isOpen ? null : ep.path)}
                      className="shrink-0 cursor-pointer text-xs hover:opacity-80"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="border-t px-3 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
                      <p style={{ color: 'var(--text-dim)' }}>{ep.description}</p>
                      <p className="mt-1" style={{ color: 'var(--text-dim)' }}>
                        Test request: <code>{ep.method} {ep.testPath}</code>
                      </p>
                      {ep.deprecated && (
                        <p className="mt-1 font-semibold" style={{ color: 'var(--clay-terracotta-deep)' }}>
                          Deprecated — use <code>{ep.deprecated.replacement}</code> instead.
                        </p>
                      )}
                      {r.preview && (
                        <pre
                          className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded p-2"
                          style={{ background: 'var(--bg)', color: 'var(--text-dim)' }}
                        >
                          {r.preview}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <footer className="mt-10 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
        BusGo Track API · GTFS data: Kigali · SSE stream at <code>/api/realtime/sse</code>
      </footer>
    </main>
  )
}

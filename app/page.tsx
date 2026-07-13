'use client'

/**
 * Developer status page for the Tega Transit API.
 *
 * This repo is API-only — the production frontend lives in a separate
 * repository. This page exists so a developer hitting the deployment root
 * can see at a glance whether every endpoint is behaving, and can exercise
 * each one (including the SSE stream) without leaving the browser.
 */

import { useCallback, useEffect, useState } from 'react'

// ─── endpoint catalog ─────────────────────────────────────────────────────────

interface EndpointDef {
  method: 'GET' | 'POST'
  path: string // display path
  testPath: string // actually requested (sample params filled in)
  description: string
  group: string
  body?: object // for POST tests
}

const ENDPOINTS: EndpointDef[] = [
  // System
  { group: 'System', method: 'GET', path: '/api/health', testPath: '/api/health', description: 'Liveness + database connectivity' },
  { group: 'System', method: 'GET', path: '/api/status', testPath: '/api/status', description: 'System status with SSE telemetry' },
  { group: 'System', method: 'GET', path: '/api/diagnostics', testPath: '/api/diagnostics', description: 'Per-vehicle health of crowdsourced pings' },

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
  { group: 'Deprecated', method: 'GET', path: '/api/arrivals', testPath: '/api/arrivals', description: 'Simulation-only demo — use /api/stops/{id}/arrivals' },
]

const GROUPS = ['System', 'Stops & Arrivals', 'GTFS Static', 'Realtime', 'Deprecated']

// ─── per-endpoint check state ─────────────────────────────────────────────────

interface CheckResult {
  state: 'idle' | 'running' | 'done' | 'failed'
  status?: number
  latencyMs?: number
  preview?: string
}

function statusColor(r: CheckResult): string {
  if (r.state === 'running') return 'var(--warn)'
  if (r.state === 'idle') return 'var(--text-dim)'
  if (r.state === 'failed' || (r.status ?? 500) >= 500) return 'var(--err)'
  if ((r.status ?? 0) >= 400) return 'var(--warn)'
  return 'var(--ok)'
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sse, setSse] = useState<{ state: string; messages: number; last: string }>({
    state: 'idle', messages: 0, last: '',
  })
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

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

  const testSse = useCallback(() => {
    setSse({ state: 'connecting', messages: 0, last: '' })
    const es = new EventSource('/api/realtime/sse?lat=-1.9403&lng=30.0618&radius=5000')
    let count = 0
    es.addEventListener('connected', () => setSse((s) => ({ ...s, state: 'streaming' })))
    es.addEventListener('message', (e) => {
      count += 1
      const last = e.data.length > 300 ? e.data.slice(0, 300) + ' …' : e.data
      setSse({ state: 'streaming', messages: count, last })
    })
    es.onerror = () => {
      es.close()
      setSse((s) => ({ ...s, state: s.messages > 0 ? 'closed (had messages)' : 'error' }))
    }
    // Sample for 8 seconds then close
    setTimeout(() => {
      es.close()
      setSse((s) => ({ ...s, state: `closed after 8s — ${count} messages` }))
    }, 8000)
  }, [])

  useEffect(() => {
    runAll()
  }, [runAll])

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
        <div className="flex items-center gap-3">
          <span className="text-2xl" style={{ color: 'var(--accent)' }}>▍</span>
          <h1 className="text-xl font-bold tracking-tight">Tega Transit API</h1>
          <span
            className="rounded px-2 py-0.5 text-xs font-bold"
            style={{ background: 'color-mix(in srgb, ' + overall.color + ' 15%, transparent)', color: overall.color }}
          >
            {overall.label}
          </span>
        </div>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-dim)' }}>
          GTFS + realtime transit API for Kigali. The production frontend lives in a separate
          repository — this page is the developer status board.
          {checkedAt && <> Last checked {checkedAt}.</>}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={runAll}
            className="cursor-pointer rounded border px-3 py-1 text-xs hover:opacity-80"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            ↻ Re-run all checks
          </button>
          <button
            onClick={testSse}
            className="cursor-pointer rounded border px-3 py-1 text-xs hover:opacity-80"
            style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
          >
            ⚡ Test SSE stream (8s)
          </button>
        </div>
        {sse.state !== 'idle' && (
          <div className="mt-3 rounded border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div>
              SSE: <span style={{ color: 'var(--accent)' }}>{sse.state}</span>
              {sse.messages > 0 && <> · {sse.messages} messages received</>}
            </div>
            {sse.last && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all" style={{ color: 'var(--text-dim)' }}>
                {sse.last}
              </pre>
            )}
          </div>
        )}
      </header>

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
              return (
                <div
                  key={ep.path}
                  style={{
                    background: 'var(--surface)',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : undefined,
                  }}
                >
                  <div className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(r) }} />
                    <span
                      className="w-11 shrink-0 text-xs font-bold"
                      style={{ color: ep.method === 'GET' ? 'var(--accent)' : 'var(--warn)' }}
                    >
                      {ep.method}
                    </span>
                    <code className="min-w-0 flex-1 truncate text-xs">{ep.path}</code>
                    <span className="hidden shrink-0 text-xs sm:inline" style={{ color: 'var(--text-dim)' }}>
                      {r.state === 'done' && <>{r.status} · {r.latencyMs}ms</>}
                      {r.state === 'failed' && 'network error'}
                      {r.state === 'running' && '…'}
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
        Tega Transit API · GTFS data: Kigali · SSE stream at <code>/api/realtime/sse</code>
      </footer>
    </main>
  )
}

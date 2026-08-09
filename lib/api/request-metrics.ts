/**
 * lib/api/request-metrics.ts — per-endpoint load metrics for the admin console.
 *
 * Answers "is the API under load, and where?" for a single Render instance:
 *   - every /api request is counted (middleware calls recordRequest once per
 *     request, before any route runs)
 *   - terminal statuses (2xx/3xx/4xx/5xx) + latency percentiles are recorded
 *     by route handlers (withRequestMetrics) and by middleware's own
 *     decisions (401/503/429)
 *   - rate-limit trips (429s) are tracked separately so a scraper or surge
 *     shows up as a signal, not just noise in the 4xx bucket
 *
 * In-memory by design: a live gauge is useless across a restart, and this
 * process is single-instance (see docs/DEPLOYMENT_GUIDE.md §Scaling). The
 * same Symbol.for singleton pattern as the other globalThis stores.
 */

import { TelemetryService } from './telemetry.service'

export interface RequestMetricsGroup {
  group: string
  requests: number
  status2xx: number
  status3xx: number
  status4xx: number
  status5xx: number
  rateLimited: number
  /** Rolling ring of the last LATENCY_RING_MAX response times (ms). */
  latency: number[]
  firstSeen: number
  lastSeen: number
}

const WINDOW_MS = 5 * 60 * 1000 // 5-minute rolling window
const LATENCY_RING_MAX = 200
const MAX_GROUPS = 200

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

class RequestMetricsTracker {
  readonly startedAt = Date.now()
  private groups = new Map<string, RequestMetricsGroup>()

  private ensure(group: string): RequestMetricsGroup {
    let g = this.groups.get(group)
    if (!g) {
      const now = Date.now()
      g = {
        group,
        requests: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        rateLimited: 0,
        latency: [],
        firstSeen: now,
        lastSeen: now,
      }
      this.groups.set(group, g)
      this.maybeEvict()
    }
    return g
  }

  private maybeEvict(): void {
    if (this.groups.size <= MAX_GROUPS) return
    // Drop the oldest group (Map preserves insertion order) to keep the map
    // bounded under synthetic traffic patterns.
    const oldest = this.groups.keys().next().value
    if (oldest !== undefined) this.groups.delete(oldest)
  }

  private roll(g: RequestMetricsGroup): void {
    if (Date.now() - g.lastSeen >= WINDOW_MS) {
      g.requests = 0
      g.status2xx = 0
      g.status3xx = 0
      g.status4xx = 0
      g.status5xx = 0
      g.rateLimited = 0
      g.latency.length = 0
    }
  }

  /** Count one API request. Called once per request from middleware. */
  recordRequest(group: string): void {
    const g = this.ensure(group)
    this.roll(g)
    g.lastSeen = Date.now()
    g.requests++
  }

  /**
   * Record a terminal response status + optional duration. Does NOT touch
   * `requests` (middleware already counted it) — this is the status/latency
   * half of the picture, so route handlers and middleware decisions can
   * both contribute without double-counting.
   */
  record(
    group: string,
    status: number,
    opts: { durationMs?: number; rateLimited?: boolean } = {}
  ): void {
    const g = this.ensure(group)
    this.roll(g)
    g.lastSeen = Date.now()
    if (status >= 500) g.status5xx++
    else if (status >= 400) g.status4xx++
    else if (status >= 300) g.status3xx++
    else g.status2xx++
    if (opts.rateLimited) g.rateLimited++
    if (opts.durationMs !== undefined && Number.isFinite(opts.durationMs)) {
      g.latency.push(opts.durationMs)
      if (g.latency.length > LATENCY_RING_MAX) {
        g.latency.splice(0, g.latency.length - LATENCY_RING_MAX)
      }
    }
  }

  /** Live snapshot for /api/admin/metrics. Groups sorted by request count. */
  snapshot(): RequestMetricsSnapshot {
    const now = Date.now()
    const elapsedMin = Math.max(1, (now - this.startedAt) / 60_000)

    const groups = [...this.groups.values()]
      .map((g) => {
        const sorted = [...g.latency].sort((a, b) => a - b)
        const requestsPerMin = g.requests / Math.max(1, (now - g.lastSeen + WINDOW_MS) / 60_000)
        return {
          group: g.group,
          requests: g.requests,
          requestsPerMin: Math.round(requestsPerMin * 10) / 10,
          status2xx: g.status2xx,
          status3xx: g.status3xx,
          status4xx: g.status4xx,
          status5xx: g.status5xx,
          rateLimited: g.rateLimited,
          p50Ms: percentile(sorted, 50),
          p95Ms: percentile(sorted, 95),
          avgMs: sorted.length
            ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
            : 0,
          lastSeen: g.lastSeen,
        }
      })
      .sort((a, b) => b.requests - a.requests)

    const totals = groups.reduce(
      (acc, g) => {
        acc.requests += g.requests
        acc.status2xx += g.status2xx
        acc.status3xx += g.status3xx
        acc.status4xx += g.status4xx
        acc.status5xx += g.status5xx
        acc.rateLimited += g.rateLimited
        return acc
      },
      { requests: 0, status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0, rateLimited: 0 }
    )

    const allLatency = groups.flatMap((g) =>
      // Re-derive from the raw ring for accurate totals percentiles.
      [...(this.groups.get(g.group)?.latency ?? [])]
    )
    const sortedAll = [...allLatency].sort((a, b) => a - b)

    return {
      windowSeconds: WINDOW_MS / 1000,
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((now - this.startedAt) / 1000),
      totals: {
        ...totals,
        requestsPerMin: Math.round((totals.requests / elapsedMin) * 10) / 10,
        p50Ms: percentile(sortedAll, 50),
        p95Ms: percentile(sortedAll, 95),
        avgMs: sortedAll.length
          ? Math.round(sortedAll.reduce((a, b) => a + b, 0) / sortedAll.length)
          : 0,
      },
      groups,
    }
  }

  /** Test hook — wipes all collected state. */
  __resetForTests(): void {
    this.groups.clear()
  }

  /** Test hook — backdates every group past the window so the next record rolls it. */
  __expireWindowForTests(): void {
    for (const g of this.groups.values()) {
      g.lastSeen = Date.now() - WINDOW_MS - 1000
    }
  }
}

export interface RequestMetricsSnapshot {
  windowSeconds: number
  generatedAt: string
  uptimeSeconds: number
  totals: {
    requests: number
    requestsPerMin: number
    status2xx: number
    status3xx: number
    status4xx: number
    status5xx: number
    rateLimited: number
    p50Ms: number
    p95Ms: number
    avgMs: number
  }
  groups: Array<{
    group: string
    requests: number
    requestsPerMin: number
    status2xx: number
    status3xx: number
    status4xx: number
    status5xx: number
    rateLimited: number
    p50Ms: number
    p95Ms: number
    avgMs: number
    lastSeen: number
  }>
}

const KEY = Symbol.for('tega.request-metrics')
type GlobalWithMetrics = typeof globalThis & { [KEY]?: RequestMetricsTracker }

const g = globalThis as GlobalWithMetrics
if (!g[KEY]) {
  g[KEY] = new RequestMetricsTracker()
}

export const RequestMetrics: RequestMetricsTracker = g[KEY]!

/**
 * Wrap a route handler body to record its status + latency into
 * RequestMetrics (and keep the legacy TelemetryService latency feed alive
 * for /api/status). Errors are re-thrown after recording a 500 so route
 * error handling is untouched.
 */
export async function withRequestMetrics<T extends Response>(
  group: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now()
  try {
    const res = await fn()
    const durationMs = Math.round(performance.now() - start)
    RequestMetrics.record(group, res.status, { durationMs })
    TelemetryService.recordLatency(durationMs)
    return res
  } catch (err) {
    const durationMs = Math.round(performance.now() - start)
    RequestMetrics.record(group, 500, { durationMs })
    TelemetryService.recordLatency(durationMs)
    throw err
  }
}

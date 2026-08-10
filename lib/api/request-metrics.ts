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
  /** Time-bucketed latency samples for the 30-minute trend sparkline. */
  history: Map<number, number[]>
  firstSeen: number
  lastSeen: number
}

/** One point in the per-endpoint latency trend, as exposed in snapshots. */
export interface LatencyHistoryPoint {
  /** Bucket start time (ms epoch). */
  t: number
  /** Samples recorded inside this bucket. */
  count: number
  p50Ms: number | null
  p95Ms: number | null
}

const WINDOW_MS = 5 * 60 * 1000 // 5-minute rolling window
const LATENCY_RING_MAX = 200
const MAX_GROUPS = 200

// 30-second buckets x 60 = a 30-minute trend, matching the sparkline window.
const HISTORY_BUCKET_MS = 30_000
const HISTORY_BUCKETS = 60
// Cap per-bucket samples so a 429 surge can't grow the history unboundedly.
const HISTORY_BUCKET_SAMPLES_MAX = 50

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

class RequestMetricsTracker {
  private nowFn: () => number = Date.now
  readonly startedAt = this.now()
  private groups = new Map<string, RequestMetricsGroup>()

  private now(): number {
    return this.nowFn()
  }

  private ensure(group: string): RequestMetricsGroup {
    let g = this.groups.get(group)
    if (!g) {
      const now = this.now()
      g = {
        group,
        requests: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        rateLimited: 0,
        latency: [],
        history: new Map(),
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
    if (this.now() - g.lastSeen >= WINDOW_MS) {
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
    g.lastSeen = this.now()
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
    g.lastSeen = this.now()
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
      // Bucket the sample for the trend sparkline, trimming the oldest bucket
      // once the map holds more than the 30-minute window.
      const bucket = Math.floor(this.now() / HISTORY_BUCKET_MS)
      let samples = g.history.get(bucket)
      if (!samples) {
        samples = []
        g.history.set(bucket, samples)
        while (g.history.size > HISTORY_BUCKETS) {
          const oldest = g.history.keys().next().value
          if (oldest !== undefined) g.history.delete(oldest)
        }
      }
      if (samples.length < HISTORY_BUCKET_SAMPLES_MAX) samples.push(opts.durationMs)
    }
  }

  /** Live snapshot for /api/admin/metrics. Groups sorted by request count. */
  snapshot(): RequestMetricsSnapshot {
    const now = this.now()
    const elapsedMin = Math.max(1, (now - this.startedAt) / 60_000)

    const nowBucket = Math.floor(now / HISTORY_BUCKET_MS)
    const startBucket = nowBucket - HISTORY_BUCKETS + 1

    const groups = [...this.groups.values()]
      .map((g) => {
        const sorted = [...g.latency].sort((a, b) => a - b)
        const requestsPerMin = g.requests / Math.max(1, (now - g.lastSeen + WINDOW_MS) / 60_000)
        // Uniform 30-minute series — empty buckets stay in the series as nulls
        // so the sparkline's x-axis is a real timeline, not sparse points.
        const history: LatencyHistoryPoint[] = []
        for (let b = startBucket; b <= nowBucket; b++) {
          const samples = g.history.get(b)
          if (samples && samples.length > 0) {
            const sortedSamples = [...samples].sort((a, b) => a - b)
            history.push({
              t: b * HISTORY_BUCKET_MS,
              count: samples.length,
              p50Ms: percentile(sortedSamples, 50),
              p95Ms: percentile(sortedSamples, 95),
            })
          } else {
            history.push({ t: b * HISTORY_BUCKET_MS, count: 0, p50Ms: null, p95Ms: null })
          }
        }
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
          history,
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
    this.nowFn = Date.now
  }

  /** Test hook — overrides the internal clock for deterministic bucketing. */
  __setNowForTests(fn: () => number): void {
    this.nowFn = fn
  }

  /** Test hook — backdates every group past the window so the next record rolls it. */
  __expireWindowForTests(): void {
    for (const g of this.groups.values()) {
      g.lastSeen = this.now() - WINDOW_MS - 1000
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
    history: LatencyHistoryPoint[]
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

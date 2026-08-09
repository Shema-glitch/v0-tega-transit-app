import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET } from './route'
import { RequestMetrics } from '@/lib/api/request-metrics'
import { LoadAlerts } from '@/lib/api/load-alerts'
import { __resetCacheForTests } from '@/lib/api/ttl-cache'

describe('GET /api/admin/metrics', () => {
  beforeEach(() => {
    RequestMetrics.__resetForTests()
    LoadAlerts.__resetForTests()
    __resetCacheForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the aggregate snapshot with sse and cache sections', async () => {
    RequestMetrics.recordRequest('stops.list')
    RequestMetrics.record('stops.list', 200, { durationMs: 15 })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.windowSeconds).toBe(300)
    expect(body.sse).toEqual({ active: 0, max: expect.any(Number) })
    expect(body.cache).toMatchObject({ hits: expect.any(Number), misses: expect.any(Number), hitRate: expect.any(Number) })
    // Pub/sub bridge state is reported even when Redis is unconfigured (no-op).
    expect(body.redis).toEqual({ connected: false, pubsub: { attached: false, channels: [] } })
    expect(body.totals.requests).toBe(1)
    expect(body.groups[0].group).toBe('stops.list')
    expect(body.alerts).toEqual({ active: [], recent: [] })
  })

  it('raises a load alert when a threshold is crossed', async () => {
    vi.stubEnv('LOAD_ALERT_RPM_THRESHOLD', '1')
    RequestMetrics.recordRequest('stops.list')
    RequestMetrics.record('stops.list', 200)

    const res = await GET()
    const body = await res.json()
    expect(body.alerts.active).toHaveLength(1)
    expect(body.alerts.active[0].kind).toBe('requests_per_min')
    expect(body.alerts.active[0].severity).toBe('warn')
  })

  it('reports an empty groups list when nothing has been recorded', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.groups).toEqual([])
    expect(body.totals.requests).toBe(0)
  })
})

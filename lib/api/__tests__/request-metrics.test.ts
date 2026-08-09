import { describe, it, expect, beforeEach } from 'vitest'
import { RequestMetrics, withRequestMetrics } from '../request-metrics'

describe('RequestMetrics', () => {
  beforeEach(() => {
    RequestMetrics.__resetForTests()
  })

  it('counts requests and statuses per group', () => {
    RequestMetrics.recordRequest('stops.list')
    RequestMetrics.recordRequest('stops.list')
    RequestMetrics.record('stops.list', 200, { durationMs: 12 })
    RequestMetrics.record('stops.list', 500)

    const snap = RequestMetrics.snapshot()
    const group = snap.groups.find((g) => g.group === 'stops.list')!
    expect(group.requests).toBe(2)
    expect(group.status2xx).toBe(1)
    expect(group.status5xx).toBe(1)
    expect(snap.totals.requests).toBe(2)
  })

  it('flags rate-limited responses separately from the 4xx bucket', () => {
    RequestMetrics.recordRequest('search.suggest')
    RequestMetrics.record('search.suggest', 429, { rateLimited: true })

    const group = RequestMetrics.snapshot().groups.find((g) => g.group === 'search.suggest')!
    expect(group.status4xx).toBe(1)
    expect(group.rateLimited).toBe(1)
    expect(group.requests).toBe(1)
  })

  it('computes p50/p95 percentiles from the latency ring', () => {
    for (let i = 1; i <= 100; i++) {
      RequestMetrics.recordRequest('stops.arrivals')
      RequestMetrics.record('stops.arrivals', 200, { durationMs: i })
    }

    const group = RequestMetrics.snapshot().groups.find((g) => g.group === 'stops.arrivals')!
    // p50 of 1..100 ≈ 50, p95 ≈ 95 (off-by-one tolerant)
    expect(group.p50Ms).toBeGreaterThanOrEqual(48)
    expect(group.p50Ms).toBeLessThanOrEqual(52)
    expect(group.p95Ms).toBeGreaterThanOrEqual(93)
    expect(group.p95Ms).toBeLessThanOrEqual(97)
  })

  it('rolls the window counters after the 5-minute window', () => {
    RequestMetrics.recordRequest('routes.shape')
    expect(RequestMetrics.snapshot().groups.find((x) => x.group === 'routes.shape')!.requests).toBe(1)

    RequestMetrics.__expireWindowForTests()
    RequestMetrics.recordRequest('routes.shape')
    const group = RequestMetrics.snapshot().groups.find((x) => x.group === 'routes.shape')!
    expect(group.requests).toBe(1) // the pre-expiry count is gone
  })

  it('sorts groups by request count in the snapshot', () => {
    RequestMetrics.recordRequest('a')
    RequestMetrics.recordRequest('b')
    RequestMetrics.recordRequest('b')
    RequestMetrics.recordRequest('b')
    const groups = RequestMetrics.snapshot().groups
    expect(groups[0].group).toBe('b')
    expect(groups[1].group).toBe('a')
  })

  it('reports uptime and window seconds', () => {
    const snap = RequestMetrics.snapshot()
    expect(snap.windowSeconds).toBe(300)
    expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })
})

describe('withRequestMetrics', () => {
  beforeEach(() => {
    RequestMetrics.__resetForTests()
  })

  it('records the response status and latency for a successful handler', async () => {
    const res = new Response('{}', { status: 200 })
    const out = await withRequestMetrics('stops.list', async () => res)
    expect(out).toBe(res)

    const group = RequestMetrics.snapshot().groups.find((g) => g.group === 'stops.list')!
    expect(group.status2xx).toBe(1)
    expect(group.requests).toBe(0) // middleware counts requests, not the wrapper
    expect(group.avgMs).toBeGreaterThanOrEqual(0)
  })

  it('records a 500 and re-throws when the handler throws', async () => {
    await expect(
      withRequestMetrics('routes.shape', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    const group = RequestMetrics.snapshot().groups.find((g) => g.group === 'routes.shape')!
    expect(group.status5xx).toBe(1)
  })
})

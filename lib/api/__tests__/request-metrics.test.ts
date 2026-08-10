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

  it('buckets latency into a uniform 30-minute history series', () => {
    let t = 1_750_000_000_000
    RequestMetrics.__setNowForTests(() => t)

    // 10 samples land in the first 30s bucket
    for (let i = 1; i <= 10; i++) {
      RequestMetrics.record('stops.list', 200, { durationMs: i * 10 })
    }
    // jump forward 60s → two buckets later, one sample
    t += 60_000
    RequestMetrics.record('stops.list', 200, { durationMs: 500 })

    const group = RequestMetrics.snapshot().groups.find((g) => g.group === 'stops.list')!
    expect(group.history).toHaveLength(60)

    // newest bucket (current) holds the 500ms sample
    const last = group.history[group.history.length - 1]
    expect(last.count).toBe(1)
    expect(last.p50Ms).toBe(500)

    // the bucket two steps back holds the 10 samples → p50 ≈ 50, p95 ≈ 100
    const earlier = group.history.find((h) => h.count === 10)!
    expect(earlier.p50Ms).toBeGreaterThanOrEqual(50)
    expect(earlier.p50Ms).toBeLessThanOrEqual(60)
    expect(earlier.p95Ms).toBeGreaterThanOrEqual(95)
    expect(earlier.p95Ms).toBeLessThanOrEqual(100)

    // empty buckets stay in the series as nulls so the x-axis is a real timeline
    expect(group.history.some((h) => h.count === 0 && h.p50Ms === null)).toBe(true)
  })

  it('keeps only the last 30 minutes of history buckets', () => {
    let t = 1_750_000_000_000
    RequestMetrics.__setNowForTests(() => t)
    for (let i = 0; i < 70; i++) {
      RequestMetrics.record('stops.list', 200, { durationMs: 10 })
      t += 31_000 // every step lands in a fresh bucket
    }

    const group = RequestMetrics.snapshot().groups.find((g) => g.group === 'stops.list')!
    expect(group.history).toHaveLength(60)
    // nothing older than the 30-minute window survives (with bucket tolerance)
    expect(group.history[0].t).toBeGreaterThanOrEqual(t - 31 * 60_000)
    expect(group.history[group.history.length - 1].t).toBeLessThanOrEqual(t)
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

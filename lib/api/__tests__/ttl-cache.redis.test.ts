import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cacheWrap, cacheGet, cacheStats, __resetCacheForTests } from '../ttl-cache'

// vi.hoisted: the mock factory is hoisted above imports, so any state it
// needs must be created here, not as top-level vi.fn()s.
const h = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))

vi.mock('@/lib/api/redis', () => ({
  getRedisClient: () => ({ get: h.get, set: h.set }),
  __resetRedisForTests: () => {},
}))

describe('ttl-cache with Redis L2', () => {
  beforeEach(() => {
    __resetCacheForTests()
    vi.clearAllMocks()
    h.set.mockResolvedValue('OK')
  })

  it('serves a Redis hit without calling fn, and warms the memory layer', async () => {
    h.get.mockResolvedValue('from-redis')
    const fn = vi.fn(async () => 'from-db')

    const out = await cacheWrap('k', 1000, fn)
    expect(out).toBe('from-redis')
    expect(fn).not.toHaveBeenCalled()
    expect(h.get).toHaveBeenCalledWith('busgo-cache:k')

    // L1 is now warm from the L2 hit — a second call never touches Redis.
    expect(cacheGet('k')).toBe('from-redis')
    const stats = cacheStats()
    expect(stats.redisHits).toBe(1)
    expect(stats.entries).toBe(1)
  })

  it('fetches from source on a Redis miss and writes through to Redis', async () => {
    h.get.mockResolvedValue(null)
    const fn = vi.fn(async () => 42)

    const out = await cacheWrap('k2', 1000, fn)
    expect(out).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(h.set).toHaveBeenCalledWith('busgo-cache:k2', 42, { ex: 1 })
  })

  it('falls back to the fetch when Redis reads fail', async () => {
    h.get.mockRejectedValue(new Error('redis down'))
    const fn = vi.fn(async () => 'db-value')

    const out = await cacheWrap('k3', 1000, fn)
    expect(out).toBe('db-value')
    expect(fn).toHaveBeenCalledTimes(1)
    // Write-through is fire-and-forget: a failed set never surfaces.
    h.set.mockRejectedValue(new Error('write failed'))
    const again = await cacheWrap('k3', 1000, fn)
    expect(again).toBe('db-value') // memory hit — no redis read
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not write through when the fetch fails', async () => {
    h.get.mockResolvedValue(null)
    const fn = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(cacheWrap('k4', 1000, fn)).rejects.toThrow('db down')
    expect(h.set).not.toHaveBeenCalled()
  })
})

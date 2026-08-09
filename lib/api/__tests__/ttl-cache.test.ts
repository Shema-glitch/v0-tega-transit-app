import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cacheGet, cacheSet, cacheWrap, cacheStats, __resetCacheForTests } from '../ttl-cache'

describe('ttl-cache', () => {
  beforeEach(() => {
    __resetCacheForTests()
  })

  it('returns undefined on miss and the value on hit', () => {
    expect(cacheGet('k')).toBeUndefined()
    cacheSet('k', { a: 1 }, 1000)
    expect(cacheGet('k')).toEqual({ a: 1 })
  })

  it('expires entries after the TTL', () => {
    cacheSet('k', 'v', 1)
    expect(cacheGet('k')).toBe('v')
    vi.useFakeTimers()
    vi.advanceTimersByTime(5)
    expect(cacheGet('k')).toBeUndefined()
    vi.useRealTimers()
  })

  it('cacheWrap calls fn once, serves repeats from cache', async () => {
    const fn = vi.fn(async () => 42)
    expect(await cacheWrap('k', 1000, fn)).toBe(42)
    expect(await cacheWrap('k', 1000, fn)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cacheWrap single-flights concurrent callers onto one fn call', async () => {
    const fn = vi.fn(async () => 7)
    const results = await Promise.all([
      cacheWrap('k', 1000, fn),
      cacheWrap('k', 1000, fn),
      cacheWrap('k', 1000, fn),
    ])
    expect(results).toEqual([7, 7, 7])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not cache a rejected fn — the next call retries', async () => {
    const fn = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(5)

    await expect(cacheWrap('k', 1000, fn)).rejects.toThrow('db down')
    expect(await cacheWrap('k', 1000, fn)).toBe(5)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight promise after completion so a re-fetch is possible', async () => {
    const fn = vi.fn(async () => 1)
    await cacheWrap('k', 0, fn) // TTL 0 → immediately expired
    await cacheWrap('k', 0, fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('tracks hit/miss stats and entry count', async () => {
    await cacheWrap('a', 1000, async () => 1)
    await cacheWrap('a', 1000, async () => 2) // hit — the stored 1 comes back
    const stats = cacheStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1) // only the first wrap missed
    expect(stats.entries).toBe(1)
  })
})

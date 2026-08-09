import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RateLimiterStore } from '@/lib/api/rate-limiter'

// vi.hoisted: the mock factory runs lazily but is *hoisted* above the imports,
// so any state it needs must be created here, not as top-level vi.fn()s.
const h = vi.hoisted(() => ({
  multi: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@/lib/api/redis', () => ({
  getRedisClient: () => ({
    // Chainable pipeline, like the real Upstash multi(): each command records
    // its args on the spies and returns the pipeline; exec resolves the result.
    multi: () => {
      const pipeline = {
        incr: (key: string) => {
          h.incr(key)
          return pipeline
        },
        expire: (key: string, seconds: number, option?: string) => {
          h.expire(key, seconds, option)
          return pipeline
        },
        exec: () => h.exec(),
      }
      return pipeline
    },
  }),
  __resetRedisForTests: () => {},
}))

function uniqueKey(label: string): string {
  return `test:${label}:${Math.random().toString(36).slice(2)}`
}

describe('RateLimiterStore with Redis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: incr → count 1, expire → ttl 60
    h.incr.mockReturnValue({})
    h.expire.mockReturnValue({})
    h.exec.mockResolvedValue([1, 60])
  })

  it('uses the Redis counter and reports remaining against the limit', async () => {
    h.exec.mockResolvedValue([3, 45])
    const res = await RateLimiterStore.check(uniqueKey('redis'), 5, 60_000)
    expect(res).toEqual({ allowed: true, remaining: 2, resetAt: expect.any(Number) })
    expect(h.incr).toHaveBeenCalled()
    expect(h.expire).toHaveBeenCalledWith(expect.stringMatching(/^rl:/), 60, 'NX')
  })

  it('blocks when the Redis count exceeds the limit', async () => {
    h.exec.mockResolvedValue([6, 30])
    const res = await RateLimiterStore.check(uniqueKey('redis-block'), 5, 60_000)
    expect(res.allowed).toBe(false)
    expect(res.remaining).toBe(0)
  })

  it('falls back to the in-memory window when Redis errors', async () => {
    h.exec.mockRejectedValue(new Error('redis down'))
    const key = uniqueKey('fallback')
    for (let i = 0; i < 3; i++) {
      expect((await RateLimiterStore.check(key, 3, 60_000)).allowed).toBe(true)
    }
    const fourth = await RateLimiterStore.check(key, 3, 60_000)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
  })
})

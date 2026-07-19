import { describe, it, expect } from 'vitest'
import { RateLimiterStore } from '@/lib/api/rate-limiter'

// RateLimiterStore is a process-wide singleton (globalThis), so each test
// uses its own unique key to avoid interfering with other tests' windows.
function uniqueKey(label: string): string {
  return `test:${label}:${Math.random().toString(36).slice(2)}`
}

describe('RateLimiterStore', () => {
  it('allows requests up to the limit', () => {
    const key = uniqueKey('under-limit')
    for (let i = 0; i < 5; i++) {
      const result = RateLimiterStore.check(key, 5, 60_000)
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks requests once the limit is exceeded', () => {
    const key = uniqueKey('over-limit')
    for (let i = 0; i < 5; i++) RateLimiterStore.check(key, 5, 60_000)
    const sixth = RateLimiterStore.check(key, 5, 60_000)
    expect(sixth.allowed).toBe(false)
    expect(sixth.remaining).toBe(0)
  })

  it('tracks remaining count correctly as requests come in', () => {
    const key = uniqueKey('remaining')
    expect(RateLimiterStore.check(key, 3, 60_000).remaining).toBe(2)
    expect(RateLimiterStore.check(key, 3, 60_000).remaining).toBe(1)
    expect(RateLimiterStore.check(key, 3, 60_000).remaining).toBe(0)
  })

  it('resets the window after it expires', async () => {
    const key = uniqueKey('reset')
    for (let i = 0; i < 3; i++) RateLimiterStore.check(key, 3, 50)
    expect(RateLimiterStore.check(key, 3, 50).allowed).toBe(false)

    await new Promise((r) => setTimeout(r, 60))

    expect(RateLimiterStore.check(key, 3, 50).allowed).toBe(true)
  })

  it('keeps separate windows for separate keys', () => {
    const keyA = uniqueKey('a')
    const keyB = uniqueKey('b')
    for (let i = 0; i < 5; i++) RateLimiterStore.check(keyA, 5, 60_000)
    // keyA is now exhausted, but keyB should be untouched
    expect(RateLimiterStore.check(keyB, 5, 60_000).allowed).toBe(true)
  })
})

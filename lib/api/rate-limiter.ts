/**
 * Per-IP rate limiter.
 *
 * Fixed-window counter keyed by `${ip}:${routeGroup}` — cheap and good enough
 * to stop a script hammering one endpoint or a scraper crawling the whole
 * API, which is the realistic threat for a public transit API with no
 * sensitive data. It will NOT stop a real distributed (multi-IP) DDoS —
 * that needs a CDN/WAF in front (e.g. Cloudflare), not app code.
 *
 * Backed by Redis when configured (lib/api/redis.ts): the window is an
 * INCR + NX-EXPIRE key, so multiple instances count as ONE budget (the
 * prerequisite for horizontal scaling). Without Redis, it uses the shared
 * in-memory map (single instance — the long-standing behavior). A Redis
 * failure falls back to the in-memory window for that request, so an
 * outage never opens the gate.
 */

import { Redis } from '@upstash/redis'
import { getRedisClient } from './redis'

interface Window {
  count: number
  resetAt: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

const MAX_TRACKED_KEYS = 5000

class RateLimiter {
  private windows = new Map<string, Window>()

  /** Returns whether the request is allowed, plus metadata for headers. */
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redis = getRedisClient()
    if (redis) {
      try {
        return await this.redisCheck(redis, key, limit, windowMs)
      } catch (err) {
        console.warn('[rate-limiter] Redis check failed, falling back to in-memory:', err)
      }
    }
    return this.memoryCheck(key, limit, windowMs)
  }

  private memoryCheck(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now()
    const existing = this.windows.get(key)

    if (!existing || now >= existing.resetAt) {
      const resetAt = now + windowMs
      this.windows.set(key, { count: 1, resetAt })
      this.maybeEvict(now)
      return { allowed: true, remaining: limit - 1, resetAt }
    }

    existing.count++
    return {
      allowed: existing.count <= limit,
      remaining: Math.max(0, limit - existing.count),
      resetAt: existing.resetAt,
    }
  }

  /**
   * Atomic INCR + TTL via MULTI: the first request in a window sets the
   * expiry (NX), every request increments. `count` is the position in the
   * window; `ttl` drives the Retry-After header.
   */
  private async redisCheck(redis: Redis, key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now()
    const ttlSec = Math.max(1, Math.ceil(windowMs / 1000))
    const [count, ttl] = (await redis
      .multi()
      .incr(`rl:${key}`)
      .expire(`rl:${key}`, ttlSec, 'NX')
      .exec()) as [number, number]

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: now + (ttl > 0 ? ttl : ttlSec) * 1000,
    }
  }

  /** Sweep expired windows so the map can't grow unbounded under scraping/abuse. */
  private maybeEvict(now: number): void {
    if (this.windows.size <= MAX_TRACKED_KEYS) return
    for (const [k, w] of this.windows) {
      if (now >= w.resetAt) this.windows.delete(k)
    }
  }
}

const KEY = Symbol.for('tega.rate-limiter')
type GlobalWithLimiter = typeof globalThis & { [KEY]?: RateLimiter }

const g = globalThis as GlobalWithLimiter
if (!g[KEY]) {
  g[KEY] = new RateLimiter()
}

export const RateLimiterStore: RateLimiter = g[KEY]!

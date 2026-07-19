/**
 * In-memory per-IP rate limiter.
 *
 * Fixed-window counter keyed by `${ip}:${routeGroup}` — cheap and good enough
 * to stop a script hammering one endpoint or a scraper crawling the whole
 * API, which is the realistic threat for a public transit API with no
 * sensitive data. It will NOT stop a real distributed (multi-IP) DDoS —
 * that needs a CDN/WAF in front (e.g. Cloudflare), not app code.
 *
 * Lives in the same Node.js process as the route handlers (see
 * middleware.ts, which runs on the nodejs runtime), so it shares memory the
 * same way the other globalThis singletons in this codebase do (RealtimeHub,
 * ErrorLog, etc.). Single Render instance only — if this ever runs on
 * multiple instances behind a load balancer, each instance counts
 * independently, which just makes the effective limit N-instances higher.
 */

interface Window {
  count: number
  resetAt: number
}

const MAX_TRACKED_KEYS = 5000

class RateLimiter {
  private windows = new Map<string, Window>()

  /** Returns whether the request is allowed, plus metadata for headers. */
  check(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
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

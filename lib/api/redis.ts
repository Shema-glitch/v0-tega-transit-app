/**
 * lib/api/redis.ts — the optional Redis layer (Upstash, REST-based).
 *
 * Enables the two things that make this API "hundreds of users" friendly
 * across restarts and (eventually) multiple instances:
 *   - a shared TTL cache (memory L1 → Redis L2 → Supabase)
 *   - a shared per-IP rate limiter (so N instances count as ONE budget)
 *
 * Configuration (either pair works):
 *   UPSTASH_REDIS_REST_URL  + UPSTASH_REDIS_REST_TOKEN   (Upstash REST)
 *   REDIS_URL                                          (+ REDIS_URL tokenless)
 *
 * Graceful by design: when unconfigured, getRedisClient() returns null and
 * every consumer silently keeps its in-memory behavior — the exact same
 * code path as before Redis existed. A failed command also falls back (the
 * callers catch and continue in-memory), so an outage never breaks reads.
 */

import { Redis } from '@upstash/redis'

let client: Redis | null | undefined = undefined // undefined = not yet resolved

/** Returns the shared Redis client, or null when Redis is not configured. */
export function getRedisClient(): Redis | null {
  if (client !== undefined) return client

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL || ''
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || ''
  if (!url) {
    client = null
    return null
  }

  try {
    // Constructing the REST client is stateless/cheap — no connection pool.
    // A missing token still constructs (requests then fail auth → callers
    // fall back to memory), so `token` is always passed to satisfy the type.
    client = new Redis({ url, token })
  } catch {
    client = null
  }
  return client
}

// Health probe is cached so the admin metrics route doesn't ping Redis on
// every 10s poll.
let healthCache: { ok: boolean; at: number } | null = null

export async function redisHealth(): Promise<boolean> {
  const now = Date.now()
  if (healthCache && now - healthCache.at < 30_000) return healthCache.ok

  let ok = false
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.ping()
      ok = true
    } catch {
      ok = false
    }
  }
  healthCache = { ok, at: now }
  return ok
}

/** Test hook — forgets the cached client + health so tests can inject env/mocks. */
export function __resetRedisForTests(): void {
  client = undefined
  healthCache = null
}

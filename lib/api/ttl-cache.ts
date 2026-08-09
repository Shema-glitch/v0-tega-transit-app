/**
 * lib/api/ttl-cache.ts — tiny cache-aside TTL store with single-flight.
 *
 * The pattern behind "hundreds of people searching without hammering
 * Supabase": the first request for a key computes the value (one DB query),
 * concurrent callers share that one in-flight fetch, and everyone for the
 * next TTL reads from memory. Used by the GTFS static endpoints and the
 * arrivals micro-cache — see docs/DEPLOYMENT_GUIDE.md §Scaling.
 *
 * Failure policy: a rejected `fn` is never cached, so a transient DB outage
 * doesn't get frozen into the cache.
 *
 * Layered with Redis when configured (see lib/api/redis.ts): memory is the
 * L1 fast path (with single-flight), Redis is the L2 shared across restarts
 * and instances. A Redis miss still computes from source; a Redis hit
 * populates memory and skips the DB entirely. Redis failures are swallowed
 * — the cache degrades to memory-only, never to errors.
 */

import { getRedisClient } from './redis'

interface Entry {
  expiresAt: number
  value: unknown
}

const store = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

const MAX_ENTRIES = 2000

let hits = 0
let misses = 0
let redisHits = 0

function redisKey(key: string): string {
  return `busgo-cache:${key}`
}

function evict(now: number): void {
  // First sweep expired entries; if still over budget, drop oldest by
  // insertion order (Map guarantees it).
  for (const [k, e] of store) {
    if (e.expiresAt <= now) store.delete(k)
  }
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/** Synchronous read — returns undefined on miss/expiry. */
export function cacheGet<T>(key: string): T | undefined {
  const now = Date.now()
  const entry = store.get(key)
  if (entry && entry.expiresAt > now) {
    hits++
    return entry.value as T
  }
  if (entry) store.delete(key)
  return undefined
}

/** Synchronous write — mostly used by cacheWrap, exposed for admin invalidation. */
export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now()
  if (store.size >= MAX_ENTRIES) evict(now)
  store.set(key, { expiresAt: now + ttlMs, value })
}

/** Cache-aside with single-flight: concurrent callers share one fn() call. */
export async function cacheWrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  // L1 — memory fast path
  const hit = cacheGet<T>(key)
  if (hit !== undefined) return hit

  // L2 — shared Redis layer (skip on any failure; the fetch below recomputes)
  const redis = getRedisClient()
  if (redis) {
    try {
      const remote = await redis.get<T>(redisKey(key))
      if (remote !== null && remote !== undefined) {
        redisHits++
        cacheSet(key, remote, ttlMs) // warm L1 from L2
        return remote
      }
    } catch {
      // Redis down → behave as if it doesn't exist
    }
  }

  // L1 single-flight: concurrent callers in THIS process share one fn() call.
  // (Across instances, the Redis TTL bounds the stampede instead.)
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  misses++
  const p = Promise.resolve()
    .then(fn)
    .then((value) => {
      cacheSet(key, value, ttlMs)
      // Fire-and-forget write-through to L2 — never blocks the response.
      if (redis) {
        redis.set(redisKey(key), value, { ex: Math.max(1, Math.ceil(ttlMs / 1000)) }).catch(() => {})
      }
      return value
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, p)
  return p
}

/** Hit/miss/entry stats for the admin Load panel's cache line. */
export function cacheStats(): { hits: number; misses: number; entries: number; redisHits: number } {
  return { hits, misses, entries: store.size, redisHits }
}

/** Test hook — wipes state so tests don't bleed into each other. */
export function __resetCacheForTests(): void {
  store.clear()
  inflight.clear()
  hits = 0
  misses = 0
  redisHits = 0
}

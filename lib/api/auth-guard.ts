/**
 * lib/api/auth-guard.ts — brute-force defense for the auth endpoints.
 *
 * Two layers, both in-memory (per process — fine for a single Render instance):
 *  1. Per-IP exponential lockout: after FAIL_THRESHOLD failures an IP is
 *     locked for a window that grows with each subsequent lockout.
 *  2. Global circuit breaker: if failures cluster across many IPs inside a
 *     window (a distributed brute force), the whole auth flow fails closed
 *     for a cooldown so botnets can't just rotate IPs.
 */

const FAIL_THRESHOLD = 5
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 24 * 3_600_000]

const BREAKER_WINDOW_MS = 60_000
const BREAKER_THRESHOLD = 20
const BREAKER_COOLDOWN_MS = 5 * 60_000

interface IpEntry {
  fails: number
  lockedUntil: number
}

const ipEntries = new Map<string, IpEntry>()

let breakerWindowStart = Date.now()
let breakerFailures = 0
let breakerOpenUntil = 0

function backoffMs(fails: number): number {
  const idx = Math.min(Math.max(fails, 1) - 1, BACKOFF_MS.length - 1)
  return BACKOFF_MS[idx]
}

export function getAuthGuardStatus(ip: string): { blocked: boolean; retryAfterSec: number } {
  const now = Date.now()
  if (breakerOpenUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((breakerOpenUntil - now) / 1000) }
  }
  const entry = ipEntries.get(ip)
  if (entry && entry.lockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) }
  }
  return { blocked: false, retryAfterSec: 0 }
}

export function recordAuthFailure(ip: string): void {
  const now = Date.now()
  const entry = ipEntries.get(ip) ?? { fails: 0, lockedUntil: 0 }
  entry.fails += 1
  if (entry.fails >= FAIL_THRESHOLD) {
    entry.lockedUntil = now + backoffMs(entry.fails)
    entry.fails = 0
  }
  ipEntries.set(ip, entry)

  // Global circuit breaker — a burst of failures across IPs trips it.
  if (now - breakerWindowStart > BREAKER_WINDOW_MS) {
    breakerWindowStart = now
    breakerFailures = 0
  }
  breakerFailures += 1
  if (breakerFailures >= BREAKER_THRESHOLD) {
    breakerOpenUntil = now + BREAKER_COOLDOWN_MS
    breakerFailures = 0
    breakerWindowStart = now
  }
}

export function recordAuthSuccess(ip: string): void {
  ipEntries.delete(ip)
}

/** Test-only reset — clears all lockout and breaker state. */
export function resetAuthGuard(): void {
  ipEntries.clear()
  breakerWindowStart = Date.now()
  breakerFailures = 0
  breakerOpenUntil = 0
}

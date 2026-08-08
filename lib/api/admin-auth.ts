/**
 * lib/api/admin-auth.ts — the single gate for admin access.
 *
 * Credentials accepted, in order of preference:
 *  1. `admin_session` cookie — a short-lived HMAC session set after a
 *     successful Supabase magic-code login (HttpOnly, SameSite=Strict, so the
 *     raw credential never lives in browser storage).
 *  2. `x-admin-token` header — the legacy shared ADMIN_TOKEN, still accepted
 *     (constant-time) so the rider frontend's Debug Mode and any scripts keep
 *     working unchanged.
 *  3. `x-admin-token` header = `ephem.…` — a short-lived signed token minted
 *     by /admin/debug for a browser that already holds a valid session, so the
 *     "Open app in Debug Mode" button works without the shared token ever
 *     touching the browser.
 *
 * Every comparison is constant-time — there is no fast-path `===` anywhere.
 * The HMAC key is ADMIN_SESSION_SECRET, falling back to ADMIN_TOKEN so an
 * existing deployment keeps working until the new env var is added.
 */

import crypto from 'crypto'

export const SESSION_COOKIE = 'admin_session'
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours absolute cap
// "Not in use for ~15 min → kill the session". Each authenticated request that
// passes the idle check re-issues the cookie (throttled to every 5 min), so
// active use keeps the session alive while a session that sits unused — or a
// captured cookie replayed later — dies within 15 minutes server-side.
export const SESSION_IDLE_MS = 15 * 60 * 1000
export const SESSION_REFRESH_MS = 5 * 60 * 1000 // re-sign at most this often
const EPHEMERAL_TTL_MS = 5 * 60 * 1000 // 5 minutes
const EPHEMERAL_PREFIX = 'ephem.'
const EXP_SLACK_MS = 60_000 // allow clock skew without widening the window much

interface SessionPayload {
  email: string
  iat: number // last activity — sliding idle window
  exp: number
}

function secret(): string | null {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN
  return s && s.trim() ? s.trim() : null
}

/** Constant-time string comparison (hash both sides to a fixed length first). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest()
  const bh = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ah, bh)
}

function sign(email: string, ttlMs: number): string | null {
  const key = secret()
  if (!key) return null
  const now = Date.now()
  const body = Buffer.from(JSON.stringify({ email, iat: now, exp: now + ttlMs })).toString('base64url')
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verify(value: string, ttlMs: number, idleMs?: number): SessionPayload | null {
  const key = secret()
  if (!key) return null
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = crypto.createHmac('sha256', key).update(body).digest('base64url')
  if (!timingSafeEqualStr(sig, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (
      typeof payload.email !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }
    if (payload.exp < Date.now()) return null // expired
    if (payload.exp > Date.now() + ttlMs + EXP_SLACK_MS) return null // tampered/timeless
    if (idleMs && Date.now() - payload.iat > idleMs) return null // idle → dead
    return payload
  } catch {
    return null
  }
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export interface AuthRequestLike {
  headers: { get(name: string): string | null }
}

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'no-credential' | 'invalid' }

/**
 * The single auth gate used by middleware and every admin route handler.
 */
export function checkAdminAuth(request: AuthRequestLike): AdminAuthResult {
  const cookies = parseCookies(request.headers.get('cookie'))
  const session = cookies[SESSION_COOKIE]
  if (session) {
    const payload = verify(session, SESSION_TTL_MS, SESSION_IDLE_MS)
    if (payload) return { ok: true, email: payload.email }
  }

  const token = request.headers.get('x-admin-token')
  if (token) {
    const real = process.env.ADMIN_TOKEN
    if (real && timingSafeEqualStr(token, real)) return { ok: true, email: 'shared-token' }
    if (token.startsWith(EPHEMERAL_PREFIX)) {
      const payload = verify(token.slice(EPHEMERAL_PREFIX.length), EPHEMERAL_TTL_MS)
      if (payload) return { ok: true, email: payload.email }
    }
  }

  return { ok: false, reason: session || token ? 'invalid' : 'no-credential' }
}

export function createSessionCookieValue(email: string): string | null {
  return sign(email, SESSION_TTL_MS)
}

/** For tests / introspection — decodes a session cookie value (idle-checked). */
export function verifySessionCookieValue(value: string): string | null {
  return verify(value, SESSION_TTL_MS, SESSION_IDLE_MS)?.email ?? null
}

export function createEphemeralToken(email: string): string | null {
  const v = sign(email, EPHEMERAL_TTL_MS)
  return v ? `${EPHEMERAL_PREFIX}${v}` : null
}

/**
 * Returns a fresh `Set-Cookie` header value when the caller holds a valid
 * session whose `iat` is older than the refresh threshold (sliding expiry), or
 * null when there is nothing to refresh (no cookie, stale/idle session, or the
 * cookie was just re-issued). Middleware attaches the result to authenticated
 * responses; the login/dashboard session check does the same.
 */
export function maybeRefreshSessionCookie(request: AuthRequestLike): string | null {
  const cookies = parseCookies(request.headers.get('cookie'))
  const value = cookies[SESSION_COOKIE]
  if (!value) return null
  const payload = verify(value, SESSION_TTL_MS, SESSION_IDLE_MS)
  if (!payload) return null
  if (Date.now() - payload.iat < SESSION_REFRESH_MS) return null // fresh enough
  return sessionCookieHeader(payload.email)
}

/**
 * Milliseconds until the caller's session would be killed for inactivity
 * (0 when a valid session's idle window has already elapsed), or null when
 * there is no valid session. Used by /api/auth/session to tell the login page
 * how long it has before the idle timer fires.
 */
export function sessionIdleRemainingMs(request: AuthRequestLike): number | null {
  const cookies = parseCookies(request.headers.get('cookie'))
  const value = cookies[SESSION_COOKIE]
  if (!value) return null
  const payload = verify(value, SESSION_TTL_MS, SESSION_IDLE_MS)
  if (!payload) return null
  return Math.max(0, SESSION_IDLE_MS - (Date.now() - payload.iat))
}

export function verifyEphemeralToken(value: string): string | null {
  if (!value.startsWith(EPHEMERAL_PREFIX)) return null
  return verify(value.slice(EPHEMERAL_PREFIX.length), EPHEMERAL_TTL_MS)?.email ?? null
}

export function isAllowlistedAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email.trim().toLowerCase())
}

export function sessionCookieHeader(email: string): string | null {
  const value = createSessionCookieValue(email)
  if (!value) return null
  const secure = process.env.NODE_ENV === 'production'
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}${secure ? '; Secure' : ''}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
}

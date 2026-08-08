import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  checkAdminAuth,
  createSessionCookieValue,
  verifySessionCookieValue,
  createEphemeralToken,
  verifyEphemeralToken,
  isAllowlistedAdmin,
  maybeRefreshSessionCookie,
  sessionIdleRemainingMs,
} from '@/lib/api/admin-auth'

function fakeRequest(headers: Record<string, string | null> = {}) {
  return { headers: { get: (name: string) => headers[name] ?? null } }
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = 'test-admin-token-0123456789abcdef'
  process.env.ADMIN_EMAILS = 'sonyxperiame1@gmail.com, dev@example.com'
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
  delete process.env.ADMIN_SESSION_SECRET
  delete process.env.ADMIN_EMAILS
  vi.useRealTimers()
})

describe('session cookie', () => {
  it('round-trips a signed session cookie', () => {
    const cookie = createSessionCookieValue('sonyxperiame1@gmail.com')
    expect(cookie).toBeTruthy()
    expect(verifySessionCookieValue(cookie!)).toBe('sonyxperiame1@gmail.com')
  })

  it('rejects a tampered cookie', () => {
    const cookie = createSessionCookieValue('a@b.com')!
    const [body, sig] = cookie.split('.')
    expect(verifySessionCookieValue(`${body}x.${sig}`)).toBeNull()
    expect(verifySessionCookieValue(`${body}.${'a'.repeat(sig.length)}`)).toBeNull()
  })

  it('rejects garbage and empty values', () => {
    expect(verifySessionCookieValue('')).toBeNull()
    expect(verifySessionCookieValue('not-a-token')).toBeNull()
    expect(verifySessionCookieValue('a.b.c')).toBeNull()
  })

  it('rejects an expired cookie', () => {
    vi.useFakeTimers()
    const cookie = createSessionCookieValue('a@b.com')!
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 60_000)
    expect(verifySessionCookieValue(cookie)).toBeNull()
  })

  it('kills a session left idle past the 15-minute window', () => {
    vi.useFakeTimers()
    const cookie = createSessionCookieValue('a@b.com')!
    vi.advanceTimersByTime(15 * 60 * 1000 + 60_000)
    expect(verifySessionCookieValue(cookie)).toBeNull()
    const res = checkAdminAuth(fakeRequest({ cookie: `admin_session=${cookie}` }))
    expect(res.ok).toBe(false)
  })

  it('keeps a session alive within the idle window', () => {
    vi.useFakeTimers()
    const cookie = createSessionCookieValue('a@b.com')!
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(verifySessionCookieValue(cookie)).toBe('a@b.com')
    const res = checkAdminAuth(fakeRequest({ cookie: `admin_session=${cookie}` }))
    expect(res.ok).toBe(true)
  })

  it('refuses to mint or verify when no signing secret is configured', () => {
    delete process.env.ADMIN_TOKEN
    delete process.env.ADMIN_SESSION_SECRET
    expect(createSessionCookieValue('a@b.com')).toBeNull()
    expect(verifySessionCookieValue('x.y')).toBeNull()
    expect(checkAdminAuth(fakeRequest()).ok).toBe(false)
  })
})

describe('checkAdminAuth', () => {
  it('accepts a valid session cookie', () => {
    const cookie = createSessionCookieValue('sonyxperiame1@gmail.com')!
    const res = checkAdminAuth(fakeRequest({ cookie: `admin_session=${cookie}` }))
    expect(res).toEqual({ ok: true, email: 'sonyxperiame1@gmail.com' })
  })

  it('accepts the legacy x-admin-token header', () => {
    const res = checkAdminAuth(fakeRequest({ 'x-admin-token': 'test-admin-token-0123456789abcdef' }))
    expect(res.ok).toBe(true)
  })

  it('rejects a wrong token and reports invalid', () => {
    const res = checkAdminAuth(fakeRequest({ 'x-admin-token': 'wrong-token' }))
    expect(res).toEqual({ ok: false, reason: 'invalid' })
  })

  it('accepts an ephemeral debug token', () => {
    const ephem = createEphemeralToken('sonyxperiame1@gmail.com')!
    expect(ephem.startsWith('ephem.')).toBe(true)
    expect(verifyEphemeralToken(ephem)).toBe('sonyxperiame1@gmail.com')
    const res = checkAdminAuth(fakeRequest({ 'x-admin-token': ephem }))
    expect(res.ok).toBe(true)
  })

  it('rejects an expired ephemeral token', () => {
    vi.useFakeTimers()
    const ephem = createEphemeralToken('a@b.com')!
    vi.advanceTimersByTime(5 * 60 * 1000 + 60_000)
    expect(verifyEphemeralToken(ephem)).toBeNull()
  })

  it('rejects an invalid cookie even when a header is absent', () => {
    const res = checkAdminAuth(fakeRequest({ cookie: 'admin_session=forged.value' }))
    expect(res).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports no-credential when nothing is sent', () => {
    const res = checkAdminAuth(fakeRequest({}))
    expect(res).toEqual({ ok: false, reason: 'no-credential' })
  })
})

describe('allowlist', () => {
  it('matches allowlisted emails case-insensitively', () => {
    expect(isAllowlistedAdmin('SONYXPERIAME1@GMAIL.COM')).toBe(true)
    expect(isAllowlistedAdmin(' dev@example.com ')).toBe(true)
  })

  it('rejects anything not on the list', () => {
    expect(isAllowlistedAdmin('attacker@evil.com')).toBe(false)
    expect(isAllowlistedAdmin(null)).toBe(false)
    expect(isAllowlistedAdmin(undefined)).toBe(false)
  })

  it('rejects everything when ADMIN_EMAILS is unset', () => {
    delete process.env.ADMIN_EMAILS
    expect(isAllowlistedAdmin('sonyxperiame1@gmail.com')).toBe(false)
  })
})

describe('sessionIdleRemainingMs', () => {
  it('returns ~15 minutes for a freshly minted session', () => {
    const cookie = createSessionCookieValue('a@b.com')!
    const remaining = sessionIdleRemainingMs(fakeRequest({ cookie: `admin_session=${cookie}` }))
    expect(remaining).not.toBeNull()
    expect(remaining!).toBeGreaterThan(14 * 60 * 1000)
    expect(remaining!).toBeLessThanOrEqual(15 * 60 * 1000)
  })

  it('shrinks as the session ages', () => {
    vi.useFakeTimers()
    const cookie = createSessionCookieValue('a@b.com')!
    vi.advanceTimersByTime(10 * 60 * 1000)
    const remaining = sessionIdleRemainingMs(fakeRequest({ cookie: `admin_session=${cookie}` }))!
    expect(remaining).toBeGreaterThan(4 * 60 * 1000)
    expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it('returns null once the idle window has elapsed', () => {
    vi.useFakeTimers()
    const cookie = createSessionCookieValue('a@b.com')!
    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(sessionIdleRemainingMs(fakeRequest({ cookie: `admin_session=${cookie}` }))).toBeNull()
  })

  it('returns null with no cookie', () => {
    expect(sessionIdleRemainingMs(fakeRequest({}))).toBeNull()
  })
})

describe('maybeRefreshSessionCookie (sliding expiry)', () => {
  it('returns null when there is no session cookie', () => {
    expect(maybeRefreshSessionCookie(fakeRequest({}))).toBeNull()
    expect(maybeRefreshSessionCookie(fakeRequest({ cookie: 'other=1' }))).toBeNull()
  })

  it('returns null for a freshly minted session (under the 5-min refresh threshold)', () => {
    const cookie = createSessionCookieValue('a@b.com')!
    expect(maybeRefreshSessionCookie(fakeRequest({ cookie: `admin_session=${cookie}` }))).toBeNull()
  })

  it('returns a refreshed cookie once the session is past the refresh threshold', () => {
    vi.useFakeTimers()
    const cookie = createSessionCookieValue('a@b.com')!
    vi.advanceTimersByTime(6 * 60 * 1000)
    const refreshed = maybeRefreshSessionCookie(fakeRequest({ cookie: `admin_session=${cookie}` }))
    expect(refreshed).toContain('admin_session=')
    expect(refreshed).toContain('HttpOnly')
    expect(refreshed).toContain('SameSite=Strict')
    const value = refreshed!.split('=')[1].split(';')[0]
    expect(verifySessionCookieValue(value)).toBe('a@b.com')
  })

  it('returns null for a session past the idle window (re-login, not refresh)', () => {
    vi.useFakeTimers()
    const cookie = createSessionCookieValue('a@b.com')!
    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(maybeRefreshSessionCookie(fakeRequest({ cookie: `admin_session=${cookie}` }))).toBeNull()
  })

  it('returns null when no signing secret is configured', () => {
    const cookie = createSessionCookieValue('a@b.com')!
    vi.useFakeTimers()
    vi.advanceTimersByTime(6 * 60 * 1000)
    delete process.env.ADMIN_TOKEN
    delete process.env.ADMIN_SESSION_SECRET
    expect(maybeRefreshSessionCookie(fakeRequest({ cookie: `admin_session=${cookie}` }))).toBeNull()
  })
})

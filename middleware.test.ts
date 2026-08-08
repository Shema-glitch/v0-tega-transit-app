import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'
import { MaintenanceStore } from '@/lib/api/maintenance-store'
import { createSessionCookieValue } from '@/lib/api/admin-auth'

vi.mock('@/lib/api/error-log', () => ({
  ErrorLog: { record: vi.fn() },
}))

function req(opts: { origin?: string; method?: string; path?: string; cookie?: string; token?: string } = {}) {
  const { origin, method = 'GET', path = '/api/health', cookie, token } = opts
  const headers = new Headers()
  if (origin) headers.set('origin', origin)
  if (cookie) headers.set('cookie', cookie)
  if (token) headers.set('x-admin-token', token)
  return new NextRequest(new URL(`http://localhost:3000${path}`), { method, headers })
}

describe('middleware CORS', () => {
  it('reflects the allowlisted frontend origin', () => {
    const res = middleware(req({ origin: 'https://busgo-track.vercel.app' }))
    expect(res.headers.get('access-control-allow-origin')).toBe('https://busgo-track.vercel.app')
  })

  it('reflects a Vercel preview subdomain of the same project pattern', () => {
    const res = middleware(req({ origin: 'https://busgo-track-git-feature-x.vercel.app' }))
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://busgo-track-git-feature-x.vercel.app'
    )
  })

  it('does not set Access-Control-Allow-Origin for a disallowed origin', () => {
    const res = middleware(req({ origin: 'https://evil-scraper.com' }))
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers OPTIONS preflight directly with 204', () => {
    const res = middleware(req({ origin: 'https://busgo-track.vercel.app', method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://busgo-track.vercel.app')
  })
})

describe('middleware rate limiting', () => {
  it('allows requests under the read limit (120/min) and sets rate-limit headers', () => {
    const res = middleware(req({ path: `/api/health/rl-test-${Math.random()}` }))
    expect(res.headers.get('x-ratelimit-limit')).toBe('120')
  })

  it('blocks a write endpoint after 30 requests/min with a 429 and Retry-After', () => {
    const path = `/api/incidents/report`
    // Use a fresh path suffix so this test doesn't collide with others hitting
    // the same rate-limit bucket within the shared process.
    const uniquePath = `${path}?t=${Math.random()}`
    let last
    for (let i = 0; i < 31; i++) {
      last = middleware(req({ method: 'POST', path: uniquePath }))
    }
    expect(last!.status).toBe(429)
    expect(last!.headers.get('retry-after')).toBeTruthy()
  })

  it('applies the write budget (30/min) to /api/feedback/report too', () => {
    const res = middleware(req({ method: 'POST', path: '/api/feedback/report' }))
    expect(res.headers.get('x-ratelimit-limit')).toBe('30')
  })
})

describe('middleware maintenance enforcement', () => {
  beforeEach(() => {
    MaintenanceStore.clear('stops.list')
  })

  it('lets a request through when the endpoint is not disabled', () => {
    const res = middleware(req({ path: '/api/stops' }))
    expect(res.status).not.toBe(503)
  })

  it('returns 503 for a registry-matched endpoint that has been disabled', () => {
    MaintenanceStore.set('stops.list', 'Investigating a data issue')
    const res = middleware(req({ path: '/api/stops' }))
    expect(res.status).toBe(503)
  })

  it('503 response includes the reason', async () => {
    MaintenanceStore.set('stops.list', 'Investigating a data issue')
    const res = middleware(req({ path: '/api/stops' }))
    const body = await res.json()
    expect(body.reason).toBe('Investigating a data issue')
  })

  it('does not affect an unrelated endpoint', () => {
    MaintenanceStore.set('stops.list', 'Investigating a data issue')
    const res = middleware(req({ path: '/api/health' }))
    expect(res.status).not.toBe(503)
  })

  it('meta endpoints (not in the registry) can never be disabled/blocked', () => {
    // Even if something tried to set a flag under a meta path, it wouldn't
    // match any registry entry, so it can't 503 — this proves the exclusion.
    MaintenanceStore.set('/api/errors', 'someone tried')
    const res = middleware(req({ path: '/api/errors' }))
    expect(res.status).not.toBe(503)
    MaintenanceStore.clear('/api/errors')
  })
})

describe('middleware admin auth gate', () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'middleware-test-token-abcdef'
  })

  afterEach(() => {
    delete process.env.ADMIN_TOKEN
  })

  it('blocks unauthenticated /api/admin/* requests with 401', () => {
    const res = middleware(req({ method: 'POST', path: '/api/admin/maintenance' }))
    expect(res.status).toBe(401)
  })

  it('blocks unauthenticated /api/errors reads (error details are sensitive)', () => {
    const res = middleware(req({ path: '/api/errors' }))
    expect(res.status).toBe(401)
  })

  it('keeps GET /api/admin/maintenance public (flags are shown to riders)', () => {
    const res = middleware(req({ path: '/api/admin/maintenance' }))
    expect(res.status).not.toBe(401)
  })

  it('allows an authenticated admin via a valid session cookie', () => {
    const cookie = createSessionCookieValue('admin@busgo.test')!
    const res = middleware(req({ method: 'POST', path: '/api/admin/maintenance', cookie: `admin_session=${cookie}` }))
    expect(res.status).not.toBe(401)
  })

  it('allows the legacy x-admin-token header', () => {
    const res = middleware(req({ method: 'POST', path: '/api/admin/maintenance', token: 'middleware-test-token-abcdef' }))
    expect(res.status).not.toBe(401)
  })

  it('redirects unauthenticated /admin pages to /goToAdminAuth', () => {
    const res = middleware(req({ path: '/admin' }))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/goToAdminAuth')
  })

  it('does not redirect authenticated /admin pages', () => {
    const cookie = createSessionCookieValue('admin@busgo.test')!
    const res = middleware(req({ path: '/admin', cookie: `admin_session=${cookie}` }))
    expect(res.status).not.toBe(302)
  })

  it('leaves /admin/debug alone (the route validates its own credential)', () => {
    const res = middleware(req({ path: '/admin/debug' }))
    expect(res.status).not.toBe(302)
  })
})

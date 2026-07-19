import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

vi.mock('@/lib/api/error-log', () => ({
  ErrorLog: { record: vi.fn() },
}))

function req(opts: { origin?: string; method?: string; path?: string } = {}) {
  const { origin, method = 'GET', path = '/api/health' } = opts
  const headers = new Headers()
  if (origin) headers.set('origin', origin)
  return new NextRequest(new URL(`http://localhost:3000${path}`), { method, headers })
}

describe('middleware CORS', () => {
  it('reflects the allowlisted frontend origin', () => {
    const res = middleware(req({ origin: 'https://bus-go-track.vercel.app' }))
    expect(res.headers.get('access-control-allow-origin')).toBe('https://bus-go-track.vercel.app')
  })

  it('reflects a Vercel preview subdomain of the same project pattern', () => {
    const res = middleware(req({ origin: 'https://bus-go-track-git-feature-x.vercel.app' }))
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://bus-go-track-git-feature-x.vercel.app'
    )
  })

  it('does not set Access-Control-Allow-Origin for a disallowed origin', () => {
    const res = middleware(req({ origin: 'https://evil-scraper.com' }))
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers OPTIONS preflight directly with 204', () => {
    const res = middleware(req({ origin: 'https://bus-go-track.vercel.app', method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://bus-go-track.vercel.app')
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
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { UptimeTracker } from '@/lib/api/uptime-tracker'

vi.mock('@/lib/api/uptime-tracker', () => ({
  UptimeTracker: {
    runProbes: vi.fn(),
  },
}))

const mockedRunProbes = vi.mocked(UptimeTracker.runProbes)

function req(authed = true) {
  return new NextRequest(new URL('http://localhost:3000/api/admin/diagnostics/check'), {
    method: 'POST',
    headers: authed ? { 'x-admin-token': 'route-test-admin-token' } : {},
  })
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = 'route-test-admin-token'
  vi.clearAllMocks()
  mockedRunProbes.mockResolvedValue([
    { id: 'stops.list', status: 'ok', latencyMs: 120, detail: null },
    { id: 'arrivals.legacy', status: 'down', latencyMs: null, detail: 'network error' },
    { id: 'realtime.sse', status: 'degraded', latencyMs: 900, detail: 'maintenance' },
  ])
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
})

describe('POST /api/admin/diagnostics/check', () => {
  it('requires admin auth', async () => {
    const res = await POST(req(false))
    expect(res.status).toBe(401)
    expect(mockedRunProbes).not.toHaveBeenCalled()
  })

  it('runs the probe sweep and returns the summary', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(3)
    expect(body.ok).toBe(1)
    expect(body.degraded).toBe(1)
    expect(body.down).toBe(1)
    expect(mockedRunProbes).toHaveBeenCalledTimes(1)
  })

  it('returns 500 if the sweep throws', async () => {
    mockedRunProbes.mockRejectedValue(new Error('boom'))
    const res = await POST(req())
    expect(res.status).toBe(500)
  })
})

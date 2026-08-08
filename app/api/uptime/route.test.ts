import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET } from './route'
import { UptimeTracker } from '@/lib/api/uptime-tracker'

vi.mock('@/lib/api/uptime-tracker', () => ({
  UptimeTracker: {
    ensureHydrated: vi.fn(async () => {}),
    getAllHistory: vi.fn(),
    getDurability: vi.fn(() => ({ durable: false, lastHydratedAt: null })),
  },
}))

const mockedTracker = vi.mocked(UptimeTracker)

function history() {
  return [
    {
      id: 'stops.list',
      method: 'GET' as const,
      label: '/api/stops',
      group: 'Stops & Arrivals',
      uptimePct: 100,
      samples: 10,
      last: 'ok' as const,
      buckets: [{ day: '2026-08-08', ok: 10, degraded: 0, down: 0 }],
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedTracker.getAllHistory.mockReturnValue(history() as never)
})

describe('GET /api/uptime', () => {
  it('returns 90 days of per-endpoint buckets without any auth', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.days).toBe(90)
    expect(body.endpoints).toHaveLength(1)
    expect(body.endpoints[0]).toMatchObject({ id: 'stops.list', uptimePct: 100, last: 'ok' })
    expect(mockedTracker.ensureHydrated).toHaveBeenCalled()
  })

  it('never exposes raw rows — only aggregated bucket counts', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.endpoints[0].buckets[0]).toMatchObject({ ok: 10, degraded: 0, down: 0 })
    expect(JSON.stringify(body)).not.toMatch(/checked_at|latency_ms|detail/)
  })
})

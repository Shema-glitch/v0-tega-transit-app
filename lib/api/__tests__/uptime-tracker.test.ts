import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UptimeTracker, __resetUptimeTrackerForTests } from '@/lib/api/uptime-tracker'
import { getSupabaseAdmin } from '@/lib/supabase-server'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/api/maintenance-store', () => ({
  MaintenanceStore: {
    ensureHydrated: vi.fn(async () => {}),
    getAll: vi.fn(() => []),
  },
}))

const mockedAdmin = vi.mocked(getSupabaseAdmin)

function fakeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(() => chain),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    delete: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    ...overrides,
  }
  return chain
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  __resetUptimeTrackerForTests()
})

describe('UptimeTracker buckets', () => {
  it('aggregates probes into per-day buckets and computes uptime %', () => {
    const now = Date.now()
    // 8 ok probes on day A, 1 degraded + 1 ok on day B, 1 down on day B.
    for (let i = 0; i < 8; i++) UptimeTracker.record('stops.list', 'ok', { at: now - 2 * 86_400_000 })
    UptimeTracker.record('stops.list', 'ok', { at: now - 86_400_000 })
    UptimeTracker.record('stops.list', 'degraded', { at: now - 86_400_000 })
    UptimeTracker.record('stops.list', 'down', { at: now })

    const [entry] = UptimeTracker.getAllHistory(3)
    // 9 ok / 11 samples
    expect(entry.uptimePct).toBeCloseTo(81.82, 1)
    expect(entry.samples).toBe(11)
    expect(entry.last).toBe('down')
    // Newest bucket last.
    expect(entry.buckets[entry.buckets.length - 1]).toMatchObject({ ok: 0, degraded: 0, down: 1 })
    expect(entry.buckets[0]).toMatchObject({ ok: 8, degraded: 0, down: 0 })
  })

  it('returns empty buckets (no data) for endpoints that were never probed', () => {
    const [entry] = UptimeTracker.getAllHistory(2)
    expect(entry.buckets).toHaveLength(2)
    expect(entry.buckets.every((b) => b.ok === 0 && b.degraded === 0 && b.down === 0)).toBe(true)
    expect(entry.last).toBeNull()
  })
})

describe('UptimeTracker durability', () => {
  it('hydrates persisted history from Supabase on first load', async () => {
    const chain = fakeChain()
    // The chain ends at .gte() — that's the call that must resolve with rows.
    chain.gte.mockResolvedValue({
      data: [
        { endpoint: 'stops.list', checked_at: '2026-08-07T10:00:00Z', status: 'ok' },
        { endpoint: 'stops.list', checked_at: '2026-08-07T11:00:00Z', status: 'down' },
        { endpoint: 'stops.list', checked_at: '2026-08-06T10:00:00Z', status: 'ok' },
      ],
      error: null,
    })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    await UptimeTracker.ensureHydrated()
    const entry = UptimeTracker.getAllHistory(90).find((e) => e.id === 'stops.list')!
    expect(entry.samples).toBe(3)
    expect(entry.last).toBe('down')
    expect(UptimeTracker.getDurability().durable).toBe(true)
  })

  it('writes a record() through to the durable table', async () => {
    const chain = fakeChain()
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    UptimeTracker.record('vehicles.live', 'ok')
    await flush()

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'vehicles.live', status: 'ok' }),
      { onConflict: 'endpoint,checked_at' }
    )
  })

  it('swallows a failed hydration and keeps in-memory state (no throw)', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    UptimeTracker.record('vehicles.live', 'ok')
    await expect(UptimeTracker.ensureHydrated()).resolves.toBeUndefined()
    expect(UptimeTracker.getAllHistory(1).find((e) => e.id === 'vehicles.live')!.samples).toBe(1)
    expect(UptimeTracker.getDurability().durable).toBe(false)
  })

  it('swallows a failed persist (bucket still updated in-memory)', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    expect(() => UptimeTracker.record('stops.list', 'down')).not.toThrow()
    await flush()
    expect(UptimeTracker.getAllHistory(1).find((e) => e.id === 'stops.list')!.last).toBe('down')
  })
})

describe('UptimeTracker.runProbes', () => {
  it('probes only read-only endpoints by default (never pollutes real data)', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('realtime.sse')) {
        return { status: 200 } as Response
      }
      return { status: String(url).includes('arrivals') ? 500 : 200 } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await UptimeTracker.runProbes()
    // registry GETs (14) + meta GETs (4) — the 4 write-path POSTs are excluded
    expect(results.length).toBe(18)
    expect(results.some((r) => r.id === 'realtime.broadcast')).toBe(false)
    expect(results.some((r) => r.id === 'incidents.report')).toBe(false)
    expect(results.some((r) => r.id === 'meta.feedback')).toBe(false)
    expect(results.some((r) => r.id === 'stops.suggest')).toBe(false)
    expect(results.some((r) => r.status === 'down')).toBe(true)
    // Recorded into memory so the bars update.
    expect(UptimeTracker.getAllHistory(1).find((e) => e.id === 'arrivals.legacy')!.last).toBe('down')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('includes the write-path endpoints only when explicitly requested', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    const fetchMock = vi.fn(async () => ({ status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    const results = await UptimeTracker.runProbes({ includeWritePaths: true })
    expect(results.length).toBe(22)
    expect(results.some((r) => r.id === 'realtime.broadcast')).toBe(true)
    expect(results.some((r) => r.id === 'stops.suggest')).toBe(true)
  })

  it('treats maintenance-disabled endpoints as degraded without fetching', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    const { MaintenanceStore } = await import('@/lib/api/maintenance-store')
    vi.mocked(MaintenanceStore.getAll).mockReturnValue([
      { feature: 'stops.list', reason: 'maintenance', since: Date.now() },
    ])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const results = await UptimeTracker.runProbes()
    const stops = results.find((r) => r.id === 'stops.list')!
    expect(stops.status).toBe('degraded')
    expect(stops.detail).toBe('maintenance')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/stops?'), expect.anything())
  })

  it('applies the maintenance gate to write-path probes too', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    const { MaintenanceStore } = await import('@/lib/api/maintenance-store')
    vi.mocked(MaintenanceStore.getAll).mockReturnValue([
      { feature: 'realtime.broadcast', reason: 'maintenance', since: Date.now() },
    ])
    const fetchMock = vi.fn(async () => ({ status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    const results = await UptimeTracker.runProbes({ includeWritePaths: true })
    const bc = results.find((r) => r.id === 'realtime.broadcast')!
    expect(bc.status).toBe('degraded')
    expect(bc.detail).toBe('maintenance')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/realtime/broadcast'), expect.anything())
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MaintenanceStore, __resetMaintenanceStoreForTests } from '@/lib/api/maintenance-store'
import { getSupabaseAdmin } from '@/lib/supabase-server'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: vi.fn(),
}))

const mockedAdmin = vi.mocked(getSupabaseAdmin)

function fakeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(() => chain),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    ...overrides,
  }
  return chain
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  __resetMaintenanceStoreForTests()
})

describe('MaintenanceStore durability', () => {
  it('hydrates persisted flags from Supabase on first load', async () => {
    const chain = fakeChain()
    chain.select.mockResolvedValue({
      data: [
        { feature: 'stops.list', reason: 'Investigating a data issue', since: '2026-08-01T10:00:00Z' },
        { feature: 'arrivals.live', reason: 'Vendor outage', since: '2026-08-01T11:00:00Z' },
      ],
      error: null,
    })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    await MaintenanceStore.ensureHydrated()
    const flags = MaintenanceStore.getAll()
    expect(flags).toHaveLength(2)
    expect(flags.find((f) => f.feature === 'stops.list')).toEqual({
      feature: 'stops.list',
      reason: 'Investigating a data issue',
      since: Date.parse('2026-08-01T10:00:00Z'),
    })
  })

  it('writes a set() through to the durable table', async () => {
    const chain = fakeChain()
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    MaintenanceStore.set('stops.list', 'Under maintenance')
    await flush()

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'stops.list', reason: 'Under maintenance' }),
      { onConflict: 'feature' }
    )
    expect(MaintenanceStore.getAll().some((f) => f.feature === 'stops.list')).toBe(true)
  })

  it('deletes the durable row when a flag is cleared', async () => {
    const chain = fakeChain()
    chain.delete.mockImplementation(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
    }))
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    MaintenanceStore.set('stops.list', 'x')
    await flush()
    MaintenanceStore.clear('stops.list')
    await flush()

    expect(chain.delete).toHaveBeenCalled()
    expect(MaintenanceStore.getAll().some((f) => f.feature === 'stops.list')).toBe(false)
  })

  it('swallows a failed hydration and keeps in-memory state (no throw)', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    MaintenanceStore.set('stops.list', 'local only')
    await expect(MaintenanceStore.ensureHydrated()).resolves.toBeUndefined()
    expect(MaintenanceStore.getAll().some((f) => f.feature === 'stops.list')).toBe(true)
  })

  it('swallows a failed persist (flag still enforced in-memory)', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    expect(() => MaintenanceStore.set('stops.list', 'still works')).not.toThrow()
    await flush()
    expect(MaintenanceStore.getAll().some((f) => f.feature === 'stops.list')).toBe(true)
  })
})

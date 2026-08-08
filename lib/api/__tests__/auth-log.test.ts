import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuthLog } from '@/lib/api/auth-log'
import { getSupabaseAdmin } from '@/lib/supabase-server'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: vi.fn(),
}))

const mockedAdmin = vi.mocked(getSupabaseAdmin)

function fakeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    select: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    lt: vi.fn(() => Promise.resolve({ data: null, error: null })),
    eq: vi.fn(() => chain),
    ...overrides,
  }
  return chain
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  mockedAdmin.mockReturnValue({ from: vi.fn(() => fakeChain()) } as never)
})

describe('AuthLog durability', () => {
  it('records into the in-memory ring and writes through to Supabase', async () => {
    const chain = fakeChain()
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    AuthLog.record({ action: 'login', email: 'a@b.com', ip: '1.2.3.4', ok: true })
    await flush()

    expect(AuthLog.getRecent()[0]).toMatchObject({
      action: 'login',
      email: 'a@b.com',
      ip: '1.2.3.4',
      ok: true,
    })
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login', email: 'a@b.com', ip: '1.2.3.4', ok: true })
    )
  })

  it('reads persisted events newest-first from Supabase', async () => {
    const chain = fakeChain()
    chain.order.mockReturnValue({
      limit: vi.fn(() =>
        Promise.resolve({
          data: [
            { action: 'login', email: 'a@b.com', ip: '1.2.3.4', ok: true, detail: null, created_at: '2026-08-01T10:00:00Z' },
          ],
          error: null,
        })
      ),
    })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    const events = await AuthLog.getPersisted(100)
    expect(events).toHaveLength(1)
    expect(events![0]).toEqual({
      at: Date.parse('2026-08-01T10:00:00Z'),
      action: 'login',
      email: 'a@b.com',
      ip: '1.2.3.4',
      ok: true,
      detail: undefined,
    })
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('returns null from getPersisted when Supabase is unreachable (ring remains the fallback)', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    AuthLog.record({ action: 'verify', email: null, ip: '9.9.9.9', ok: false, detail: 'bad code' })
    expect(await AuthLog.getPersisted(100)).toBeNull()
    expect(AuthLog.getRecent()[0].action).toBe('verify')
  })

  it('never throws when a record write fails', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    expect(() => AuthLog.record({ action: 'login', email: 'a@b.com', ip: '1.2.3.4', ok: true })).not.toThrow()
    await flush()
  })

  it('prunes rows older than the retention window', async () => {
    const chain = fakeChain()
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)
    await AuthLog.pruneOld(90)
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.lt).toHaveBeenCalled()
  })
})

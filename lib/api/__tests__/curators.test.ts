import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getAdminRole, requireRole, setCuratorRole } from '@/lib/api/curators'
import { getSupabaseAdmin } from '@/lib/supabase-server'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: vi.fn(),
}))

const mockedAdmin = vi.mocked(getSupabaseAdmin)

function req() {
  return { headers: { get: () => null } }
}

/** Fake chain for a maybeSingle role read. */
function roleFake(role: string | null, fail = false) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            fail
              ? { data: null, error: new Error('db down') }
              : { data: role ? { role } : null, error: null },
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            then: async (resolve: (v: unknown) => void) => resolve({ data: role ? [{ email: 'x' }] : [], error: null }),
          }),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_EMAILS
})

describe('getAdminRole', () => {
  it('treats the shared token as admin', async () => {
    await expect(getAdminRole('shared-token')).resolves.toBe('admin')
  })

  it('treats env-seeded addresses as admin without a DB call', async () => {
    process.env.ADMIN_EMAILS = 'owner@busgo.rw'
    await expect(getAdminRole('owner@busgo.rw')).resolves.toBe('admin')
    expect(mockedAdmin).not.toHaveBeenCalled()
  })

  it('reads the role from the table', async () => {
    mockedAdmin.mockReturnValue(roleFake('curator') as never)
    await expect(getAdminRole('curator@busgo.rw')).resolves.toBe('curator')
    mockedAdmin.mockReturnValue(roleFake('admin') as never)
    await expect(getAdminRole('admin@busgo.rw')).resolves.toBe('admin')
  })

  it('returns null for unknown addresses or DB failures', async () => {
    mockedAdmin.mockReturnValue(roleFake(null) as never)
    await expect(getAdminRole('nobody@busgo.rw')).resolves.toBeNull()
    mockedAdmin.mockReturnValue(roleFake('admin', true) as never)
    await expect(getAdminRole('nobody@busgo.rw')).resolves.toBeNull()
  })
})

describe('requireRole', () => {
  it('lets curators and admins through a curator-gated route', async () => {
    mockedAdmin.mockReturnValue(roleFake('curator') as never)
    await expect(requireRole(req(), 'curator@busgo.rw', 'curator')).resolves.toEqual({ ok: true, role: 'curator' })
    mockedAdmin.mockReturnValue(roleFake('admin') as never)
    await expect(requireRole(req(), 'admin@busgo.rw', 'curator')).resolves.toEqual({ ok: true, role: 'admin' })
  })

  it('blocks curators from admin-only routes', async () => {
    mockedAdmin.mockReturnValue(roleFake('curator') as never)
    await expect(requireRole(req(), 'curator@busgo.rw', 'admin')).resolves.toEqual({ ok: false, reason: 'forbidden' })
  })

  it('blocks unknown emails', async () => {
    mockedAdmin.mockReturnValue(roleFake(null) as never)
    await expect(requireRole(req(), 'nobody@busgo.rw', 'curator')).resolves.toEqual({ ok: false, reason: 'forbidden' })
  })
})

describe('setCuratorRole', () => {
  it('grants and revokes via the table', async () => {
    mockedAdmin.mockReturnValue(roleFake('curator') as never)
    await expect(setCuratorRole('curator@busgo.rw', true)).resolves.toEqual({ ok: true })
    await expect(setCuratorRole('curator@busgo.rw', false)).resolves.toEqual({ ok: true })
  })

  it('reports notFound for addresses not on the allowlist', async () => {
    mockedAdmin.mockReturnValue(
      ({
        from: () => ({
          update: () => ({
            eq: () => ({
              select: () => ({ then: async (resolve: (v: unknown) => void) => resolve({ data: [], error: null }) }),
            }),
          }),
        }),
      }) as never
    )
    const result = await setCuratorRole('nobody@busgo.rw', true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.notFound).toBe(true)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isAdminEmailAllowed,
  listAdminEmails,
  inviteAdminEmail,
  revokeAdminEmail,
} from '@/lib/api/admin-emails'
import { getSupabaseAdmin } from '@/lib/supabase-server'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: vi.fn(),
}))

const mockedAdmin = vi.mocked(getSupabaseAdmin)

// Chainable fake for the supabase-js query builder.
function fakeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    delete: vi.fn(() => chain),
    ...overrides,
  }
  return chain
}

beforeEach(() => {
  process.env.ADMIN_EMAILS = 'sonyxperiame1@gmail.com'
  vi.clearAllMocks()
})

afterEach(() => {
  delete process.env.ADMIN_EMAILS
})

describe('isAdminEmailAllowed', () => {
  it('allows an env-seeded address without touching the DB', async () => {
    expect(await isAdminEmailAllowed('SONYXPERIAME1@GMAIL.COM')).toBe(true)
    expect(mockedAdmin).not.toHaveBeenCalled()
  })

  it('allows an address present in the admin_emails table', async () => {
    const chain = fakeChain()
    chain.maybeSingle.mockResolvedValue({ data: { email: 'dev@example.com' }, error: null })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)
    expect(await isAdminEmailAllowed('dev@example.com')).toBe(true)
    expect(chain.eq).toHaveBeenCalledWith('email', 'dev@example.com')
  })

  it('rejects an address in neither list', async () => {
    const chain = fakeChain()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)
    expect(await isAdminEmailAllowed('attacker@evil.com')).toBe(false)
  })

  it('falls back to the env list when the DB is unreachable', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    expect(await isAdminEmailAllowed('sonyxperiame1@gmail.com')).toBe(true)
    expect(await isAdminEmailAllowed('other@example.com')).toBe(false)
  })
})

describe('listAdminEmails', () => {
  it('merges env-seeded and table rows, tagging the source', async () => {
    const chain = fakeChain()
    chain.select.mockImplementation(() => ({
      order: vi.fn(() =>
        Promise.resolve({
          data: [
            { email: 'dev@example.com', invited_by: 'sonyxperiame1@gmail.com', created_at: '2026-08-01T10:00:00Z' },
          ],
          error: null,
        })
      ),
    }))
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    const { admins, dbOk } = await listAdminEmails()
    expect(dbOk).toBe(true)
    expect(admins).toHaveLength(2)
    expect(admins.find((a) => a.email === 'sonyxperiame1@gmail.com')?.source).toBe('env')
    const invited = admins.find((a) => a.email === 'dev@example.com')
    expect(invited?.source).toBe('supabase')
    expect(invited?.invitedBy).toBe('sonyxperiame1@gmail.com')
    expect(invited?.createdAt).toBe(new Date('2026-08-01T10:00:00Z').getTime())
  })

  it('reports dbOk=false and env-only rows when the table read fails', async () => {
    mockedAdmin.mockImplementation(() => {
      throw new Error('ENOTFOUND supabase.co')
    })
    const { admins, dbOk } = await listAdminEmails()
    expect(dbOk).toBe(false)
    expect(admins).toEqual([{ email: 'sonyxperiame1@gmail.com', source: 'env', role: 'admin' }])
  })

  it('attaches second-factor state from the admin_totp table', async () => {
    const chain = fakeChain()
    // First call (admin_emails) → the allowlist rows.
    chain.select.mockImplementationOnce(() => ({
      order: vi.fn(() =>
        Promise.resolve({
          data: [{ email: 'dev@example.com', invited_by: 'sonyxperiame1@gmail.com', created_at: '2026-08-01T10:00:00Z' }],
          error: null,
        })
      ),
    }))
    // Second call (admin_totp) → one enrolled, one pending.
    chain.select.mockImplementationOnce(() => ({
      in: vi.fn(() =>
        Promise.resolve({
          data: [
            {
              email: 'dev@example.com',
              secret: 'ABCDEF123456',
              pending_secret: null,
              enabled_at: '2026-08-02T10:00:00Z',
            },
          ],
          error: null,
        })
      ),
    }))
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    const { admins } = await listAdminEmails()
    const owner = admins.find((a) => a.email === 'sonyxperiame1@gmail.com')
    const dev = admins.find((a) => a.email === 'dev@example.com')
    expect(dev?.totp).toEqual({ enabled: true, pending: false, dbOk: true })
    // No row in admin_totp for the env-seeded owner → not enrolled, store fine.
    expect(owner?.totp).toEqual({ enabled: false, pending: false, dbOk: true })
  })
})

describe('inviteAdminEmail / revokeAdminEmail', () => {
  it('upserts an invite through the service-role client', async () => {
    const chain = fakeChain()
    chain.upsert.mockResolvedValue({ data: null, error: null })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)

    const res = await inviteAdminEmail('  NEW@Example.com ', 'sonyxperiame1@gmail.com')
    expect(res).toEqual({ ok: true })
    expect(chain.upsert).toHaveBeenCalledWith(
      { email: 'new@example.com', invited_by: 'sonyxperiame1@gmail.com' },
      { onConflict: 'email' }
    )
  })

  it('surfaces an invite error', async () => {
    const chain = fakeChain()
    chain.upsert.mockResolvedValue({ data: null, error: new Error('connection refused') })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)
    const res = await inviteAdminEmail('new@example.com', 'admin')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/connection refused/)
  })

  it('deletes a row on revoke and reports notFound when absent', async () => {
    const chain = fakeChain()
    chain.select.mockResolvedValueOnce({ data: [{ email: 'dev@example.com' }], error: null })
    mockedAdmin.mockReturnValue({ from: vi.fn(() => chain) } as never)
    expect(await revokeAdminEmail('DEV@example.com')).toEqual({ ok: true })

    chain.select.mockResolvedValueOnce({ data: [], error: null })
    expect(await revokeAdminEmail('gone@example.com')).toEqual({ ok: true, notFound: true })
  })
})

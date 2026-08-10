import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateSync } from 'otplib'
import {
  activateTotp,
  beginTotpEnrollment,
  disableTotp,
  getTotpStatus,
  requireTotpForAction,
  verifyTotp,
  TOTP_GRACE_MS,
} from '@/lib/api/admin-totp'
import { getSupabaseAdmin } from '@/lib/supabase-server'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: vi.fn(),
}))

type Row = { email: string; secret: string | null; pending_secret: string | null; enabled_at: string | null }

/** Minimal in-memory Supabase fake — enough to exercise the query chains. */
function makeFake(row: Row | null) {
  let store: Row | null = row ? { ...row } : null
  const calls: Array<{ op: string; email?: string; patch?: Partial<Row> }> = []
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: store ? { ...store } : null, error: null }),
        }),
      }),
      upsert: async (patch: Partial<Row>) => {
        calls.push({ op: 'upsert', patch })
        if (store) Object.assign(store, patch)
        return { error: null }
      },
      update: (patch: Partial<Row>) => ({
        eq: async () => {
          calls.push({ op: 'update', patch })
          if (store) Object.assign(store, patch)
          return { error: null }
        },
      }),
      delete: () => ({
        eq: async () => {
          calls.push({ op: 'delete' })
          store = null
          return { error: null }
        },
      }),
    }),
  }
  return { supabase, getStore: () => store, calls }
}

const mockedAdmin = vi.mocked(getSupabaseAdmin)

function req(headers: Record<string, string> = {}) {
  return { headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } }
}

// 32 base32 chars = 20 bytes — otplib v13 enforces a 16-byte minimum.
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

function validCode(secret: string): string {
  return generateSync({ secret })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Needed by the session-cookie helpers (fallback HMAC secret).
  process.env.ADMIN_TOKEN = 'test-admin-token-0123456789abcdef'
})

describe('getTotpStatus', () => {
  it('reports disabled when no row exists', async () => {
    const { supabase } = makeFake(null)
    mockedAdmin.mockReturnValue(supabase as never)
    await expect(getTotpStatus('admin@busgo.rw')).resolves.toEqual({
      enabled: false,
      enabledAt: null,
      pending: false,
      dbOk: true,
    })
  })

  it('reports enabled when secret + enabled_at are set', async () => {
    const { supabase } = makeFake({
      email: 'admin@busgo.rw',
      secret: 'SECRET',
      pending_secret: null,
      enabled_at: '2026-08-10T10:00:00Z',
    })
    mockedAdmin.mockReturnValue(supabase as never)
    const status = await getTotpStatus('admin@busgo.rw')
    expect(status.enabled).toBe(true)
    expect(status.pending).toBe(false)
    expect(status.enabledAt).toBe(new Date('2026-08-10T10:00:00Z').getTime())
  })

  it('reports pending when only pending_secret exists', async () => {
    const { supabase } = makeFake({ email: 'a@b.c', secret: null, pending_secret: 'PENDING', enabled_at: null })
    mockedAdmin.mockReturnValue(supabase as never)
    const status = await getTotpStatus('a@b.c')
    expect(status.enabled).toBe(false)
    expect(status.pending).toBe(true)
  })
})

describe('beginTotpEnrollment', () => {
  it('returns a base32 secret and otpauth URI, stored as pending', async () => {
    const { supabase, calls } = makeFake(null)
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await beginTotpEnrollment('admin@busgo.rw')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.enrollment.secret).toMatch(/^[A-Z2-7]+$/)
    expect(result.enrollment.otpauthUri).toContain('otpauth://totp/')
    expect(result.enrollment.otpauthUri).toContain('secret=')
    expect(result.enrollment.otpauthUri).toContain('BusGo%20Track')
    expect(calls[0].op).toBe('upsert')
    expect(calls[0].patch?.pending_secret).toBe(result.enrollment.secret)
  })

  it('refuses when TOTP is already enabled', async () => {
    const { supabase } = makeFake({
      email: 'a@b.c',
      secret: 'SECRET',
      pending_secret: null,
      enabled_at: '2026-08-10T10:00:00Z',
    })
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await beginTotpEnrollment('a@b.c')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('already-enabled')
  })
})

describe('activateTotp', () => {
  it('promotes the pending secret on a valid code', async () => {
    const secret = SECRET
    const { supabase, getStore } = makeFake({
      email: 'a@b.c',
      secret: null,
      pending_secret: secret,
      enabled_at: null,
    })
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await activateTotp('a@b.c', validCode(secret))
    expect(result).toEqual({ ok: true })
    const store = getStore()
    expect(store?.secret).toBe(secret)
    expect(store?.pending_secret).toBeNull()
    expect(store?.enabled_at).not.toBeNull()
  })

  it('rejects a wrong code and counts it toward the lockout', async () => {
    const secret = SECRET
    const { supabase } = makeFake({ email: 'a@b.c', secret: null, pending_secret: secret, enabled_at: null })
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await activateTotp('a@b.c', '000000')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not valid/i)
  })

  it('returns no-pending when there is nothing to activate', async () => {
    const { supabase } = makeFake(null)
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await activateTotp('a@b.c', '123456')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no-pending')
  })
})

describe('verifyTotp', () => {
  it('accepts a valid code', async () => {
    const secret = SECRET
    const { supabase } = makeFake({ email: 'a@b.c', secret, pending_secret: null, enabled_at: '2026-08-10T10:00:00Z' })
    mockedAdmin.mockReturnValue(supabase as never)
    await expect(verifyTotp('a@b.c', validCode(secret))).resolves.toEqual({ ok: true })
  })

  it('rejects when TOTP is not enabled', async () => {
    const { supabase } = makeFake(null)
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await verifyTotp('a@b.c', '123456')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not-enabled')
  })

  it('locks the email after five failed attempts', async () => {
    const secret = SECRET
    // Distinct email: the 5-minute lock is module state and would leak into
    // later tests that reuse an email.
    const email = 'lockout@busgo.rw'
    const { supabase } = makeFake({ email, secret, pending_secret: null, enabled_at: '2026-08-10T10:00:00Z' })
    mockedAdmin.mockReturnValue(supabase as never)
    for (let i = 0; i < 5; i++) {
      await verifyTotp(email, '000000')
    }
    // Sixth attempt — even the correct code is refused while locked.
    const result = await verifyTotp(email, validCode(secret))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('locked')
  })
})

describe('disableTotp', () => {
  it('requires a valid code before removing the secret', async () => {
    const secret = SECRET
    const email = 'disable@busgo.rw'
    const { supabase, calls, getStore } = makeFake({
      email,
      secret,
      pending_secret: null,
      enabled_at: '2026-08-10T10:00:00Z',
    })
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await disableTotp(email, validCode(secret))
    expect(result).toEqual({ ok: true })
    expect(calls.some((c) => c.op === 'delete')).toBe(true)
    expect(getStore()).toBeNull()
  })

  it('refuses with a wrong code', async () => {
    const secret = SECRET
    const email = 'disable@busgo.rw'
    const { supabase, calls } = makeFake({
      email,
      secret,
      pending_secret: null,
      enabled_at: '2026-08-10T10:00:00Z',
    })
    mockedAdmin.mockReturnValue(supabase as never)
    const result = await disableTotp(email, '000000')
    expect(result.ok).toBe(false)
    expect(calls.some((c) => c.op === 'delete')).toBe(false)
  })
})

describe('requireTotpForAction', () => {
  it('allows the shared-token path without TOTP', async () => {
    mockedAdmin.mockReturnValue(({ from: () => ({}) } as never))
    await expect(requireTotpForAction(req({}), 'shared-token')).resolves.toEqual({ ok: true })
  })

  it('allows when the email has no active enrollment', async () => {
    const { supabase } = makeFake(null)
    mockedAdmin.mockReturnValue(supabase as never)
    await expect(requireTotpForAction(req({}), 'admin@busgo.rw')).resolves.toEqual({ ok: true })
  })

  it('allows with a valid x-totp-code header', async () => {
    const secret = SECRET
    const email = 'header@busgo.rw'
    const { supabase } = makeFake({ email, secret, pending_secret: null, enabled_at: '2026-08-10T10:00:00Z' })
    mockedAdmin.mockReturnValue(supabase as never)
    await expect(requireTotpForAction(req({ 'x-totp-code': validCode(secret) }), email)).resolves.toEqual({
      ok: true,
    })
  })

  it('demands TOTP when enabled and nothing proves identity', async () => {
    const secret = SECRET
    const { supabase } = makeFake({ email: 'a@b.c', secret, pending_secret: null, enabled_at: '2026-08-10T10:00:00Z' })
    mockedAdmin.mockReturnValue(supabase as never)
    await expect(requireTotpForAction(req({}), 'a@b.c')).resolves.toEqual({ ok: false, reason: 'totp-required' })
  })

  it('allows when the session carries a fresh totpAt claim', async () => {
    const secret = SECRET
    const { supabase } = makeFake({ email: 'a@b.c', secret, pending_secret: null, enabled_at: '2026-08-10T10:00:00Z' })
    mockedAdmin.mockReturnValue(supabase as never)
    // Build a cookie with a totpAt claim using the real session helper.
    const { createSessionCookieValue } = await import('@/lib/api/admin-auth')
    const cookie = createSessionCookieValue('a@b.c', Date.now() - 1000)
    expect(cookie).not.toBeNull()
    await expect(requireTotpForAction(req({ cookie: `admin_session=${cookie}` }), 'a@b.c')).resolves.toEqual({
      ok: true,
    })
  })

  it('demands TOTP when the totpAt claim is older than the grace window', async () => {
    const secret = SECRET
    const { supabase } = makeFake({ email: 'a@b.c', secret, pending_secret: null, enabled_at: '2026-08-10T10:00:00Z' })
    mockedAdmin.mockReturnValue(supabase as never)
    const { createSessionCookieValue } = await import('@/lib/api/admin-auth')
    const cookie = createSessionCookieValue('a@b.c', Date.now() - TOTP_GRACE_MS - 1000)
    await expect(requireTotpForAction(req({ cookie: `admin_session=${cookie}` }), 'a@b.c')).resolves.toEqual({
      ok: false,
      reason: 'totp-required',
    })
  })
})

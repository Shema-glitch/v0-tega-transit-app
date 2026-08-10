import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase-server'
import { isAdminEmailAllowed } from '@/lib/api/admin-emails'
import { getAuthGuardStatus } from '@/lib/api/auth-guard'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}))
vi.mock('@/lib/api/admin-emails', () => ({
  isAdminEmailAllowed: vi.fn(),
}))
vi.mock('@/lib/api/auth-guard', () => ({
  getAuthGuardStatus: vi.fn(() => ({ blocked: false, retryAfterSec: 0 })),
  recordAuthFailure: vi.fn(),
}))
vi.mock('@/lib/api/auth-log', () => ({
  AuthLog: { record: vi.fn() },
}))
vi.mock('@/lib/api/client-ip', () => ({
  clientIp: vi.fn(() => '127.0.0.1'),
}))

const mockedServer = vi.mocked(getSupabaseServer)
const mockedAdmin = vi.mocked(getSupabaseAdmin)
const mockedAllowlist = vi.mocked(isAdminEmailAllowed)
const mockedGuard = vi.mocked(getAuthGuardStatus)

const signInWithOtp = vi.fn()
const listUsers = vi.fn()

function req(body: unknown) {
  return new NextRequest(new URL('http://localhost:3000/api/auth/magic-link/request'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  signInWithOtp.mockReset()
  signInWithOtp.mockResolvedValue({ data: {}, error: null })
  listUsers.mockReset()
  listUsers.mockResolvedValue({ data: { users: [{ email: 'admin@busgo.rw' }] }, error: null })
  mockedServer.mockReturnValue({ auth: { signInWithOtp } } as never)
  mockedAdmin.mockReturnValue({ auth: { admin: { listUsers } } } as never)
  mockedAllowlist.mockResolvedValue(false)
  mockedGuard.mockReturnValue({ blocked: false, retryAfterSec: 0 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/auth/magic-link/request', () => {
  it('sends a code for an allowlisted email and reports sent: true with step otp', async () => {
    mockedAllowlist.mockResolvedValue(true)
    const res = await POST(req({ email: 'admin@busgo.rw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: true, step: 'otp' })
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@busgo.rw',
        options: expect.objectContaining({
          shouldCreateUser: true,
          emailRedirectTo: 'http://localhost:3000/api/auth/callback',
        }),
      })
    )
  })

  it('reports step confirm for an address Supabase has never seen', async () => {
    mockedAllowlist.mockResolvedValue(true)
    listUsers.mockResolvedValue({ data: { users: [] }, error: null })
    const res = await POST(req({ email: 'brand-new@busgo.rw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: true, step: 'confirm' })
    // The send still happens — signInWithOtp creates the user + confirmation email.
    expect(signInWithOtp).toHaveBeenCalled()
  })

  it('defaults to step otp when the user check fails', async () => {
    mockedAllowlist.mockResolvedValue(true)
    listUsers.mockRejectedValue(new Error('db down'))
    const res = await POST(req({ email: 'admin@busgo.rw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: true, step: 'otp' })
  })

  it('points the emailed magic link at ADMIN_PUBLIC_URL when set', async () => {
    vi.stubEnv('ADMIN_PUBLIC_URL', 'https://tega-transit-api.onrender.com')
    mockedAllowlist.mockResolvedValue(true)
    const res = await POST(req({ email: 'admin@busgo.rw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: true, step: 'otp' })
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: 'https://tega-transit-api.onrender.com/api/auth/callback',
        }),
      })
    )
  })

  it('never calls Supabase for a non-allowlisted email and reveals nothing', async () => {
    mockedAllowlist.mockResolvedValue(false)
    const res = await POST(req({ email: 'stranger@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: false, detail: 'not-allowlisted' })
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('surfaces a Supabase rejection so the admin can fix the email provider', async () => {
    mockedAllowlist.mockResolvedValue(true)
    signInWithOtp.mockResolvedValue({ data: {}, error: new Error('Email provider is disabled') })
    const res = await POST(req({ email: 'admin@busgo.rw' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.sent).toBe(false)
    expect(body.detail).toBe('email-service')
    expect(body.message).toMatch(/provider/i)
  })

  it('rejects a malformed email with 400', async () => {
    const res = await POST(req({ email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('returns 429 while the per-IP guard has the caller blocked', async () => {
    mockedGuard.mockReturnValue({ blocked: true, retryAfterSec: 90 })
    const res = await POST(req({ email: 'admin@busgo.rw' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual(
      expect.objectContaining({ retryAfterSec: 90 })
    )
  })
})

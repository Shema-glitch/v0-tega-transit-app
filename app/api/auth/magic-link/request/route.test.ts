import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { getSupabaseServer } from '@/lib/supabase-server'
import { isAdminEmailAllowed } from '@/lib/api/admin-emails'
import { getAuthGuardStatus } from '@/lib/api/auth-guard'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(),
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
const mockedAllowlist = vi.mocked(isAdminEmailAllowed)
const mockedGuard = vi.mocked(getAuthGuardStatus)

const signInWithOtp = vi.fn()

function req(body: unknown) {
  return new NextRequest(new URL('http://localhost:3000/api/auth/magic-link/request'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signInWithOtp.mockReset()
  signInWithOtp.mockResolvedValue({ data: {}, error: null })
  mockedServer.mockReturnValue({ auth: { signInWithOtp } } as never)
  mockedAllowlist.mockResolvedValue(false)
  mockedGuard.mockReturnValue({ blocked: false, retryAfterSec: 0 })
})

describe('POST /api/auth/magic-link/request', () => {
  it('sends a code for an allowlisted email and reports sent: true', async () => {
    mockedAllowlist.mockResolvedValue(true)
    const res = await POST(req({ email: 'admin@busgo.rw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: true })
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

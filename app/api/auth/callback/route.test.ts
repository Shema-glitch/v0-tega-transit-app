import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { getSupabaseServer } from '@/lib/supabase-server'
import { isAllowlistedAdmin, sessionCookieHeader } from '@/lib/api/admin-auth'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(),
}))
vi.mock('@/lib/api/admin-auth', () => ({
  isAllowlistedAdmin: vi.fn(),
  sessionCookieHeader: vi.fn(),
}))
vi.mock('@/lib/api/auth-log', () => ({
  AuthLog: { record: vi.fn() },
}))
vi.mock('@/lib/api/client-ip', () => ({
  clientIp: vi.fn(() => '127.0.0.1'),
}))

const mockedServer = vi.mocked(getSupabaseServer)
const mockedAllowlist = vi.mocked(isAllowlistedAdmin)
const mockedCookie = vi.mocked(sessionCookieHeader)

const verifyOtp = vi.fn()

function req(url: string) {
  return new NextRequest(new URL(url))
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyOtp.mockReset()
  verifyOtp.mockResolvedValue({
    data: { user: { email: 'admin@busgo.rw' } },
    error: null,
  })
  mockedServer.mockReturnValue({ auth: { verifyOtp } } as never)
  mockedAllowlist.mockReturnValue(true)
  mockedCookie.mockReturnValue('admin_session=abc123; Path=/; HttpOnly')
})

describe('GET /api/auth/callback', () => {
  it('exchanges a token_hash for an allowlisted admin and sets the session cookie', async () => {
    const res = await GET(
      req('http://localhost:3000/api/auth/callback?token_hash=tok123&type=magiclink')
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/admin')
    expect(res.headers.get('set-cookie')).toContain('admin_session=abc123')
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok123', type: 'magiclink' })
  })

  it('redirects a non-allowlisted email back to login with an error', async () => {
    mockedAllowlist.mockReturnValue(false)
    const res = await GET(
      req('http://localhost:3000/api/auth/callback?token_hash=tok123&type=magiclink')
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/goToAdminAuth')
    expect(res.headers.get('location')).toContain('error=')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('rejects a link with no token', async () => {
    const res = await GET(req('http://localhost:3000/api/auth/callback'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/goToAdminAuth')
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('redirects to login when Supabase rejects the token', async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error('Token has expired') })
    const res = await GET(
      req('http://localhost:3000/api/auth/callback?token_hash=expired&type=magiclink')
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/goToAdminAuth')
  })

  it('honors error_description from Supabase', async () => {
    const res = await GET(
      req('http://localhost:3000/api/auth/callback?error_description=Access%20denied')
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/goToAdminAuth')
    expect(verifyOtp).not.toHaveBeenCalled()
  })
})

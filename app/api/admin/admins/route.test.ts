import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, DELETE } from './route'
import { listAdminEmails, inviteAdminEmail, revokeAdminEmail } from '@/lib/api/admin-emails'

vi.mock('@/lib/api/admin-emails', () => ({
  listAdminEmails: vi.fn(),
  inviteAdminEmail: vi.fn(),
  revokeAdminEmail: vi.fn(),
}))

const mockedList = vi.mocked(listAdminEmails)
const mockedInvite = vi.mocked(inviteAdminEmail)
const mockedRevoke = vi.mocked(revokeAdminEmail)

function req(path = '/api/admin/admins', opts: { method?: string; body?: unknown } = {}) {
  const { method = 'GET', body } = opts
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    method,
    headers: { 'x-admin-token': 'route-test-admin-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = 'route-test-admin-token'
  vi.clearAllMocks()
  mockedList.mockResolvedValue({ admins: [{ email: 'a@b.com', source: 'env' }], dbOk: true })
  mockedInvite.mockResolvedValue({ ok: true })
  mockedRevoke.mockResolvedValue({ ok: true })
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
  delete process.env.ADMIN_EMAILS
})

describe('/api/admin/admins', () => {
  it('requires admin auth', async () => {
    const anon = new NextRequest(new URL('http://localhost:3000/api/admin/admins'))
    expect((await GET(anon)).status).toBe(401)
    expect((await POST(anon)).status).toBe(401)
    expect((await DELETE(anon)).status).toBe(401)
  })

  it('lists admins', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(
      expect.objectContaining({ admins: [{ email: 'a@b.com', source: 'env' }], dbOk: true })
    )
  })

  it('invites a new admin email', async () => {
    const res = await POST(req('/api/admin/admins', { method: 'POST', body: { email: ' new@example.com ' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, email: 'new@example.com' })
    expect(mockedInvite).toHaveBeenCalledWith('new@example.com', 'shared-token')
  })

  it('rejects a malformed email with 400', async () => {
    const res = await POST(req('/api/admin/admins', { method: 'POST', body: { email: 'nope' } }))
    expect(res.status).toBe(400)
    expect(mockedInvite).not.toHaveBeenCalled()
  })

  it('refuses to invite or revoke an env-seeded address', async () => {
    process.env.ADMIN_EMAILS = 'owner@example.com'
    const inviteRes = await POST(
      req('/api/admin/admins', { method: 'POST', body: { email: 'owner@example.com' } })
    )
    expect(inviteRes.status).toBe(409)
    expect(mockedInvite).not.toHaveBeenCalled()

    const revokeRes = await DELETE(req('/api/admin/admins?email=owner@example.com', { method: 'DELETE' }))
    expect(revokeRes.status).toBe(409)
    expect(mockedRevoke).not.toHaveBeenCalled()
  })

  it('revokes a table-managed address', async () => {
    const res = await DELETE(req('/api/admin/admins?email=dev@example.com', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, email: 'dev@example.com' })
    expect(mockedRevoke).toHaveBeenCalledWith('dev@example.com')
  })

  it('reports notFound when revoking an address that was never invited', async () => {
    mockedRevoke.mockResolvedValue({ ok: true, notFound: true })
    const res = await DELETE(req('/api/admin/admins?email=ghost@example.com', { method: 'DELETE' }))
    expect(res.status).toBe(404)
  })

  it('surfaces a database error with 502', async () => {
    mockedInvite.mockResolvedValue({ ok: false, error: 'connection refused' })
    const res = await POST(
      req('/api/admin/admins', { method: 'POST', body: { email: 'new@example.com' } })
    )
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/connection refused/)
  })
})

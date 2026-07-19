import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from './route'
import { BugReports } from '@/lib/api/bug-reports'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => {
    throw new Error('Supabase unreachable in test')
  },
}))

function req(body: unknown) {
  return new Request('http://localhost:3000/api/feedback/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  }) as never
}

describe('POST /api/feedback/report', () => {
  beforeEach(() => BugReports.clear())

  it('accepts a valid report and stores it (in-memory fallback since Supabase is mocked out)', async () => {
    const res = await POST(req({ subject: 'Map is broken', message: 'The map does not load on iPhone Safari.' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    const all = BugReports.getAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ subject: 'Map is broken', status: 'open', userAgent: 'vitest' })
  })

  it('rejects an empty subject', async () => {
    const res = await POST(req({ subject: '', message: 'x' }))
    expect(res.status).toBe(400)
  })

  it('rejects an empty message', async () => {
    const res = await POST(req({ subject: 'x', message: '' }))
    expect(res.status).toBe(400)
  })

  it('rejects a missing body entirely', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('keeps two different reports as two separate entries (never deduped)', async () => {
    await POST(req({ subject: 'Bug A', message: 'Same text' }))
    await POST(req({ subject: 'Bug B', message: 'Same text' }))
    expect(BugReports.getAll()).toHaveLength(2)
  })
})

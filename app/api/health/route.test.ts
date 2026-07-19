import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET } from './route'
import * as supabaseMock from '@/lib/supabase'

vi.mock('@/lib/supabase', () => {
  const state: { error: { message: string } | null } = { error: null }
  return {
    supabase: {
      from: () => ({
        select: () => ({
          limit: () =>
            Promise.resolve(
              state.error ? { data: null, error: state.error } : { data: [{ stop_id: '1' }], error: null }
            ),
        }),
      }),
    },
    __setDbError: (e: { message: string } | null) => {
      state.error = e
    },
  }
})

const { __setDbError } = supabaseMock as unknown as {
  __setDbError: (e: { message: string } | null) => void
}

describe('GET /api/health', () => {
  beforeEach(() => __setDbError(null))

  it('returns 200 healthy when the database is reachable', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('healthy')
    expect(body.database).toBe('connected')
    expect(typeof body.responseTimeMs).toBe('number')
  })

  it('returns 503 degraded when the database ping errors', async () => {
    __setDbError({ message: 'connection refused' })
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(body.database).toBe('disconnected')
    expect(body.message).toBe('connection refused')
  })
})

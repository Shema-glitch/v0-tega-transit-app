import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET } from './route'
import * as supabaseServerMock from '@/lib/supabase-server'
import { __resetCacheForTests } from '@/lib/api/ttl-cache'

vi.mock('@/lib/supabase-server', () => {
  const state: { rows: unknown[]; error: { message: string } | null } = { rows: [], error: null }
  return {
    getSupabaseServer: () => ({
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: state.error ? null : state.rows, error: state.error }),
        }),
      }),
    }),
    __setRows: (rows: unknown[]) => {
      state.rows = rows
    },
    __setError: (e: { message: string } | null) => {
      state.error = e
    },
  }
})

const { __setRows, __setError } = supabaseServerMock as unknown as {
  __setRows: (rows: unknown[]) => void
  __setError: (e: { message: string } | null) => void
}

describe('GET /api/routes', () => {
  beforeEach(() => {
    __setRows([])
    __setError(null)
    // The route now TTL-caches the mapped list (1 h); isolate tests from it.
    __resetCacheForTests()
  })

  it('returns an empty array when there are no routes (never errors on empty)', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('maps GTFS rows into the API shape, filling defaults for missing fields', async () => {
    __setRows([
      { route_id: '101', route_short_name: '101', route_long_name: 'Downtown - Airport', route_desc: null, route_color: '4ECDC4', route_text_color: null, route_type: null },
    ])
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual([
      {
        id: '101',
        shortName: '101',
        longName: 'Downtown - Airport',
        description: '',
        color: '#4ECDC4',
        textColor: '#FFFFFF',
        type: 3,
      },
    ])
  })

  it('returns 500 with a details message when Supabase errors', async () => {
    __setError({ message: 'relation "routes" does not exist' })
    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Database error')
    expect(body.details).toBe('relation "routes" does not exist')
  })
})

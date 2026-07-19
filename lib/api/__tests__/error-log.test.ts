import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorLog } from '@/lib/api/error-log'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => {
    throw new Error('Supabase unreachable in test')
  },
}))

describe('ErrorLog (Supabase unreachable — in-memory fallback)', () => {
  beforeEach(() => {
    ErrorLog.clear()
  })

  it('records a new failure', () => {
    ErrorLog.record({ path: '/api/test-a', method: 'GET', status: 500, message: 'boom' })
    const all = ErrorLog.getAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ path: '/api/test-a', status: 500, message: 'boom', count: 1 })
  })

  it('dedupes identical failures into one entry with an incrementing count', () => {
    for (let i = 0; i < 4; i++) {
      ErrorLog.record({ path: '/api/test-b', method: 'GET', status: 500, message: 'same error' })
    }
    const all = ErrorLog.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].count).toBe(4)
  })

  it('keeps distinct method/path/status/message combos as separate entries', () => {
    ErrorLog.record({ path: '/api/test-c', method: 'GET', status: 500, message: 'x' })
    ErrorLog.record({ path: '/api/test-c', method: 'POST', status: 500, message: 'x' })
    ErrorLog.record({ path: '/api/test-c', method: 'GET', status: 400, message: 'x' })
    expect(ErrorLog.getAll()).toHaveLength(3)
  })

  it('truncates details and message to their configured max lengths', () => {
    ErrorLog.record({
      path: '/api/test-d',
      method: 'GET',
      status: 500,
      message: 'x'.repeat(1000),
      details: 'y'.repeat(2000),
    })
    const entry = ErrorLog.getAll()[0]
    expect(entry.message.length).toBeLessThanOrEqual(300)
    expect(entry.details!.length).toBeLessThanOrEqual(1000)
  })

  it('getPersisted() returns null when Supabase is unreachable (fire-and-forget never throws)', async () => {
    expect(() =>
      ErrorLog.record({ path: '/api/test-e', method: 'GET', status: 500, message: 'x' })
    ).not.toThrow()
    const persisted = await ErrorLog.getPersisted()
    expect(persisted).toBeNull()
  })

  it('clear() empties the ledger', () => {
    ErrorLog.record({ path: '/api/test-f', method: 'GET', status: 500, message: 'x' })
    expect(ErrorLog.size).toBeGreaterThan(0)
    ErrorLog.clear()
    expect(ErrorLog.size).toBe(0)
  })

  it('pruneOld() never throws when Supabase is unreachable (fire-and-forget)', async () => {
    await expect(ErrorLog.pruneOld()).resolves.toBeUndefined()
  })
})

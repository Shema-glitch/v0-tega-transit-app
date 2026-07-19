import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BugReports } from '@/lib/api/bug-reports'

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => {
    throw new Error('Supabase unreachable in test')
  },
}))

describe('BugReports (Supabase unreachable — in-memory fallback)', () => {
  beforeEach(() => {
    BugReports.clear()
  })

  it('records a report', () => {
    BugReports.record({ subject: 'Broken map', message: 'Map tiles do not load.' })
    const all = BugReports.getAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ subject: 'Broken map', message: 'Map tiles do not load.', status: 'open' })
  })

  it('never dedupes — two reports with identical text both persist', () => {
    BugReports.record({ subject: 'Same', message: 'Same' })
    BugReports.record({ subject: 'Same', message: 'Same' })
    expect(BugReports.getAll()).toHaveLength(2)
  })

  it('newest report comes first', () => {
    BugReports.record({ subject: 'First', message: 'x' })
    BugReports.record({ subject: 'Second', message: 'x' })
    expect(BugReports.getAll()[0].subject).toBe('Second')
  })

  it('truncates overlong fields', () => {
    BugReports.record({ subject: 'x'.repeat(500), message: 'y'.repeat(3000) })
    const entry = BugReports.getAll()[0]
    expect(entry.subject.length).toBeLessThanOrEqual(200)
    expect(entry.message.length).toBeLessThanOrEqual(2000)
  })

  it('getPersisted() returns null when Supabase is unreachable', async () => {
    BugReports.record({ subject: 'x', message: 'y' })
    expect(await BugReports.getPersisted()).toBeNull()
  })

  it('clear() empties the ledger', () => {
    BugReports.record({ subject: 'x', message: 'y' })
    expect(BugReports.size).toBeGreaterThan(0)
    BugReports.clear()
    expect(BugReports.size).toBe(0)
  })
})

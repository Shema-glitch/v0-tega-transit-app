/**
 * Rider-submitted bug reports from the frontend's landing-page feedback form.
 *
 * Unlike ErrorLog (lib/api/error-log.ts), these are never deduped — two
 * different riders hitting the same bug should both show up, and the same
 * rider's two different reports both matter. Durable-first: every submission
 * writes straight through to Supabase since rider feedback is worth keeping
 * even if nobody's watching the dashboard right now. The in-memory ring
 * buffer is only a fallback for when Supabase is unreachable, and never
 * auto-prunes — these need a human to read and resolve, not age out.
 */

import { getSupabaseServer } from '../supabase-server'

export interface BugReport {
  id: string
  subject: string
  message: string
  pageUrl?: string
  userAgent?: string
  status: 'open' | 'resolved'
  createdAt: number
}

const MAX_ENTRIES = 100
const MAX_SUBJECT_CHARS = 200
const MAX_MESSAGE_CHARS = 2000
const MAX_URL_CHARS = 500
const MAX_UA_CHARS = 300

interface RecordInput {
  subject: string
  message: string
  pageUrl?: string
  userAgent?: string
}

class BugReportLogger {
  private entries: BugReport[] = []
  private nextMemId = 1

  record(input: RecordInput): void {
    const subject = input.subject.slice(0, MAX_SUBJECT_CHARS)
    const message = input.message.slice(0, MAX_MESSAGE_CHARS)
    const pageUrl = input.pageUrl?.slice(0, MAX_URL_CHARS)
    const userAgent = input.userAgent?.slice(0, MAX_UA_CHARS)

    this.entries.unshift({
      id: `mem-${this.nextMemId++}`,
      subject,
      message,
      pageUrl,
      userAgent,
      status: 'open',
      createdAt: Date.now(),
    })
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES

    void this.persist({ subject, message, pageUrl, userAgent })
  }

  /** Best-effort durable write. Swallows every failure by design. */
  private async persist(input: RecordInput): Promise<void> {
    try {
      const supabase = getSupabaseServer()
      await supabase.rpc('submit_bug_report', {
        p_subject: input.subject,
        p_message: input.message,
        p_page_url: input.pageUrl ?? null,
        p_user_agent: input.userAgent ?? null,
      })
    } catch {
      // Supabase down or migration 0003 not run yet — the in-memory copy
      // above still shows on the dashboard until the process restarts.
    }
  }

  /** Durable recent reports, newest first. Returns null if Supabase is unreachable. */
  async getPersisted(limit = MAX_ENTRIES): Promise<BugReport[] | null> {
    try {
      const supabase = getSupabaseServer()
      const { data, error } = await supabase.rpc('get_recent_bug_reports', { p_limit: limit })
      if (error || !Array.isArray(data)) return null
      return data.map(mapRow)
    } catch {
      return null
    }
  }

  /** Best-effort durable clear. */
  async clearPersisted(): Promise<void> {
    try {
      const supabase = getSupabaseServer()
      await supabase.rpc('clear_bug_reports')
    } catch {
      /* best-effort */
    }
  }

  /** Most-recent first. */
  getAll(): BugReport[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  get size(): number {
    return this.entries.length
  }
}

function mapRow(row: {
  id: number
  subject: string
  message: string
  page_url: string | null
  user_agent: string | null
  status: string
  created_at: string
}): BugReport {
  return {
    id: String(row.id),
    subject: row.subject,
    message: row.message,
    pageUrl: row.page_url ?? undefined,
    userAgent: row.user_agent ?? undefined,
    status: row.status === 'resolved' ? 'resolved' : 'open',
    createdAt: Date.parse(row.created_at),
  }
}

// globalThis singleton — Next.js bundles modules per-route, so without pinning
// this each route would log into its own isolated ledger.
const KEY = Symbol.for('tega.bug-reports')
type GlobalWithLog = typeof globalThis & { [KEY]?: BugReportLogger }

const g = globalThis as GlobalWithLog
if (!g[KEY]) {
  g[KEY] = new BugReportLogger()
}

export const BugReports: BugReportLogger = g[KEY]!

/**
 * In-memory error ledger.
 *
 * When an endpoint throws (500) or rejects a request (400/422), the only
 * trace used to be a console.error in Render's live log stream — gone the
 * moment it scrolled off, and rejected payloads left no trace at all. This
 * ledger keeps the last N failures so a maintainer can open the status
 * dashboard and SEE what's breaking (and why) without watching logs live.
 *
 * Identical failures (same route + status + message) collapse into one entry
 * with a `count` and `lastAt`, so a flapping endpoint reads as
 * "×47, 12s ago" instead of burying everything else.
 *
 * Durability: the in-memory ledger is the always-available fast path, and
 * every record is ALSO written through to Supabase (public.api_errors via the
 * log_api_error RPC — see supabase/migrations/0001_api_errors.sql) so it
 * survives redeploys/restarts. The write is fire-and-forget: it never blocks
 * the response and never throws, so a logging failure (or the table not
 * existing yet) can't turn one error into two. Reads prefer the durable store
 * and fall back to in-memory when Supabase is unreachable.
 */

import { getSupabaseServer, getSupabaseAdmin } from '../supabase-server'

export interface ErrorEntry {
  /** Stable key: method + path + status + message. */
  key: string
  path: string
  method: string
  status: number
  message: string
  /** Optional structured context (e.g. Zod validation details), truncated. */
  details?: string
  count: number
  firstAt: number
  lastAt: number
}

const MAX_ENTRIES = 50
const MAX_DETAILS_CHARS = 1000
// Matches the retention period stated in the privacy policy.
const RETENTION_DAYS = 90
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

class ErrorLogger {
  private entries = new Map<string, ErrorEntry>()

  record(input: {
    path: string
    method?: string
    status: number
    message: string
    details?: unknown
  }): void {
    const method = input.method ?? 'GET'
    const message = String(input.message).slice(0, 300)
    const key = `${method} ${input.path} ${input.status} ${message}`
    const now = Date.now()

    let details: string | undefined
    if (input.details !== undefined) {
      const raw =
        typeof input.details === 'string' ? input.details : safeStringify(input.details)
      details = raw.slice(0, MAX_DETAILS_CHARS)
    }

    const existing = this.entries.get(key)
    if (existing) {
      existing.count++
      existing.lastAt = now
      if (details) existing.details = details
    } else {
      this.entries.set(key, {
        key,
        path: input.path,
        method,
        status: input.status,
        message,
        details,
        count: 1,
        firstAt: now,
        lastAt: now,
      })

      // Evict the oldest (by lastAt) once we exceed the cap.
      if (this.entries.size > MAX_ENTRIES) {
        let oldestKey: string | null = null
        let oldest = Infinity
        for (const [k, e] of this.entries) {
          if (e.lastAt < oldest) {
            oldest = e.lastAt
            oldestKey = k
          }
        }
        if (oldestKey) this.entries.delete(oldestKey)
      }
    }

    // Write through to the durable store — fire-and-forget, never throws.
    void this.persist({ key, path: input.path, method, status: input.status, message, details: input.details })
  }

  /** Best-effort durable write. Swallows every failure by design. */
  private async persist(e: {
    key: string
    path: string
    method: string
    status: number
    message: string
    details?: unknown
  }): Promise<void> {
    try {
      const jsonbDetails = toJsonbDetails(e.details)
      const supabase = getSupabaseServer()
      await supabase.rpc('log_api_error', {
        p_key: e.key,
        p_path: e.path,
        p_method: e.method,
        p_status: e.status,
        p_message: e.message,
        p_details: jsonbDetails,
      })
    } catch {
      // Supabase down, table not created yet, bad creds — the in-memory
      // ledger already captured this error, so we lose nothing critical.
    }
  }

  /** Durable recent errors, newest first. Returns null if Supabase is unreachable. */
  async getPersisted(limit = MAX_ENTRIES): Promise<ErrorEntry[] | null> {
    try {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase.rpc('get_recent_api_errors', { p_limit: limit })
      if (error || !Array.isArray(data)) return null
      return data.map(mapRow)
    } catch {
      return null
    }
  }

  /** Best-effort durable clear. */
  async clearPersisted(): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      await supabase.rpc('clear_api_errors')
    } catch {
      /* best-effort */
    }
  }

  /** Best-effort durable prune of rows older than `days` (see 0002_api_errors_retention.sql). */
  async pruneOld(days = RETENTION_DAYS): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      await supabase.rpc('prune_api_errors', { p_days: days })
    } catch {
      // Supabase down or migration 0002 not run yet — nothing lost, just
      // means rows keep accumulating until the next successful prune tick.
    }
  }

  /** Most-recently-seen first. */
  getAll(): ErrorEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.lastAt - a.lastAt)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Coerce arbitrary details into something safe to store in a jsonb column. */
function toJsonbDetails(details: unknown): unknown {
  if (details === undefined || details === null) return null
  const asString = typeof details === 'string' ? details : safeStringify(details)
  if (asString.length > MAX_DETAILS_CHARS) {
    return { truncated: true, preview: asString.slice(0, MAX_DETAILS_CHARS) }
  }
  // Objects go through as-is (jsonb); primitives get wrapped so the column
  // always holds a JSON object rather than a bare scalar/string.
  return typeof details === 'object' ? details : { value: details }
}

/** Map a durable api_errors row into the in-memory ErrorEntry shape. */
function mapRow(row: {
  error_key: string
  path: string
  method: string
  status: number
  message: string
  details: unknown
  count: number
  first_seen: string
  last_seen: string
}): ErrorEntry {
  return {
    key: row.error_key,
    path: row.path,
    method: row.method,
    status: row.status,
    message: row.message,
    details:
      row.details == null
        ? undefined
        : typeof row.details === 'string'
          ? row.details
          : safeStringify(row.details),
    count: row.count,
    firstAt: Date.parse(row.first_seen),
    lastAt: Date.parse(row.last_seen),
  }
}

// globalThis singleton — Next.js bundles modules per-route, so without pinning
// this each route would log into its own isolated ledger.
const KEY = Symbol.for('tega.error-log')
type GlobalWithLog = typeof globalThis & { [KEY]?: ErrorLogger }

const g = globalThis as GlobalWithLog
if (!g[KEY]) {
  const logger = new ErrorLogger()
  g[KEY] = logger

  // Self-scheduled retention: the app is a long-running Render process (not
  // serverless), so a plain setInterval survives for the process lifetime —
  // same assumption RealtimeHub's tick loop already relies on. No pg_cron or
  // external scheduler needed.
  void logger.pruneOld()
  setInterval(() => void logger.pruneOld(), PRUNE_INTERVAL_MS).unref()
}

export const ErrorLog: ErrorLogger = g[KEY]!

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
 * Same caveats as every other store here: in-memory, per-process, cleared on
 * redeploy/restart. It answers "what's failing right now", not "audit trail".
 * Persistence would be a Supabase table — a deliberately separate, bigger step.
 */

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
      return
    }

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

// globalThis singleton — Next.js bundles modules per-route, so without pinning
// this each route would log into its own isolated ledger.
const KEY = Symbol.for('tega.error-log')
type GlobalWithLog = typeof globalThis & { [KEY]?: ErrorLogger }

const g = globalThis as GlobalWithLog
if (!g[KEY]) {
  g[KEY] = new ErrorLogger()
}

export const ErrorLog: ErrorLogger = g[KEY]!

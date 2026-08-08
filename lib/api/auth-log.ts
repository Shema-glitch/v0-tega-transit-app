/**
 * lib/api/auth-log.ts — audit trail of auth events.
 *
 * Durability: every event is written through to the `auth_log` Supabase table
 * (supabase/migrations/0011) so the trail survives redeploys/restarts. The
 * in-memory ring buffer remains as the instant fast path AND the fallback —
 * if Supabase is unreachable, events still accumulate in memory and the
 * admin log route reads those instead. The write is fire-and-forget: it never
 * blocks the auth response and never throws, so a logging failure (or the
 * table not existing yet) can't break a login. Events also mirror to the
 * process console for Render's log stream.
 *
 * Consumed by GET /api/admin/auth-log (persisted first, ring as fallback).
 */

import { getSupabaseAdmin } from '../supabase-server'

const MAX = 100
const RETENTION_DAYS = 90
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface AuthLogEvent {
  at: number
  action: string
  email: string | null
  ip: string
  ok: boolean
  detail?: string
}

const events: AuthLogEvent[] = []

function log(ev: AuthLogEvent): void {
  console.log(
    `[auth] ${ev.action} ${ev.ok ? 'ok' : 'FAIL'} ${ev.email ?? '-'} ip=${ev.ip}${
      ev.detail ? ` (${ev.detail})` : ''
    }`
  )
}

export const AuthLog = {
  record(ev: Omit<AuthLogEvent, 'at'>): void {
    const entry: AuthLogEvent = { ...ev, at: Date.now() }
    events.unshift(entry)
    if (events.length > MAX) events.length = MAX
    log(entry)
    void this.persist(entry)
  },

  /** Instant in-memory read (newest first) — fallback when Supabase is down. */
  getRecent(): AuthLogEvent[] {
    return [...events]
  },

  /** Durable recent events, newest first. Returns null if Supabase is unreachable. */
  async getPersisted(limit = 100): Promise<AuthLogEvent[] | null> {
    try {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('auth_log')
        .select('action, email, ip, ok, detail, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error || !Array.isArray(data)) return null
      return (data as unknown as PersistedRow[]).map((row) => ({
        at: Date.parse(row.created_at),
        action: row.action,
        email: row.email,
        ip: row.ip,
        ok: row.ok,
        detail: row.detail ?? undefined,
      }))
    } catch {
      return null
    }
  },

  /** Best-effort durable write. Swallows every failure by design. */
  async persist(ev: AuthLogEvent): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      await supabase.from('auth_log').insert({
        action: ev.action,
        email: ev.email,
        ip: ev.ip,
        ok: ev.ok,
        detail: ev.detail ?? null,
      })
    } catch {
      // Supabase down, table not migrated yet, bad creds — the in-memory ring
      // already captured this event, so nothing critical is lost.
    }
  },

  /** Best-effort durable retention (rows older than `days` are removed). */
  async pruneOld(days = RETENTION_DAYS): Promise<void> {
    try {
      const supabase = getSupabaseAdmin()
      await supabase
        .from('auth_log')
        .delete()
        .lt('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
    } catch {
      // Supabase down — rows keep accumulating until the next prune tick.
    }
  },
}

interface PersistedRow {
  action: string
  email: string | null
  ip: string
  ok: boolean
  detail: string | null
  created_at: string
}

// Self-scheduled retention — same pattern as ErrorLog's prune loop: this is a
// long-running Render process, so the interval survives for the process
// lifetime. `.unref()` keeps it from holding a test process open.
void AuthLog.pruneOld()
setInterval(() => void AuthLog.pruneOld(), PRUNE_INTERVAL_MS).unref()

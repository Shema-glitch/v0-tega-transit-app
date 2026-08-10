/**
 * lib/api/admin-emails.ts — the dynamic admin allowlist.
 *
 * Supersedes hand-editing ADMIN_EMAILS: the allowlist now lives in the
 * `admin_emails` Supabase table (supabase/migrations/0009), invited and
 * revoked from the dashboard. The env var remains as a bootstrap seed, so a
 * fresh deploy with no table rows (or a DB that's briefly unreachable) still
 * lets the owner in — see isAdminEmailAllowed() checking env first.
 *
 * All reads/writes go through the service-role client (getSupabaseAdmin):
 * the table has RLS enabled with no policies and zero anon grants, so the
 * anon key (which ships to browsers) can neither read nor write it. These
 * functions are only ever imported by server-side routes; the public
 * magic-link routes call isAdminEmailAllowed() which reveals nothing more
 * than the old env check did (the response already distinguishes
 * allowlisted/not by design — see the request route's doc comment).
 */

import { getSupabaseAdmin } from '../supabase-server'
import { isAllowlistedAdmin } from './admin-auth'
import type { AdminRole } from './curators'

export interface AdminEmailEntry {
  email: string
  /** 'env' = seeded from ADMIN_EMAILS (cannot be revoked from the dashboard). */
  source: 'env' | 'supabase'
  role: AdminRole
  invitedBy?: string
  createdAt?: number
  /** Second-factor state for the People table. dbOk=false = store unreachable. */
  totp?: { enabled: boolean; pending: boolean; dbOk: boolean }
}

interface AdminEmailRow {
  email: string
  invited_by: string
  created_at: string
  role: string | null
}

function envEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * True when the address may sign in: env allowlist first (fast path, works
 * even if the DB is down), then the Supabase table. Never throws — a DB
 * failure degrades to the env list rather than breaking the login page.
 */
export async function isAdminEmailAllowed(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase()
  if (isAllowlistedAdmin(clean)) return true
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('admin_emails')
      .select('email')
      .eq('email', clean)
      .maybeSingle()
    return !error && !!data
  } catch {
    return false
  }
}

/**
 * Every admin address, env-seeded plus table rows. dbOk tells the dashboard
 * whether the table was reachable (false = showing env admins only).
 */
export async function listAdminEmails(): Promise<{ admins: AdminEmailEntry[]; dbOk: boolean }> {
  const env = envEmails()
  const merged = new Map<string, AdminEmailEntry>()
  for (const email of env) {
    merged.set(email, { email, source: 'env', role: 'admin' })
  }

  let dbOk = true
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('admin_emails')
      .select('email, invited_by, created_at, role')
      .order('created_at', { ascending: true })
    if (error || !data) {
      dbOk = false
    } else {
      for (const row of data as unknown as AdminEmailRow[]) {
        merged.set(row.email, {
          email: row.email,
          source: 'supabase',
          role: row.role === 'curator' ? 'curator' : 'admin',
          invitedBy: row.invited_by,
          createdAt: new Date(row.created_at).getTime(),
        })
      }
    }
  } catch {
    dbOk = false
  }

  // Best-effort second-factor state for the People table. Only when the main
  // list read succeeded — a DB outage already degrades the list, and the TOTP
  // store lives on the same connection.
  if (dbOk && merged.size > 0) {
    try {
      const supabase = getSupabaseAdmin()
      const { data: totpRows, error: totpError } = await supabase
        .from('admin_totp')
        .select('email, secret, pending_secret, enabled_at')
        .in('email', [...merged.keys()])
      const totpDbOk = !totpError && Array.isArray(totpRows)
      const byEmail = new Map<string, { secret: string | null; pending_secret: string | null; enabled_at: string | null }>()
      for (const row of (totpRows ?? []) as unknown as Array<{
        email: string
        secret: string | null
        pending_secret: string | null
        enabled_at: string | null
      }>) {
        byEmail.set(row.email, row)
      }
      for (const entry of merged.values()) {
        const row = byEmail.get(entry.email)
        entry.totp = {
          enabled: !!row?.secret && !!row?.enabled_at,
          pending: !!row?.pending_secret,
          dbOk: totpDbOk,
        }
      }
    } catch {
      for (const entry of merged.values()) {
        entry.totp = { enabled: false, pending: false, dbOk: false }
      }
    }
  }

  return { admins: [...merged.values()], dbOk }
}

/**
 * Adds an address to the table (idempotent — re-inviting is a no-op upsert).
 * The address still needs to be real and reachable for the OTP email to land;
 * this only controls who is *allowed* to request a code.
 */
export async function inviteAdminEmail(
  email: string,
  invitedBy: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = email.trim().toLowerCase()
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('admin_emails')
      .upsert({ email: clean, invited_by: invitedBy }, { onConflict: 'email' })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Removes an address from the table. notFound = it wasn't there. */
export async function revokeAdminEmail(
  email: string
): Promise<{ ok: true; notFound?: boolean } | { ok: false; error: string }> {
  const clean = email.trim().toLowerCase()
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('admin_emails')
      .delete()
      .eq('email', clean)
      .select('email')
    if (error) return { ok: false, error: error.message }
    return data && data.length > 0 ? { ok: true } : { ok: true, notFound: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * lib/api/curators.ts — the curator tier's role model (CURATOR_GOVERNANCE.md).
 *
 * Two roles on the `admin_emails` allowlist (migration 0014):
 *   - `admin`   — everything, including invite/revoke, hide/restore, endpoints,
 *                 load, guide.
 *   - `curator` — map work only: list stops, rename/move/hub, merge + undo,
 *                 detect duplicates, review stop suggestions, own audit view.
 *
 * The role is re-read from the DB on every check, so a revoke is immediate —
 * no session-role caching. Env-seeded (ADMIN_EMAILS) addresses are deploy
 * owners and always count as admin; the shared `x-admin-token` path is the
 * legacy full-access credential and also counts as admin.
 */

import { getSupabaseAdmin } from '../supabase-server'
import { isAllowlistedAdmin, type AuthRequestLike } from './admin-auth'

export type AdminRole = 'admin' | 'curator'

/**
 * Current role for an authenticated email, or null when unknown (not on the
 * allowlist / DB unreachable / row has no valid role). Env-seeded addresses
 * and the shared token are always admin.
 */
export async function getAdminRole(email: string | null | undefined): Promise<AdminRole | null> {
  if (!email) return null
  if (email === 'shared-token') return 'admin'
  if (isAllowlistedAdmin(email)) return 'admin'

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('admin_emails')
      .select('role')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()
    if (error || !data) return null
    const role = (data as { role?: string }).role
    return role === 'curator' ? 'curator' : role === 'admin' ? 'admin' : null
  } catch {
    return null
  }
}

export type RoleGateResult =
  | { ok: true; role: AdminRole }
  | { ok: false; reason: 'forbidden' }

/**
 * Declarative role gate for a route. Call after checkAdminAuth.
 *   requireRole(request, email, 'curator') → curator OR admin may pass
 *   requireRole(request, email, 'admin')   → admin only
 */
export async function requireRole(
  _request: AuthRequestLike,
  email: string,
  min: AdminRole
): Promise<RoleGateResult> {
  const role = await getAdminRole(email)
  if (!role) return { ok: false, reason: 'forbidden' }
  if (min === 'curator') return { ok: true, role }
  return role === 'admin' ? { ok: true, role } : { ok: false, reason: 'forbidden' }
}

/**
 * Grants or revokes the curator role on the allowlist table (admin-only
 * operation). Revoke returns the address to plain `admin` — it stays on the
 * allowlist, it just loses curator powers. Audited by the caller.
 */
export async function setCuratorRole(
  email: string,
  grant: boolean
): Promise<{ ok: true } | { ok: false; error: string; notFound?: boolean }> {
  const clean = email.trim().toLowerCase()
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('admin_emails')
      .update({ role: grant ? 'curator' : 'admin' })
      .eq('email', clean)
      .select('email')
    if (error) return { ok: false, error: error.message }
    if (!data || data.length === 0) return { ok: false, error: 'Not on the admin list', notFound: true }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The list for the People tab — role included. */
export interface CuratorEntry {
  email: string
  role: AdminRole
  source: 'env' | 'supabase'
  invitedBy?: string
  createdAt?: number
}

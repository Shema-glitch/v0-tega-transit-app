/**
 * lib/api/admin-profile.ts — profile fields on the `admin_emails` allowlist
 * (migration 0015): a display name that shows in the console sidebar instead
 * of the raw email. Email and role are owned elsewhere; this only touches the
 * display name. Reads/writes are scoped to the caller's own row — an admin
 * can never edit another admin's profile through here.
 */

import { getSupabaseAdmin } from '../supabase-server'

export interface AdminProfile {
  email: string
  displayName: string | null
  /** ISO timestamp of the allowlist row (when this admin was invited). */
  createdAt: string | null
}

/**
 * Read one admin's profile. Returns null when the row is missing or the DB is
 * unreachable (callers treat that as "no profile yet").
 */
export async function getAdminProfile(email: string): Promise<AdminProfile | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('admin_emails')
      .select('email, display_name, created_at')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()
    if (error || !data) return null
    return {
      email: data.email,
      displayName: (data.display_name as string | null) ?? null,
      createdAt: (data.created_at as string | null) ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Set the caller's own display name. Trims and caps the length; an empty
 * value clears it back to null (the sidebar then shows the email).
 */
export async function updateAdminDisplayName(
  email: string,
  displayName: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = displayName.trim().slice(0, 48)
  if (clean.length === 0) {
    // Allow clearing, but reject a name that's only whitespace after trim.
    if (!displayName.trim()) return { ok: false, error: 'Name cannot be empty.' }
  }
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('admin_emails')
      .update({ display_name: clean || null })
      .eq('email', email.trim().toLowerCase())
    if (error) return { ok: false, error: 'Could not save the name.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the database.' }
  }
}

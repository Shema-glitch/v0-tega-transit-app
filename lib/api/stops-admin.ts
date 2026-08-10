/**
 * Shared writes to the `stops` table — used by both the direct admin
 * endpoints (app/api/admin/stops/*) and stop-suggestion approval
 * (app/api/admin/stop-suggestions/[id]), so "approve a suggestion" and
 * "edit a stop directly" can never drift into two different code paths
 * that happen to do almost the same insert/update/delete.
 *
 * Writes go through the admin_create_stop/admin_update_stop/admin_delete_stop
 * SECURITY DEFINER functions (supabase/migrations/0007_stops_admin_writes.sql),
 * not a direct `.from('stops')` call — the live `stops` table has RLS
 * enabled with no policy permitting the anon key to write, discovered when
 * a direct insert/update/delete failed with "new row violates row-level
 * security policy" during verification. Same reason stop_suggestions and
 * bug_reports already go through functions instead of direct table access.
 */

import { getSupabaseAdmin } from '../supabase-server'
import { invalidateStopsCache } from './stops-cache'

type WriteResult = { ok: true; id?: string } | { ok: false; error: string; notFound?: boolean }

/**
 * '9' prefix keeps ids created here visually distinct from imported GTFS
 * numeric ids (observed as 10-digit strings) — never collides with real
 * GTFS data, and is easy to spot in any listing/export.
 */
export function generateStopId(): string {
  return `9${Date.now()}`
}

export async function createStopRow(name: string, lat: number, lon: number): Promise<WriteResult> {
  const stopId = generateStopId()
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.rpc('admin_create_stop', { p_stop_id: stopId, p_name: name, p_lat: lat, p_lon: lon })
  if (error) return { ok: false, error: error.message }
  invalidateStopsCache()
  return { ok: true, id: stopId }
}

export async function updateStopRow(
  id: string,
  patch: { name?: string; lat?: number; lon?: number }
): Promise<WriteResult> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('admin_update_stop', {
    p_stop_id: id,
    p_name: patch.name ?? null,
    p_lat: patch.lat ?? null,
    p_lon: patch.lon ?? null,
  })
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Stop not found', notFound: true }
  invalidateStopsCache()
  return { ok: true }
}

/**
 * Full patch (curator tier): rename/move plus is_hub, recording the actor.
 * Goes through admin_update_stop_full (migration 0014) which coalesces nulls
 * and stamps edited_by/edited_at.
 */
export async function updateStopRowFull(
  id: string,
  actor: string,
  patch: { name?: string; lat?: number; lon?: number; isHub?: boolean }
): Promise<WriteResult> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('admin_update_stop_full', {
    p_stop_id: id,
    p_name: patch.name ?? null,
    p_lat: patch.lat ?? null,
    p_lon: patch.lon ?? null,
    p_is_hub: patch.isHub ?? null,
    p_actor: actor,
  })
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Stop not found', notFound: true }
  invalidateStopsCache()
  return { ok: true }
}

export async function deleteStopRow(id: string): Promise<WriteResult> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('admin_delete_stop', { p_stop_id: id })
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Stop not found', notFound: true }
  invalidateStopsCache()
  return { ok: true }
}

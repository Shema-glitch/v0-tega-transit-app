/**
 * Shared writes to the `stops` table — used by both the direct admin
 * endpoints (app/api/admin/stops/*) and stop-suggestion approval
 * (app/api/admin/stop-suggestions/[id]), so "approve a suggestion" and
 * "edit a stop directly" can never drift into two different code paths
 * that happen to do almost the same insert/update/delete.
 */

import { getSupabaseServer } from '../supabase-server'
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
  const supabase = getSupabaseServer()
  const { error } = await supabase.from('stops').insert({ stop_id: stopId, stop_name: name, stop_lat: lat, stop_lon: lon })
  if (error) return { ok: false, error: error.message }
  invalidateStopsCache()
  return { ok: true, id: stopId }
}

export async function updateStopRow(
  id: string,
  patch: { name?: string; lat?: number; lon?: number }
): Promise<WriteResult> {
  const dbPatch: Record<string, string | number> = {}
  if (patch.name !== undefined) dbPatch.stop_name = patch.name
  if (patch.lat !== undefined) dbPatch.stop_lat = patch.lat
  if (patch.lon !== undefined) dbPatch.stop_lon = patch.lon

  const supabase = getSupabaseServer()
  const { data, error } = await supabase.from('stops').update(dbPatch).eq('stop_id', id).select('stop_id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Stop not found', notFound: true }
  invalidateStopsCache()
  return { ok: true }
}

export async function deleteStopRow(id: string): Promise<WriteResult> {
  const supabase = getSupabaseServer()
  const { data, error } = await supabase.from('stops').delete().eq('stop_id', id).select('stop_id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Stop not found', notFound: true }
  invalidateStopsCache()
  return { ok: true }
}

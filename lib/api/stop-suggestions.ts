/**
 * Community stop-edit suggestions (see supabase/migrations/0005_stop_suggestions.sql).
 *
 * Unlike bug reports, there's no in-memory fallback here — a suggestion
 * that fails to persist is just gone, which is fine (the rider can submit
 * again) since this is a low-stakes "nice to have" data-quality signal, not
 * something anyone is waiting on synchronously.
 */

import { getSupabaseServer } from '../supabase-server'

export type SuggestionType = 'add' | 'rename' | 'delete'

export interface StopSuggestion {
  id: number
  type: SuggestionType
  stop_id: string | null
  proposed_name: string | null
  proposed_lat: number | null
  proposed_lon: number | null
  reason: string | null
  client_id: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  reviewed_at: string | null
}

export interface SubmitInput {
  type: SuggestionType
  stopId?: string | null
  proposedName?: string | null
  proposedLat?: number | null
  proposedLon?: number | null
  reason?: string | null
  clientId?: string | null
}

export const StopSuggestions = {
  async submit(input: SubmitInput): Promise<void> {
    const supabase = getSupabaseServer()
    const { error } = await supabase.rpc('submit_stop_suggestion', {
      p_type: input.type,
      p_stop_id: input.stopId ?? null,
      p_proposed_name: input.proposedName ?? null,
      p_proposed_lat: input.proposedLat ?? null,
      p_proposed_lon: input.proposedLon ?? null,
      p_reason: input.reason ?? null,
      p_client_id: input.clientId ?? null,
    })
    if (error) throw new Error(`[stop-suggestions] submit failed: ${error.message}`)
  },

  async getPending(limit = 200): Promise<StopSuggestion[]> {
    const supabase = getSupabaseServer()
    const { data, error } = await supabase.rpc('get_pending_stop_suggestions', { p_limit: limit })
    if (error) throw new Error(`[stop-suggestions] getPending failed: ${error.message}`)
    return (data ?? []) as StopSuggestion[]
  },

  /**
   * Returns the pending suggestion row so the caller can act on it, or null
   * if not found/already resolved. Must go through the RPC function, not a
   * direct `.from('stop_suggestions')` query — RLS on that table has no
   * policies (see 0005_stop_suggestions.sql), so a direct query silently
   * returns zero rows for the anon key regardless of what's actually there.
   */
  async getOne(id: number): Promise<StopSuggestion | null> {
    const supabase = getSupabaseServer()
    const { data, error } = await supabase.rpc('get_pending_stop_suggestion', { p_id: id })
    if (error) throw new Error(`[stop-suggestions] getOne failed: ${error.message}`)
    const rows = (data ?? []) as StopSuggestion[]
    return rows[0] ?? null
  },

  async resolve(id: number, status: 'approved' | 'rejected'): Promise<void> {
    const supabase = getSupabaseServer()
    const { error } = await supabase.rpc('resolve_stop_suggestion', { p_id: id, p_status: status })
    if (error) throw new Error(`[stop-suggestions] resolve failed: ${error.message}`)
  },
}

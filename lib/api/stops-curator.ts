/**
 * lib/api/stops-curator.ts — the curator tier's stop operations.
 *
 * Wraps the SECURITY DEFINER RPCs from supabase/migrations/0014_curators.sql
 * (service-role client, never direct `.from('stops')` writes — same rule as
 * lib/api/stops-admin.ts). Every write path invalidates the public stops
 * cache so riders see merged/hidden state immediately.
 *
 * Merge semantics (see the migration for the SQL): one transactional RPC
 * validates, rewrites stop_times references, retargets pending suggestions,
 * marks victims 'merged' with merged_into_id, and journals a before-snapshot
 * for one-shot undo. `dryRun` computes the exact affected counts without
 * writing — the UI's preview-before-commit step.
 */

import { getSupabaseAdmin } from '../supabase-server'
import { haversineMeters } from './geo'
import { invalidateStopsCache, getAllStops } from './stops-cache'

export interface MergePayload {
  ok: boolean
  error?: string
  dryRun?: boolean
  mergeId?: string
  survivorId?: string
  victims?: string[]
  affectedStopTimes?: number
  stopTimesRewritten?: number
  collisionsSkipped?: number
  pendingSuggestions?: number
  suggestionsRetargeted?: number
}

export type MergeResult = MergePayload & { ok: boolean }

export async function mergeStops(
  survivorId: string,
  victimIds: string[],
  actor: string,
  reason?: string,
  dryRun = false
): Promise<MergeResult> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('admin_merge_stops', {
      p_survivor_id: survivorId,
      p_victim_ids: victimIds,
      p_actor: actor,
      p_reason: reason ?? null,
      p_dry_run: dryRun,
    })
    if (error) return { ok: false, error: error.message }
    const payload = data as MergePayload | null
    if (!payload) return { ok: false, error: 'Merge returned no result' }
    if (!payload.ok) return { ok: false, error: payload.error ?? 'Merge failed' }
    if (!dryRun) invalidateStopsCache()
    return payload
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export type UndoResult = { ok: true; restoredVictims?: number } | { ok: false; error: string }

export async function undoMerge(mergeId: string, actor: string): Promise<UndoResult> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('admin_undo_merge', { p_merge_id: mergeId, p_actor: actor })
    if (error) return { ok: false, error: error.message }
    const payload = data as { ok?: boolean; error?: string; restoredVictims?: number } | null
    if (!payload?.ok) return { ok: false, error: payload?.error ?? 'Undo failed' }
    invalidateStopsCache()
    return { ok: true, restoredVictims: payload.restoredVictims }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function hideStop(stopId: string, actor: string): Promise<UndoResult> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('admin_hide_stop', { p_stop_id: stopId, p_actor: actor })
    if (error) return { ok: false, error: error.message }
    const payload = data as { ok?: boolean; error?: string } | null
    if (!payload?.ok) return { ok: false, error: payload?.error ?? 'Hide failed' }
    invalidateStopsCache()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function restoreStop(stopId: string, actor: string): Promise<UndoResult> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('admin_restore_stop', { p_stop_id: stopId, p_actor: actor })
    if (error) return { ok: false, error: error.message }
    const payload = data as { ok?: boolean; error?: string } | null
    if (!payload?.ok) return { ok: false, error: payload?.error ?? 'Restore failed' }
    invalidateStopsCache()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface RecentMerge {
  id: string
  survivorId: string
  victimIds: string[]
  actorId: string
  reason: string | null
  createdAt: number
}

/** Recent merges with their victims — feeds the undo list + curator audit. */
export async function listRecentMerges(limit = 25): Promise<RecentMerge[]> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('stop_merges')
      .select('id, survivor_id, actor_id, reason, created_at, stop_merge_victims(victim_id)')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return (data as unknown as Array<{
      id: string
      survivor_id: string
      actor_id: string
      reason: string | null
      created_at: string
      stop_merge_victims: Array<{ victim_id: string }> | null
    }>).map((r) => ({
      id: r.id,
      survivorId: r.survivor_id,
      victimIds: (r.stop_merge_victims ?? []).map((v) => v.victim_id),
      actorId: r.actor_id,
      reason: r.reason,
      createdAt: new Date(r.created_at).getTime(),
    }))
  } catch {
    return []
  }
}

// ── Duplicate detection (port of the rider app's findDuplicateClusters) ──

export interface ClusterStop {
  id: string
  name: string
  lat: number
  lon: number
  stopTimesCount: number
}

export interface DuplicateCluster {
  /** Cluster centroid-ish anchor: the stop with the most stop_times. */
  anchor: ClusterStop
  stops: ClusterStop[]
  /** Farthest pair within the cluster, in meters. */
  maxSpanMeters: number
}

/** Union-find over haversine distance — same algorithm as the rider app. */
export function findDuplicateClusters(stops: ClusterStop[], radiusM = 60): DuplicateCluster[] {
  const n = stops.length
  const parent = stops.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineMeters(stops[i].lat, stops[i].lon, stops[j].lat, stops[j].lon) < radiusM) {
        union(i, j)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(i)
    groups.set(root, list)
  }

  const clusters: DuplicateCluster[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const clusterStops = members.map((i) => stops[i])
    const anchor = [...clusterStops].sort((a, b) => b.stopTimesCount - a.stopTimesCount)[0]
    let maxSpanMeters = 0
    for (let i = 0; i < clusterStops.length; i++) {
      for (let j = i + 1; j < clusterStops.length; j++) {
        const d = haversineMeters(
          clusterStops[i].lat,
          clusterStops[i].lon,
          clusterStops[j].lat,
          clusterStops[j].lon
        )
        if (d > maxSpanMeters) maxSpanMeters = d
      }
    }
    clusters.push({ anchor, stops: clusterStops.sort((a, b) => b.stopTimesCount - a.stopTimesCount), maxSpanMeters })
  }

  return clusters.sort((a, b) => a.maxSpanMeters - b.maxSpanMeters)
}

/**
 * Server-side duplicate detection over the full stops table: pulls active
 * stops from the shared cache, joins stop_times counts, runs union-find.
 * Returns candidate clusters (size ≥ 2 within radiusM of each other) with
 * their affected stop_times totals — feeds the UI's "Suggested merges" pane.
 */
export async function detectDuplicateClusters(radiusM = 60): Promise<{
  clusters: DuplicateCluster[]
  scanned: number
  radiusM: number
}> {
  const stops = await getAllStops()
  const counts = await stopTimesCounts()

  const points: ClusterStop[] = stops
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      stopTimesCount: counts.get(s.id) ?? 0,
    }))

  const clusters = findDuplicateClusters(points, radiusM)
  return { clusters, scanned: points.length, radiusM }
}

async function stopTimesCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('stop_times')
      .select('stop_id')
      .not('stop_id', 'is', null)
    if (error || !data) return counts
    for (const row of data as Array<{ stop_id: string | null }>) {
      if (row.stop_id) counts.set(row.stop_id, (counts.get(row.stop_id) ?? 0) + 1)
    }
  } catch {
    // empty counts — clusters still work, just without the affected-row numbers
  }
  return counts
}

/**
 * In-memory TTL cache of the GTFS `stops` table.
 *
 * Several endpoints (/api/stops, /api/gtfs/hubs, /api/stops/[id]/arrivals)
 * previously issued a full-table SELECT on every request just to run a
 * proximity scan in JS. Stop data is effectively static (it changes when a
 * new GTFS feed is imported), so we fetch it once per server instance and
 * refresh it hourly. A failed refresh serves the previous snapshot.
 */

import { getSupabaseServer } from '../supabase-server'
import { haversineMeters } from './geo'

export interface CachedStop {
  id: string
  name: string
  lat: number
  lon: number
}

const TTL_MS = 60 * 60 * 1000 // 1 hour
const DEDUP_RADIUS_M = 50

let snapshot: CachedStop[] | null = null
let canonical: CachedStop[] | null = null
let fetchedAt = 0
let inflight: Promise<CachedStop[]> | null = null

function normalizeStopName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Spatial + name deduplication. Merges two records ONLY when they are within
 * 50m AND their normalized names match — proximity alone is not enough,
 * because paired directional stops ("Gatenga" / "Gatenga East") legitimately
 * sit meters apart and must stay distinct (see docs/BACKEND_HANDOFF.md #2).
 * Prefers the longer (more descriptive) name. O(n^2) but computed ONCE per
 * cache refresh instead of on every request.
 */
function deduplicate(stops: CachedStop[]): CachedStop[] {
  const primary: CachedStop[] = []
  for (const stop of stops) {
    const normalized = normalizeStopName(stop.name)
    const dupIdx = primary.findIndex(
      (p) =>
        normalizeStopName(p.name) === normalized &&
        haversineMeters(p.lat, p.lon, stop.lat, stop.lon) < DEDUP_RADIUS_M
    )
    if (dupIdx === -1) {
      primary.push(stop)
    } else if (stop.name.length > primary[dupIdx].name.length) {
      primary[dupIdx] = stop
    }
  }
  return primary
}

interface StopRow {
  stop_id: string
  stop_name: string | null
  stop_lat: number | null
  stop_lon: number | null
  status?: string
  merged_into_id?: string | null
}

async function fetchStops(): Promise<CachedStop[]> {
  const supabase = getSupabaseServer()
  const run = (select: string) =>
    supabase
      .from('stops')
      .select(select)
      .not('stop_lat', 'is', null)
      .not('stop_lon', 'is', null)

  // Curator soft-state columns (migration 0014): merged + hidden stops drop
  // out of public search, and merged stops collapse into their survivor. If
  // the migration hasn't been applied on an older deploy, fall back to the
  // plain query rather than breaking search.
  let result = await run('stop_id, stop_name, stop_lat, stop_lon, status, merged_into_id')
  if (result.error) result = await run('stop_id, stop_name, stop_lat, stop_lon')
  const { data, error } = result
  if (error) throw new Error(`[stops-cache] Supabase error: ${error.message}`)

  return (data ?? [])
    .map((r) => {
      const row = r as unknown as StopRow
      if ((row.status ?? 'active') !== 'active') return null
      return {
        id: String(row.merged_into_id ?? row.stop_id),
        name: row.stop_name ?? '',
        lat: row.stop_lat as number,
        lon: row.stop_lon as number,
      }
    })
    .filter((s): s is CachedStop => s !== null && Number.isFinite(s.lat) && Number.isFinite(s.lon))
}

/**
 * Returns the cached stop list, fetching/refreshing as needed.
 * Concurrent callers share a single in-flight fetch.
 * Throws only when there is no snapshot at all AND the fetch fails.
 */
export async function getAllStops(): Promise<CachedStop[]> {
  const fresh = snapshot !== null && Date.now() - fetchedAt < TTL_MS
  if (fresh) return snapshot!

  if (!inflight) {
    inflight = fetchStops()
      .then((stops) => {
        snapshot = stops
        canonical = deduplicate(stops)
        fetchedAt = Date.now()
        return stops
      })
      .finally(() => {
        inflight = null
      })
  }

  try {
    return await inflight
  } catch (err) {
    if (snapshot) {
      // Stale-if-error: keep serving the previous snapshot
      console.warn('[stops-cache] refresh failed, serving stale snapshot:', err)
      return snapshot
    }
    throw err
  }
}

/**
 * The deduplicated ("canonical") stop list — one stop per 50m cluster,
 * preferring descriptive names. Use this for anything user-facing.
 */
export async function getCanonicalStops(): Promise<CachedStop[]> {
  await getAllStops()
  return canonical ?? snapshot ?? []
}

/**
 * Forces the next getAllStops()/getCanonicalStops() call to refetch from
 * Supabase instead of serving the hourly snapshot. Call this after any
 * admin write (create/rename/delete) — otherwise a stop you just edited
 * would keep reading stale for up to an hour.
 */
export function invalidateStopsCache(): void {
  snapshot = null
  canonical = null
  fetchedAt = 0
}

/** IDs of all stops within `radiusMeters` of a coordinate (includes the origin stop). */
export async function findStopIdsNear(
  lat: number,
  lon: number,
  radiusMeters: number
): Promise<string[]> {
  const stops = await getAllStops()
  return stops
    .filter((s) => haversineMeters(lat, lon, s.lat, s.lon) < radiusMeters)
    .map((s) => s.id)
}

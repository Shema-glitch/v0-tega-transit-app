/**
 * GET /api/gtfs/stops?q=<name>&limit=<n>&offset=<n>
 *
 * Returns deduplicated, name-validated stops, optionally filtered by
 * (case-insensitive) name substring, with real pagination.
 *
 * Query parameters (all optional):
 *   q       – string  Case-insensitive name substring filter
 *   limit   – int     Max results per page (default 200, max 2000)
 *   offset  – int     Pagination offset (default 0)
 *
 * Response: { stops: [...], total, limit, offset }
 * `total` is the full matching count BEFORE pagination — previously this
 * endpoint silently truncated to 50 results with no way to see or fetch the
 * rest (docs/BACKEND_HANDOFF.md #1).
 *
 * Primary source: the shared in-memory stops cache (one Supabase fetch per
 * hour instead of a full-table query per request). Fallback: local GTFS CSV.
 */

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'
import { getCanonicalStops } from '@/lib/api/stops-cache'
import { CacheService } from '@/lib/api/cache.service'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 2000

/**
 * Name validation: reject garbage / meaningless stop names.
 */
function isValidStopName(name: string): boolean {
  if (!name || name === 'Unknown Stop') return false
  const clean = name.trim()
  if (clean.length <= 1) return false
  // Pure number or alphanumeric code like "X12" or "3B"
  if (/^[A-Za-z]?\d+[A-Za-z]?$/.test(clean)) return false
  // Whitespace or punctuation only
  if (/^[\s\-_.]+$/.test(clean)) return false
  // Common test / placeholder names
  if (/^(test|temp|null|undefined|todo|fixme|n\/a)$/i.test(clean)) return false
  return true
}

function parsePaging(searchParams: URLSearchParams) {
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT

  const rawOffset = parseInt(searchParams.get('offset') ?? '', 10)
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0

  return { limit, offset }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.toLowerCase() ?? null
  const { limit, offset } = parsePaging(searchParams)

  try {
    // Canonical stops are already spatially deduplicated at cache-refresh time
    const canonical = await getCanonicalStops()

    const matching = canonical
      .filter((s) => isValidStopName(s.name))
      .filter((s) => (q ? s.name.toLowerCase().includes(q) : true))

    const stops = matching
      .slice(offset, offset + limit)
      .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }))

    return NextResponse.json(
      { stops, total: matching.length, limit, offset },
      { headers: CacheService.suggestionHeaders() }
    )
  } catch (err) {
    console.warn('Stops cache unavailable, falling back to local GTFS CSV:', err)

    try {
      const filePath = path.join(process.cwd(), 'kigali_gtfs', 'stops.txt')
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8')
        const records = parse(fileContent, { columns: true, skip_empty_lines: true })

        const matching = records
          .map((stop: any) => ({
            id: String(stop.stop_id),
            name: (stop.stop_name as string) ?? '',
            lat: parseFloat(stop.stop_lat),
            lon: parseFloat(stop.stop_lon),
          }))
          .filter(
            (s: any) =>
              !isNaN(s.lat) &&
              !isNaN(s.lon) &&
              isValidStopName(s.name) &&
              (q ? s.name.toLowerCase().includes(q) : true)
          )

        const stops = matching.slice(offset, offset + limit)

        return NextResponse.json({ stops, total: matching.length, limit, offset })
      }
    } catch (fsError) {
      console.error('Local CSV fallback failed:', fsError)
    }

    return NextResponse.json({ error: 'Stop data unavailable' }, { status: 500 })
  }
}

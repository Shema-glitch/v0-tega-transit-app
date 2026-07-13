/**
 * GET /api/stops
 *
 * Returns physical stops from the Supabase GTFS `stops` table.
 *
 * Query parameters (all optional):
 *   lat     – float   User latitude for proximity sort
 *   lng     – float   User longitude for proximity sort
 *   radius  – int     Search radius in metres (default 2000, max 10000)
 *   limit   – int     Max results (default 50, max 200)
 *
 * Response shape:
 *   [{ id, name, lat, lon }, ...]
 *
 * Always returns HTTP 200. An empty array means no stops matched.
 *
 * Stop data is served from the shared in-memory cache (lib/api/stops-cache)
 * instead of hitting Supabase on every request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCanonicalStops } from '@/lib/api/stops-cache'
import { haversineMeters } from '@/lib/api/geo'
import { CORS, corsPreflight } from '@/lib/api/cors'
import { withLatencyTracking } from '@/lib/api/telemetry.service'

function parseFloatOrNull(v: string | null): number | null {
  if (v === null) return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function clampInt(raw: string | null, defaultVal: number, max: number): number {
  if (raw === null) return defaultVal
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return defaultVal
  return Math.min(n, max)
}

export async function GET(request: NextRequest) {
  return withLatencyTracking(() => handleGet(request))
}

async function handleGet(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const userLat = parseFloatOrNull(sp.get('lat'))
  const userLng = parseFloatOrNull(sp.get('lng'))
  const radius = clampInt(sp.get('radius'), 2000, 10_000)
  const limit = clampInt(sp.get('limit'), 50, 200)

  try {
    // Canonical list is already spatially deduplicated at cache-refresh time
    let stops = (await getCanonicalStops()).map((s) => ({ ...s }))

    // Optional proximity filter + sort
    if (userLat !== null && userLng !== null) {
      stops = stops
        .map((s) => ({
          ...s,
          _distM: haversineMeters(userLat, userLng, s.lat, s.lon),
        }))
        .filter((s) => s._distM <= radius)
        .sort((a, b) => a._distM - b._distM)
    }

    return NextResponse.json(stops.slice(0, limit), {
      status: 200,
      headers: {
        ...CORS,
        // Semi-static: re-validate once an hour, serve stale for 24 h
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('[GET /api/stops] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: CORS }
    )
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

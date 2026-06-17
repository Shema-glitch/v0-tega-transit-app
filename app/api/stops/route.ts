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
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Haversine distance in metres between two WGS-84 coordinates. */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000 // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

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

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // ── CORS preflight (belt-and-suspenders on top of next.config.mjs) ──────────
  const corsHeaders: HeadersInit = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  const sp = request.nextUrl.searchParams
  const userLat = parseFloatOrNull(sp.get('lat'))
  const userLng = parseFloatOrNull(sp.get('lng'))
  const radius = clampInt(sp.get('radius'), 2000, 10_000)
  const limit = clampInt(sp.get('limit'), 50, 200)

  try {
    const supabase = getSupabaseServer()

    // Fetch all stops from Supabase (the table is not large enough to paginate
    // in most GTFS feeds; for very large feeds add a server-side bounding box).
    const { data: rows, error } = await supabase
      .from('stops')
      .select('stop_id, stop_name, stop_lat, stop_lon')
      .not('stop_lat', 'is', null)
      .not('stop_lon', 'is', null)

    if (error) {
      console.error('[GET /api/stops] Supabase error:', error)
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500, headers: corsHeaders }
      )
    }

    // Normalise to the shape the frontend expects
    let stops = (rows ?? []).map((r) => ({
      id: String(r.stop_id),
      name: r.stop_name ?? '',
      lat: r.stop_lat as number,
      lon: r.stop_lon as number,
    }))

    // Optional proximity filter + sort
    if (userLat !== null && userLng !== null) {
      stops = stops
        .map((s) => ({
          ...s,
          _distM: haversineMeters(userLat, userLng, s.lat, s.lon),
        }))
        .filter((s) => s._distM <= radius)
        .sort((a, b) => a._distM - b._distM)
        .slice(0, limit)
        .map(({ _distM, ...s }) => s)
    } else {
      stops = stops.slice(0, limit)
    }

    return NextResponse.json(stops, {
      status: 200,
      headers: {
        ...corsHeaders,
        // Semi-static: re-validate once an hour, serve stale for 24 h
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('[GET /api/stops] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: corsHeaders }
    )
  }
}

// Allow browsers to preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

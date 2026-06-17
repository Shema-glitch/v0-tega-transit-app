/**
 * GET /api/routes/{route_id}/shape
 *
 * Returns the GeoJSON Feature (LineString) for the requested route by joining
 * routes → trips → shapes in the Supabase GTFS tables.
 *
 * Strategy:
 *  1. Look up a representative trip for the route (direction 0 preferred).
 *  2. Fetch the shape points for that trip's shape_id, ordered by sequence.
 *  3. Return a GeoJSON Feature so the frontend can feed it directly into a
 *     Mapbox LineLayer source.
 *
 * Coordinates are in [longitude, latitude] order (GeoJSON / Mapbox standard).
 *
 * Errors:
 *  - 404  if the route_id is not found in the `routes` table.
 *  - 404  if the route exists but has no trips or shape data.
 *  - 500  on any database error.
 *
 * CORS is fully open.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { CacheService } from '@/lib/api/cache.service'

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params
  const routeId = resolvedParams.id

  if (!routeId || routeId.trim() === '') {
    return NextResponse.json(
      { error: 'Route ID required' },
      { status: 400, headers: CORS }
    )
  }

  try {
    const supabase = getSupabaseServer()

    // ── 1. Verify the route exists ─────────────────────────────────────────────
    const { data: routeRow, error: routeErr } = await supabase
      .from('routes')
      .select('route_id, route_short_name, route_long_name, route_color')
      .eq('route_id', routeId)
      .maybeSingle()

    if (routeErr) {
      console.error('[shape] route lookup error:', routeErr)
      return NextResponse.json(
        { error: 'Database error', details: routeErr.message },
        { status: 500, headers: CORS }
      )
    }

    if (!routeRow) {
      return NextResponse.json(
        { error: `Route '${routeId}' not found` },
        { status: 404, headers: CORS }
      )
    }

    // ── 2. Find a representative trip (prefer direction_id = 0) ────────────────
    const { data: tripRows, error: tripErr } = await supabase
      .from('trips')
      .select('trip_id, shape_id, direction_id')
      .eq('route_id', routeId)
      .not('shape_id', 'is', null)
      .order('direction_id', { ascending: true })
      .limit(1)

    if (tripErr) {
      console.error('[shape] trips query error:', tripErr)
      return NextResponse.json(
        { error: 'Database error', details: tripErr.message },
        { status: 500, headers: CORS }
      )
    }

    const trip = tripRows?.[0]
    if (!trip?.shape_id) {
      return NextResponse.json(
        {
          error: `No shape data available for route '${routeId}'`,
          routeId,
        },
        { status: 404, headers: CORS }
      )
    }

    // ── 3. Fetch shape points ordered by sequence ──────────────────────────────
    const { data: shapeRows, error: shapeErr } = await supabase
      .from('shapes')
      .select('shape_pt_lon, shape_pt_lat, shape_pt_sequence')
      .eq('shape_id', trip.shape_id)
      .order('shape_pt_sequence', { ascending: true })

    if (shapeErr) {
      console.error('[shape] shapes query error:', shapeErr)
      return NextResponse.json(
        { error: 'Database error', details: shapeErr.message },
        { status: 500, headers: CORS }
      )
    }

    if (!shapeRows || shapeRows.length === 0) {
      return NextResponse.json(
        {
          error: `Shape '${trip.shape_id}' has no points`,
          routeId,
        },
        { status: 404, headers: CORS }
      )
    }

    // ── 4. Build GeoJSON Feature ───────────────────────────────────────────────
    // Coordinates in [longitude, latitude] order — GeoJSON / Mapbox standard.
    const coordinates: [number, number][] = shapeRows.map((pt) => [
      pt.shape_pt_lon as number,
      pt.shape_pt_lat as number,
    ])

    const feature = {
      type: 'Feature',
      properties: {
        routeId,
        routeShortName: routeRow.route_short_name ?? routeId,
        routeLongName: routeRow.route_long_name ?? '',
        color: routeRow.route_color ? `#${routeRow.route_color}` : '#4ECDC4',
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    }

    return NextResponse.json(
      {
        routeId,
        // Also expose the flat coordinates array for backward compatibility
        coordinates,
        // Full GeoJSON Feature (preferred for Mapbox GeoJSON sources)
        feature,
        metadata: {
          simplified: false,
          pointsCount: coordinates.length,
          shapeId: trip.shape_id,
        },
      },
      {
        status: 200,
        headers: {
          ...CORS,
          ...(CacheService.staticHeaders() as Record<string, string>),
        },
      }
    )
  } catch (err) {
    console.error('[GET /api/routes/[id]/shape] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: CORS }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS,
  })
}

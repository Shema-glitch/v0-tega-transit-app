/**
 * GET /api/routes
 *
 * Returns all bus routes from the Supabase GTFS `routes` table.
 *
 * Response:
 *   Array of route objects with id, shortName, longName, color, textColor.
 *
 * Always returns 200. Empty array if no routes are in the database.
 * Access-Control-Allow-Origin is set by middleware.ts (allowlisted, not open).
 *
 * The routes list is immutable between GTFS imports, so the mapped result is
 * cached in-memory for an hour (single-flight — concurrent callers share one
 * Supabase query). See docs/DEPLOYMENT_GUIDE.md §Scaling.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { withRequestMetrics } from '@/lib/api/request-metrics'
import { cacheWrap } from '@/lib/api/ttl-cache'
import { HttpError } from '@/lib/api/http-error'

const CORS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const ROUTES_TTL_MS = 60 * 60 * 1000 // 1 hour, matching the Cache-Control below

export async function GET() {
  return withRequestMetrics('routes.list', () => handleGet())
}

async function handleGet() {
  try {
    const routes = await cacheWrap('routes-list', ROUTES_TTL_MS, async () => {
      const supabase = getSupabaseServer()

      const { data: rows, error } = await supabase
        .from('routes')
        .select(
          'route_id, route_short_name, route_long_name, route_desc, route_color, route_text_color, route_type'
        )
        .order('route_sort_order', { ascending: true, nullsFirst: false })

      if (error) {
        // Thrown, not returned, so cacheWrap never caches a DB failure and
        // the catch below maps it back to the historical error shape.
        throw new HttpError(500, { error: 'Database error', details: error.message })
      }

      return (rows ?? []).map((r) => ({
        id: r.route_id,
        shortName: r.route_short_name ?? r.route_id,
        longName: r.route_long_name ?? '',
        description: r.route_desc ?? '',
        // GTFS stores color without the leading '#'
        color: r.route_color ? `#${r.route_color}` : '#4ECDC4',
        textColor: r.route_text_color ? `#${r.route_text_color}` : '#FFFFFF',
        type: r.route_type ?? 3, // 3 = Bus
      }))
    })

    return NextResponse.json(routes, {
      status: 200,
      headers: {
        ...CORS,
        // Routes change rarely; cache for 1 day at the edge (browser: 1 h)
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=43200',
      },
    })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.body, { status: err.status, headers: CORS })
    }
    console.error('[GET /api/routes] Unexpected error:', err)
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

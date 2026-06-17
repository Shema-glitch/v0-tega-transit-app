/**
 * GET /api/routes
 *
 * Returns all bus routes from the Supabase GTFS `routes` table.
 *
 * Response:
 *   Array of route objects with id, shortName, longName, color, textColor.
 *
 * Always returns 200. Empty array if no routes are in the database.
 * CORS is fully open.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = getSupabaseServer()

    const { data: rows, error } = await supabase
      .from('routes')
      .select(
        'route_id, route_short_name, route_long_name, route_desc, route_color, route_text_color, route_type'
      )
      .order('route_sort_order', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('[GET /api/routes] Supabase error:', error)
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500, headers: CORS }
      )
    }

    const routes = (rows ?? []).map((r) => ({
      id: r.route_id,
      shortName: r.route_short_name ?? r.route_id,
      longName: r.route_long_name ?? '',
      description: r.route_desc ?? '',
      // GTFS stores color without the leading '#'
      color: r.route_color ? `#${r.route_color}` : '#4ECDC4',
      textColor: r.route_text_color ? `#${r.route_text_color}` : '#FFFFFF',
      type: r.route_type ?? 3, // 3 = Bus
    }))

    return NextResponse.json(routes, {
      status: 200,
      headers: {
        ...CORS,
        // Routes change rarely; cache for 1 day at the edge
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
      },
    })
  } catch (err) {
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

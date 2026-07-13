/**
 * GET /api/gtfs/stops/{id}/routes
 *
 * Returns the routes serving a stop (stop_times → trips → routes join),
 * served from the shared in-memory GTFS cache — the CSV files are parsed
 * once per server instance, not on every request.
 */

import { NextResponse } from 'next/server'
import { getRoutesServingStop } from '@/lib/api/gtfs-parser'
import { CacheService } from '@/lib/api/cache.service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: stopId } = await params

  try {
    const routes = await getRoutesServingStop(stopId)
    return NextResponse.json({ routes }, { headers: CacheService.staticHeaders() })
  } catch (err) {
    console.error('Unexpected API error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getRouteSequence } from '@/lib/api/gtfs-parser'
import { CacheService } from '@/lib/api/cache.service'
import { withRequestMetrics } from '@/lib/api/request-metrics'
import { cacheWrap } from '@/lib/api/ttl-cache'
import { HttpError } from '@/lib/api/http-error'

// Route sequences are static GTFS data; the raw parse is already cached
// in-memory, but the per-request trip/stop_times resolution re-scans the
// arrays on every hit — this collapses repeats onto one computation.
const SEQUENCE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRequestMetrics('routes.sequence', () => handleGet(request, params))
}

async function handleGet(
  request: NextRequest,
  params: Promise<{ id: string }>
) {
  try {
    const resolvedParams = await params
    const routeId = resolvedParams.id
    if (!routeId) return NextResponse.json({ error: 'Route ID required' }, { status: 400 })

    const searchParams = request.nextUrl.searchParams
    const directionId = searchParams.get('direction') || '0'

    const data = await cacheWrap(`sequence:${routeId}:${directionId}`, SEQUENCE_TTL_MS, async () => {
      const sequenceData = await getRouteSequence(routeId, directionId)
      if (!sequenceData) {
        throw new HttpError(404, { error: 'Route sequence not found in GTFS data' })
      }
      return sequenceData
    })

    return NextResponse.json(data, { headers: CacheService.staticHeaders() })
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    console.error('Route Sequence API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

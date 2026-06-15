import { NextRequest, NextResponse } from 'next/server'
import { getRouteSequence } from '@/lib/api/gtfs-parser'
import { CacheService } from '@/lib/api/cache.service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params
    const routeId = resolvedParams.id
    if (!routeId) return NextResponse.json({ error: 'Route ID required' }, { status: 400 })

    const searchParams = request.nextUrl.searchParams
    const directionId = searchParams.get('direction') || '0'

    const sequenceData = await getRouteSequence(routeId, directionId)
    
    if (!sequenceData) {
      return NextResponse.json({ error: 'Route sequence not found in GTFS data' }, { status: 404 })
    }

    return NextResponse.json(sequenceData, { headers: CacheService.staticHeaders() })
  } catch (error) {
    console.error('Route Sequence API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

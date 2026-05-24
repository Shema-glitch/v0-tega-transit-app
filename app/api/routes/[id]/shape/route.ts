import { NextRequest, NextResponse } from 'next/server'
import { kigaliRouteGeometries } from '@/lib/kigali-gtfs'
import { CacheService } from '@/lib/api/cache.service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params
    const routeId = resolvedParams.id
    if (!routeId) return NextResponse.json({ error: 'Route ID required' }, { status: 400 })

    // Fetch geometry (currently from mock data, eventually from Supabase 'shapes' table)
    const geometry = kigaliRouteGeometries.find(g => g.routeId === routeId)
    
    if (!geometry) {
      return NextResponse.json({ error: 'Route shape not found' }, { status: 404 })
    }

    return NextResponse.json(
      { 
        routeId: geometry.routeId,
        coordinates: geometry.coordinates, // [lng, lat] format
        metadata: {
          simplified: true,
          pointsCount: geometry.coordinates.length
        }
      },
      { headers: CacheService.staticHeaders() }
    )
  } catch (error) {
    console.error('Route Shape API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

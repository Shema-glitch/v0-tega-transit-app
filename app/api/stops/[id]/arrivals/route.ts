import { NextRequest, NextResponse } from 'next/server'
import { EtaEngine } from '@/lib/api/eta.engine'
import { CacheService } from '@/lib/api/cache.service'
import { ArrivalSchema } from '@/lib/api/validation'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params
    const stopId = resolvedParams.id
    if (!stopId) {
      return NextResponse.json({ error: 'Stop ID required' }, { status: 400 })
    }

    // In a real production system, this queries the spatial DB to find vehicles
    // where `ST_DWithin(vehicle.location, stop.location, 5000)` and moving towards the stop.
    // For now, we simulate dynamic arrivals.
    
    const mockDistances = [800, 2400, 5600] // meters
    const mockRoutes = ['route-101', 'route-102', 'route-104']

    const arrivals = mockDistances.map((dist, i) => {
      const rawArrival = EtaEngine.formatArrival(`dyn-bus-${i}`, mockRoutes[i], stopId, dist)
      // Enhance with additional metadata needed by ArrivalSchema
      return ArrivalSchema.parse({
        ...rawArrival,
        id: `arrival-${Date.now()}-${i}`,
        routeName: `Route ${mockRoutes[i].replace('route-', '')}`,
        destination: i % 2 === 0 ? 'Downtown' : 'Remera'
      })
    })

    return NextResponse.json(
      { 
        stopId,
        arrivals,
        metadata: {
          timestamp: new Date().toISOString(),
          engine: 'eta_v2_predictive'
        }
      },
      { headers: CacheService.liveHeaders() }
    )
  } catch (error) {
    console.error('Arrivals API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

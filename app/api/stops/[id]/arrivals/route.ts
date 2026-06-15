import { NextRequest, NextResponse } from 'next/server'
import { EtaEngine } from '@/lib/api/eta.engine'
import { CacheService } from '@/lib/api/cache.service'
import { ArrivalSchema } from '@/lib/api/validation'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { kigaliStops, calculateDistance } from '@/lib/kigali-gtfs'

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

    const stop = kigaliStops.find(s => s.id === stopId)
    if (!stop) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
    }

    // Process live crowdsourced buses
    const liveBuses = LiveVehicleStore.getVehicles()
    const liveArrivals = liveBuses.map((bus, i) => {
      const dist = calculateDistance(bus.lat, bus.lng, stop.latitude, stop.longitude)
      const rawArrival = EtaEngine.formatArrival(bus.vehicleId, bus.routeId, stopId, dist)
      return ArrivalSchema.parse({
        ...rawArrival,
        id: `arrival-live-${Date.now()}-${i}`,
        routeName: `Route ${bus.routeId.replace('route-', '')}`,
        destination: 'Unknown'
      })
    })

    const mockDistances = [800, 2400, 5600] // meters
    const mockRoutes = ['route-101', 'route-102', 'route-104']

    const staticArrivals = mockDistances.map((dist, i) => {
      const rawArrival = EtaEngine.formatArrival(`dyn-bus-${i}`, mockRoutes[i], stopId, dist)
      // Enhance with additional metadata needed by ArrivalSchema
      return ArrivalSchema.parse({
        ...rawArrival,
        id: `arrival-${Date.now()}-${i}`,
        routeName: `Route ${mockRoutes[i].replace('route-', '')}`,
        destination: i % 2 === 0 ? 'Downtown' : 'Remera'
      })
    })
    
    const arrivals = [...liveArrivals, ...staticArrivals].sort((a, b) => a.etaMin - b.etaMin)

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

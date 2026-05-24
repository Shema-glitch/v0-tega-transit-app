import { NextRequest, NextResponse } from 'next/server'
import { generateBusesForRoutes, kigaliStops, kigaliRoutes, getRoutesForStop } from '@/lib/kigali-gtfs'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const stopId = searchParams.get('stopId')
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')

  // Generate current bus positions
  const buses = generateBusesForRoutes()

  // Filter by stop if provided
  if (stopId) {
    const stop = kigaliStops.find((s) => s.id === stopId)
    if (!stop) {
      return NextResponse.json(
        { error: 'Stop not found' },
        { status: 404 }
      )
    }

    // Get routes that serve this stop
    const routes = getRoutesForStop(stopId)
    const routeIds = routes.map((r) => r.id)

    // Filter buses on those routes
    const relevantBuses = buses.filter((b) => routeIds.includes(b.routeId))

    const arrivals = relevantBuses.map((bus) => {
      const route = kigaliRoutes.find((r) => r.id === bus.routeId)!
      return {
        id: `arrival-${bus.id}-${stopId}`,
        bus,
        stop,
        route,
        eta: bus.eta,
      }
    }).sort((a, b) => a.eta.min - b.eta.min)

    return NextResponse.json({
      arrivals,
      stop,
      routes,
      total: arrivals.length,
    })
  }

  // Return all buses with their arrivals
  const arrivals = buses.map((bus) => {
    const stop = kigaliStops.find((s) => s.id === bus.stopId) || kigaliStops[0]
    const route = kigaliRoutes.find((r) => r.id === bus.routeId)!
    return {
      id: `arrival-${bus.id}`,
      bus,
      stop,
      route,
      eta: bus.eta,
    }
  }).sort((a, b) => a.eta.min - b.eta.min)

  return NextResponse.json({
    arrivals,
    buses,
    total: arrivals.length,
    timestamp: new Date().toISOString(),
  })
}

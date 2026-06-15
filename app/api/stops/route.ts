import { NextRequest, NextResponse } from 'next/server'
import { getNearbyStopsFromLocation, kigaliStops } from '@/lib/kigali-gtfs'
import { GeoQuerySchema } from '@/lib/api/validation'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')

  // If no location provided, return default stops
  if (!lat || !lng) {
    return NextResponse.json({
      stops: kigaliStops.slice(0, 10).map((stop, i) => ({
        ...stop,
        walkingDistance: (i + 1) * 2,
        walkingMeters: (i + 1) * 160,
      })),
      total: kigaliStops.length,
    })
  }

  try {
    // Validate and bound inputs using Zod Schema to prevent DoS via massive radius
    const query = GeoQuerySchema.parse({
      lat: searchParams.get('lat'),
      lng: searchParams.get('lng'),
      radius: searchParams.get('radius') || undefined,
      limit: searchParams.get('limit') || undefined,
    })

    // Get nearby stops
    const nearbyStops = getNearbyStopsFromLocation(kigaliStops, query.lat, query.lng, query.radius, query.limit)

    return NextResponse.json({
      stops: nearbyStops,
      total: nearbyStops.length,
      center: { lat: query.lat, lng: query.lng },
      radius: query.radius,
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid search parameters', details: error },
      { status: 400 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getNearbyStopsFromLocation, kigaliStops } from '@/lib/kigali-gtfs'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const radius = searchParams.get('radius')
  const limit = searchParams.get('limit')

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

  const userLat = parseFloat(lat)
  const userLng = parseFloat(lng)
  const maxRadius = radius ? parseInt(radius) : 2000
  const maxLimit = limit ? parseInt(limit) : 10

  // Validate coordinates
  if (isNaN(userLat) || isNaN(userLng)) {
    return NextResponse.json(
      { error: 'Invalid coordinates' },
      { status: 400 }
    )
  }

  // Get nearby stops
  const nearbyStops = getNearbyStopsFromLocation(userLat, userLng, maxRadius, maxLimit)

  return NextResponse.json({
    stops: nearbyStops,
    total: nearbyStops.length,
    center: { lat: userLat, lng: userLng },
    radius: maxRadius,
  })
}

import { NextResponse } from 'next/server'
import { VehicleSchema } from '@/lib/api/validation'
import { CacheService } from '@/lib/api/cache.service'
import { kigaliRoutes } from '@/lib/kigali-gtfs' // Simulated fallback data

import { truncateGeo } from '@/lib/api/compression'

export async function GET() {
  try {
    const liveVehicles = kigaliRoutes.map((route, i) => {
      return {
        id: `bus-${route.id}-active`,
        routeId: route.id,
        lat: truncateGeo(-1.9536 + (Math.random() - 0.5) * 0.05, 5),
        lng: truncateGeo(30.0605 + (Math.random() - 0.5) * 0.05, 5),
        brg: Math.floor(Math.random() * 360),
        spd: Math.floor(Math.random() * 45) + 15,
        occupancy: i % 3 === 0 ? 'full' : 'standing_room_only',
      }
    })

    // Validate through Zod
    const validated = liveVehicles.map(v => VehicleSchema.parse(v))

    return NextResponse.json(
      { 
        vehicles: validated,
        metadata: {
          timestamp: new Date().toISOString(),
          freshness: 'live',
          source: 'simulation_engine'
        }
      },
      { headers: CacheService.liveHeaders() }
    )
  } catch (error) {
    console.error('Vehicles API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

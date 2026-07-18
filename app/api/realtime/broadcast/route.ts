import { NextRequest, NextResponse } from 'next/server'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { bareRouteId } from '@/lib/api/geo'
import { z } from 'zod'

const PingSchema = z.object({
  vehicle_id: z.string(),
  route_id: z.string(),
  client_id: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed_kmh: z.number().min(0),
  heading: z.number().optional(),
  timestamp: z.string().datetime().optional(),
  // Journey scoping (optional): which way the bus is heading, so waiting
  // riders can be shown only buses coming toward THEM
  direction_id: z.number().int().min(0).max(1).optional(),
  destination_stop_id: z.string().max(64).optional(),
  // Broadcaster-submitted vehicle info
  plate: z.string().max(20).optional(),
  occupancy: z.enum(['empty', 'seats', 'standing', 'packed']).optional(),
  operator: z.string().max(50).optional(),
  driver: z.string().max(50).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = PingSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400 })
    }
    
    const data = parsed.data
    
    // Validate speed (reject impossible speeds > 120 km/h to prevent spoofing)
    if (data.speed_kmh > 120) {
      return NextResponse.json({ error: 'Speed anomaly detected. Ping rejected.' }, { status: 422 })
    }

    LiveVehicleStore.ingest({
      vehicleId: data.vehicle_id,
      routeId: bareRouteId(data.route_id),
      clientId: data.client_id,
      lat: data.latitude,
      lng: data.longitude,
      speedKmh: data.speed_kmh,
      heading: data.heading || 0,
      directionId: data.direction_id,
      destinationStopId: data.destination_stop_id,
      plate: data.plate,
      occupancy: data.occupancy,
      operator: data.operator,
      driver: data.driver,
    })

    return NextResponse.json({ success: true, status: 'Ingested' })
  } catch (error) {
    console.error('Broadcast API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

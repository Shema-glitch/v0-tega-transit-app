import { NextRequest, NextResponse } from 'next/server'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { IncidentSchema } from '@/lib/api/validation'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = IncidentSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400 })
    }
    
    const data = parsed.data

    LiveVehicleStore.reportIncident({
      vehicleId: data.vehicle_id,
      routeId: data.route_id,
      clientId: data.client_id,
      incidentType: data.incident_type,
      lat: data.latitude,
      lng: data.longitude,
      destinationStopId: data.destination_stop_id
    })

    return NextResponse.json({ success: true, status: 'Incident Reported' })
  } catch (error) {
    console.error('Incident API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { IncidentSchema } from '@/lib/api/validation'
import { bareRouteId } from '@/lib/api/geo'

// Types we actively route/display differently. Anything else is still
// accepted and stored — see docs/BACKEND_HANDOFF.md #7.
const KNOWN_TYPES = new Set(['route_changed', 'traffic_delay', 'skip_stop', 'missing_stop'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = IncidentSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400 })
    }

    const data = parsed.data
    const incidentType = data.incident_type ?? data.type ?? 'unknown'

    if (!KNOWN_TYPES.has(incidentType)) {
      console.warn(`[incidents] Unrecognized incident type "${incidentType}" — accepting and logging.`, {
        clientId: data.client_id,
      })
    }

    const id = data.vehicle_id ?? `${data.client_id}-${Date.now()}`

    LiveVehicleStore.reportIncident({
      id,
      vehicle_id: data.vehicle_id,
      route_id: data.route_id ? bareRouteId(data.route_id) : undefined,
      clientId: data.client_id,
      type: incidentType,
      description: data.description,
      lat: data.latitude,
      lon: data.longitude,
      destination_stop_id: data.destination_stop_id
    })

    return NextResponse.json({ success: true, status: 'Incident Reported' })
  } catch (error) {
    console.error('Incident API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

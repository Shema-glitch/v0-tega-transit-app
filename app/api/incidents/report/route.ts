import { NextRequest, NextResponse } from 'next/server'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { publishIncident } from '@/lib/api/live-sync'
import { IncidentSchema } from '@/lib/api/validation'
import { bareRouteId } from '@/lib/api/geo'
import { ErrorLog } from '@/lib/api/error-log'

const PATH = '/api/incidents/report'

// Types we actively route/display differently. Anything else is still
// accepted and stored — see docs/BACKEND_HANDOFF.md #7.
const KNOWN_TYPES = new Set(['route_changed', 'traffic_delay', 'skip_stop', 'missing_stop'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = IncidentSchema.safeParse(body)

    if (!parsed.success) {
      ErrorLog.record({ path: PATH, method: 'POST', status: 400, message: 'Invalid incident payload', details: parsed.error.format() })
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400 })
    }

    const data = parsed.data
    const incidentType = data.incident_type ?? data.type ?? 'unknown'

    if (!KNOWN_TYPES.has(incidentType)) {
      console.warn(`[incidents] Unrecognized incident type "${incidentType}" — accepting and logging.`, {
        clientId: data.client_id,
      })
    }

    // Store key: reporter + type + route. Keying by vehicle_id alone made
    // every anonymous report (vehicle_id "crowd-anonymous") from every user
    // land on the SAME map key, so each new report deleted the previous one
    // system-wide. Same reporter re-reporting the same thing on the same
    // route still updates in place rather than duplicating.
    const routeKey = data.route_id ? bareRouteId(data.route_id) : 'general'
    const id = `${data.vehicle_id ?? data.client_id}-${incidentType}-${routeKey}`

    const incident = {
      id,
      vehicle_id: data.vehicle_id,
      route_id: data.route_id ? bareRouteId(data.route_id) : undefined,
      clientId: data.client_id,
      type: incidentType,
      description: data.description,
      lat: data.latitude,
      lon: data.longitude,
      destination_stop_id: data.destination_stop_id
    }

    // Apply locally always, then share with every other instance's store.
    LiveVehicleStore.reportIncident(incident)
    publishIncident(incident)

    return NextResponse.json({ success: true, status: 'Incident Reported' })
  } catch (error) {
    console.error('Incident API Error:', error)
    ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: error instanceof Error ? error.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

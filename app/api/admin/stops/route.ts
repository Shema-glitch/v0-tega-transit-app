/**
 * POST /api/admin/stops   { name, lat, lon }
 *
 * Creates a new stop directly in Supabase (not part of the imported GTFS
 * feed). Used by the frontend's debug/stop-editing mode so a rider-reported
 * missing stop can be added without waiting on the next GTFS import.
 *
 * stop_id is generated here (prefixed '9' + timestamp) rather than accepted
 * from the client, so a debug-mode-created stop can never collide with a
 * real GTFS numeric id (existing ids observed as 10-digit strings).
 *
 * Requires ADMIN_TOKEN via the x-admin-token header, same as the other
 * /api/admin/* routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServer } from '@/lib/supabase-server'
import { invalidateStopsCache } from '@/lib/api/stops-cache'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops'

const CreateStopSchema = z.object({
  name: z.string().trim().min(1).max(200),
  lat: z.number().finite().gte(-90).lte(90),
  lon: z.number().finite().gte(-180).lte(180),
})

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  return request.headers.get('x-admin-token') === token
}

function generateStopId(): string {
  // '9' prefix keeps this namespace visually distinct from imported GTFS
  // ids in any admin listing/export.
  return `9${Date.now()}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  try {
    const body = await request.json()
    const parsed = CreateStopSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
    }

    const stopId = generateStopId()
    const supabase = getSupabaseServer()
    const { error } = await supabase.from('stops').insert({
      stop_id: stopId,
      stop_name: parsed.data.name,
      stop_lat: parsed.data.lat,
      stop_lon: parsed.data.lon,
    })

    if (error) {
      ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: `Supabase insert failed: ${error.message}` })
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
    }

    invalidateStopsCache()

    return NextResponse.json(
      { id: stopId, name: parsed.data.name, lat: parsed.data.lat, lon: parsed.data.lon, type: 'stop' },
      { status: 201, headers: CORS }
    )
  } catch (err) {
    console.error('[POST /api/admin/stops] Unexpected error:', err)
    ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

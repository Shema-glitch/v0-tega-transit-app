/**
 * POST /api/admin/stops   { name, lat, lon }
 *
 * Creates a new stop directly in Supabase (not part of the imported GTFS
 * feed). Used by the frontend's debug/stop-editing mode so a rider-reported
 * missing stop can be added without waiting on the next GTFS import.
 *
 * The actual insert lives in lib/api/stops-admin.ts — shared with
 * /api/admin/stop-suggestions/[id] (approving an 'add' suggestion does the
 * exact same write, just triggered by a review instead of direct entry).
 *
 * Requires ADMIN_TOKEN via the x-admin-token header, same as the other
 * /api/admin/* routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createStopRow } from '@/lib/api/stops-admin'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops'

const CreateStopSchema = z.object({
  name: z.string().trim().min(1).max(200),
  lat: z.number().finite().gte(-90).lte(90),
  lon: z.number().finite().gte(-180).lte(180),
})

export async function POST(request: NextRequest) {
  if (!checkAdminAuth(request).ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  try {
    const body = await request.json()
    const parsed = CreateStopSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
    }

    const result = await createStopRow(parsed.data.name, parsed.data.lat, parsed.data.lon)
    if (!result.ok) {
      ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: `Supabase insert failed: ${result.error}` })
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
    }

    return NextResponse.json(
      { id: result.id, name: parsed.data.name, lat: parsed.data.lat, lon: parsed.data.lon, type: 'stop' },
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

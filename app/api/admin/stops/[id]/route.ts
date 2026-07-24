/**
 * PATCH  /api/admin/stops/[id]   { name?, lat?, lon? }
 * DELETE /api/admin/stops/[id]
 *
 * Rename/move or remove a single stop. Same debug/stop-editing use case as
 * POST /api/admin/stops: a stop whose name changed on the ground, or one
 * that was decommissioned, shouldn't have to wait on a full GTFS re-import.
 *
 * Requires ADMIN_TOKEN via the x-admin-token header.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServer } from '@/lib/supabase-server'
import { invalidateStopsCache } from '@/lib/api/stops-cache'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops/[id]'

const UpdateStopSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    lat: z.number().finite().gte(-90).lte(90).optional(),
    lon: z.number().finite().gte(-180).lte(180).optional(),
  })
  .refine((v) => v.name !== undefined || v.lat !== undefined || v.lon !== undefined, {
    message: 'At least one of name, lat, lon is required',
  })

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  return request.headers.get('x-admin-token') === token
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const { id } = await params

  try {
    const body = await request.json()
    const parsed = UpdateStopSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
    }

    const patch: Record<string, string | number> = {}
    if (parsed.data.name !== undefined) patch.stop_name = parsed.data.name
    if (parsed.data.lat !== undefined) patch.stop_lat = parsed.data.lat
    if (parsed.data.lon !== undefined) patch.stop_lon = parsed.data.lon

    const supabase = getSupabaseServer()
    const { data, error } = await supabase.from('stops').update(patch).eq('stop_id', id).select('stop_id')

    if (error) {
      ErrorLog.record({ path: PATH, method: 'PATCH', status: 500, message: `Supabase update failed: ${error.message}` })
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404, headers: CORS })
    }

    invalidateStopsCache()

    return NextResponse.json({ success: true }, { headers: CORS })
  } catch (err) {
    console.error('[PATCH /api/admin/stops/[id]] Unexpected error:', err)
    ErrorLog.record({ path: PATH, method: 'PATCH', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const { id } = await params

  try {
    const supabase = getSupabaseServer()
    const { data, error } = await supabase.from('stops').delete().eq('stop_id', id).select('stop_id')

    if (error) {
      ErrorLog.record({ path: PATH, method: 'DELETE', status: 500, message: `Supabase delete failed: ${error.message}` })
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404, headers: CORS })
    }

    invalidateStopsCache()

    return NextResponse.json({ success: true }, { headers: CORS })
  } catch (err) {
    console.error('[DELETE /api/admin/stops/[id]] Unexpected error:', err)
    ErrorLog.record({ path: PATH, method: 'DELETE', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

/**
 * GET  /api/admin/stops   (?include=merged — defaults to active + hidden)
 * POST /api/admin/stops   { name, lat, lon }
 *
 * GET is the curator map read: every stop with its soft-state (status,
 * merged_into_id, is_hub, editor). Curators and admins both see it; pass
 * ?include=merged to include victims of merges (dimmed in the UI).
 *
 * POST creates a new stop directly in Supabase (not part of the imported GTFS
 * feed). Used by the frontend's debug/stop-editing mode so a rider-reported
 * missing stop can be added without waiting on the next GTFS import.
 *
 * The actual insert lives in lib/api/stops-admin.ts — shared with
 * /api/admin/stop-suggestions/[id] (approving an 'add' suggestion does the
 * exact same write, just triggered by a review instead of direct entry).
 *
 * Requires an admin session (curator+ for GET/POST), same as the other
 * /api/admin/* routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createStopRow } from '@/lib/api/stops-admin'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { requireTotpForAction } from '@/lib/api/admin-totp'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops'

interface AdminStopRow {
  stop_id: string
  stop_name: string | null
  stop_lat: number | null
  stop_lon: number | null
  status: string | null
  merged_into_id: string | null
  is_hub: boolean | null
  edited_by: string | null
  edited_at: string | null
}

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'curator')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }

  const includeMerged = request.nextUrl.searchParams.get('include') === 'merged'
  try {
    const supabase = getSupabaseAdmin()
    let query = supabase
      .from('stops')
      .select('stop_id, stop_name, stop_lat, stop_lon, status, merged_into_id, is_hub, edited_by, edited_at')
      .order('stop_name', { ascending: true })
    if (!includeMerged) query = query.neq('status', 'merged')
    const { data, error } = await query
    if (error) throw error

    const stops = ((data ?? []) as AdminStopRow[]).map((s) => ({
      id: s.stop_id,
      name: s.stop_name ?? '',
      lat: s.stop_lat,
      lon: s.stop_lon,
      status: s.status ?? 'active',
      mergedIntoId: s.merged_into_id,
      isHub: !!s.is_hub,
      editedBy: s.edited_by,
      editedAt: s.edited_at ? new Date(s.edited_at).getTime() : null,
    }))
    return NextResponse.json({ stops }, { headers: CORS })
  } catch (err) {
    ErrorLog.record({ path: PATH, method: 'GET', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

const CreateStopSchema = z.object({
  name: z.string().trim().min(1).max(200),
  lat: z.number().finite().gte(-90).lte(90),
  lon: z.number().finite().gte(-180).lte(180),
})

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'curator')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  if (!(await requireTotpForAction(request, auth.email)).ok) {
    return NextResponse.json(
      { error: 'totp-required', message: 'Enter your authenticator code to continue.' },
      { status: 403, headers: CORS }
    )
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

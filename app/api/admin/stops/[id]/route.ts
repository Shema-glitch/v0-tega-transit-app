/**
 * PATCH  /api/admin/stops/[id]   { name?, lat?, lon?, isHub? }
 * DELETE /api/admin/stops/[id]
 *
 * Rename/move/toggle-hub or hard-remove a single stop. Same debug/stop-editing
 * use case as POST /api/admin/stops: a stop whose name changed on the ground,
 * or one that was decommissioned, shouldn't have to wait on a full GTFS
 * re-import.
 *
 * The actual writes live in lib/api/stops-admin.ts — shared with
 * /api/admin/stop-suggestions/[id] (approving a rename/delete suggestion
 * does the exact same write, just triggered by a review instead of direct
 * entry).
 *
 * Roles (CURATOR_GOVERNANCE.md): rename/move/hub is curator+; hard delete is
 * admin-only (curators hide/merge instead of hard-deleting).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateStopRowFull, deleteStopRow } from '@/lib/api/stops-admin'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { requireTotpForAction } from '@/lib/api/admin-totp'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops/[id]'

const UpdateStopSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    lat: z.number().finite().gte(-90).lte(90).optional(),
    lon: z.number().finite().gte(-180).lte(180).optional(),
    isHub: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.lat !== undefined || v.lon !== undefined || v.isHub !== undefined,
    { message: 'At least one of name, lat, lon, isHub is required' }
  )

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params

  try {
    const body = await request.json()
    const parsed = UpdateStopSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
    }

    const result = await updateStopRowFull(id, auth.email, {
      name: parsed.data.name,
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      isHub: parsed.data.isHub,
    })
    if (!result.ok) {
      if (result.notFound) return NextResponse.json({ error: 'Stop not found' }, { status: 404, headers: CORS })
      ErrorLog.record({ path: PATH, method: 'PATCH', status: 500, message: `Supabase update failed: ${result.error}` })
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
    }

    return NextResponse.json({ success: true }, { headers: CORS })
  } catch (err) {
    console.error('[PATCH /api/admin/stops/[id]] Unexpected error:', err)
    ErrorLog.record({ path: PATH, method: 'PATCH', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  // Hard delete is admin-only — curators hide/merge instead (no bulk delete).
  if (!(await requireRole(request, auth.email, 'admin')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  if (!(await requireTotpForAction(request, auth.email)).ok) {
    return NextResponse.json(
      { error: 'totp-required', message: 'Enter your authenticator code to continue.' },
      { status: 403, headers: CORS }
    )
  }

  const { id } = await params

  try {
    const result = await deleteStopRow(id)
    if (!result.ok) {
      if (result.notFound) return NextResponse.json({ error: 'Stop not found' }, { status: 404, headers: CORS })
      ErrorLog.record({ path: PATH, method: 'DELETE', status: 500, message: `Supabase delete failed: ${result.error}` })
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
    }

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

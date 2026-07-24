/**
 * PATCH /api/admin/stop-suggestions/[id]   { decision: 'approve' | 'reject' }
 *
 * Reviews one pending suggestion. Reject just marks it resolved. Approve
 * replays the exact same write the direct admin/stops endpoints use
 * (lib/api/stops-admin.ts) — 'add' creates a stop, 'rename' updates one,
 * 'delete' removes one — then marks the suggestion resolved. If the
 * underlying write fails (e.g. the target stop was already deleted by
 * someone else), the suggestion is left pending so it isn't silently lost.
 *
 * Requires ADMIN_TOKEN via the x-admin-token header.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StopSuggestions } from '@/lib/api/stop-suggestions'
import { createStopRow, updateStopRow, deleteStopRow } from '@/lib/api/stops-admin'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stop-suggestions/[id]'

const DecisionSchema = z.object({ decision: z.enum(['approve', 'reject']) })

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
  const numId = Number(id)
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400, headers: CORS })
  }

  try {
    const body = await request.json()
    const parsed = DecisionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
    }

    const suggestion = await StopSuggestions.getOne(numId)
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found or already resolved' }, { status: 404, headers: CORS })
    }

    if (parsed.data.decision === 'reject') {
      await StopSuggestions.resolve(numId, 'rejected')
      return NextResponse.json({ success: true }, { headers: CORS })
    }

    // Approve — apply the underlying stops-table write first. If it fails,
    // leave the suggestion pending rather than marking it resolved on a
    // write that didn't actually happen.
    let result
    if (suggestion.type === 'add') {
      if (!suggestion.proposed_name || suggestion.proposed_lat == null || suggestion.proposed_lon == null) {
        return NextResponse.json({ error: 'Suggestion is missing name/lat/lon' }, { status: 400, headers: CORS })
      }
      result = await createStopRow(suggestion.proposed_name, suggestion.proposed_lat, suggestion.proposed_lon)
    } else if (suggestion.type === 'rename') {
      if (!suggestion.stop_id || !suggestion.proposed_name) {
        return NextResponse.json({ error: 'Suggestion is missing stop_id/proposed_name' }, { status: 400, headers: CORS })
      }
      result = await updateStopRow(suggestion.stop_id, { name: suggestion.proposed_name })
    } else {
      if (!suggestion.stop_id) {
        return NextResponse.json({ error: 'Suggestion is missing stop_id' }, { status: 400, headers: CORS })
      }
      result = await deleteStopRow(suggestion.stop_id)
    }

    if (!result.ok) {
      ErrorLog.record({ path: PATH, method: 'PATCH', status: 500, message: `Approve write failed: ${result.error}` })
      return NextResponse.json({ error: result.notFound ? 'Target stop not found' : 'Internal Server Error' }, { status: result.notFound ? 404 : 500, headers: CORS })
    }

    await StopSuggestions.resolve(numId, 'approved')
    return NextResponse.json({ success: true }, { headers: CORS })
  } catch (err) {
    console.error('[PATCH /api/admin/stop-suggestions/[id]] Unexpected error:', err)
    ErrorLog.record({ path: PATH, method: 'PATCH', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

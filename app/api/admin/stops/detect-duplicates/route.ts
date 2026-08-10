/**
 * POST /api/admin/stops/detect-duplicates   { radiusM? }
 *
 * Server-side port of the rider app's findDuplicateClusters (union-find over
 * haversine distance, default 60 m) over the full stops table, with
 * stop_times counts per stop. Feeds the "Suggested merges" pane — candidate
 * clusters the curator can promote straight into merge mode. Curator+.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { detectDuplicateClusters } from '@/lib/api/stops-curator'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops/detect-duplicates'

const DetectSchema = z.object({
  radiusM: z.number().int().gte(10).lte(500).optional(),
})

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'curator')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }

  const body = await request.json().catch(() => null)
  const parsed = DetectSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
  }

  try {
    const result = await detectDuplicateClusters(parsed.data.radiusM ?? 60)
    return NextResponse.json(result, { headers: CORS })
  } catch (err) {
    ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

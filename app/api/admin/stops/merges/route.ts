/**
 * GET /api/admin/stops/merges
 *
 * Recent merge journal entries with their victims — feeds the "Recent merges"
 * list in the console (undo targets + the curator audit trail). Curator+.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { listRecentMerges } from '@/lib/api/stops-curator'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'curator')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '25')
  const merges = await listRecentMerges(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25)
  return NextResponse.json({ merges }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

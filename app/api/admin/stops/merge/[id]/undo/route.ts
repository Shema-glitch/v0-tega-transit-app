/**
 * POST /api/admin/stops/merge/[id]/undo
 *
 * Restores a merge from its before-snapshot: stop_times references and
 * retargeted pending suggestions go back to the victims, victims return to
 * active, and the journal row is dropped (undo is one-shot — after it, the
 * merge is gone). Curator+; TOTP-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { requireTotpForAction } from '@/lib/api/admin-totp'
import { undoMerge } from '@/lib/api/stops-curator'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops/merge/[id]/undo'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const result = await undoMerge(id, auth.email)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422, headers: CORS })
    }
    return NextResponse.json(result, { headers: CORS })
  } catch (err) {
    ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

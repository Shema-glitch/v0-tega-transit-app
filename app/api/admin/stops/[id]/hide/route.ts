/**
 * POST /api/admin/stops/[id]/hide
 *
 * Admin-only soft-hide — the "nuclear" option per CURATOR_GOVERNANCE.md:
 * curators merge (constructive), admins hide (decommissioned). Hidden stops
 * disappear from public reads but are never deleted; restore brings them back.
 * TOTP-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { requireTotpForAction } from '@/lib/api/admin-totp'
import { hideStop } from '@/lib/api/stops-curator'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops/[id]/hide'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
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
    const result = await hideStop(id, auth.email)
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

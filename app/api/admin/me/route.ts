/**
 * GET /api/admin/me  → { email, role }
 *
 * Who am I + current role, re-read from the DB on every call so a revoke is
 * immediate. The dashboard fetches this on load and on each refresh to gate
 * the sidebar (curators never see People / Endpoints / Load / Guide).
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { getAdminRole } from '@/lib/api/curators'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  const role = await getAdminRole(auth.email)
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  return NextResponse.json({ email: auth.email, role }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

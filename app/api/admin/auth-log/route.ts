/**
 * GET /api/admin/auth-log
 *
 * Recent auth events (magic-link requests, code verifications, logins).
 * Reads the durable Supabase audit table first (survives restarts); falls
 * back to the in-memory ring when Supabase is unreachable. Requires admin
 * auth (session cookie or token).
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { AuthLog } from '@/lib/api/auth-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  // Curators see only their own actions — admins see everyone's.
  if (!(await requireRole(request, auth.email, 'admin')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  const persisted = await AuthLog.getPersisted(100)
  return NextResponse.json(
    { events: persisted ?? AuthLog.getRecent(), source: persisted ? 'supabase' : 'memory' },
    { headers: CORS }
  )
}

export async function OPTIONS() {
  return corsPreflight()
}

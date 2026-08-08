/**
 * GET /api/admin/auth-log
 *
 * Recent auth events (magic-link requests, code verifications, logins) from
 * the in-memory audit ring. Requires admin auth (session cookie or token).
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { AuthLog } from '@/lib/api/auth-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  return NextResponse.json({ events: AuthLog.getRecent() }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

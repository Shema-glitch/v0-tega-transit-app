/**
 * GET /api/auth/session
 *
 * Reports whether the caller holds a valid `admin_session` cookie. Used by
 * the admin dashboard on boot to decide whether to render or send the user
 * to /goToAdminAuth. Deliberately public (it only reveals your own state).
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  return NextResponse.json(
    { authenticated: auth.ok, email: auth.ok ? auth.email : null },
    { headers: CORS }
  )
}

export async function OPTIONS() {
  return corsPreflight()
}

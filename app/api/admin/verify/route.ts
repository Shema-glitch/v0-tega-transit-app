/**
 * GET /api/admin/verify
 *
 * Purely validates an admin token — used by the /admin login screen so a
 * wrong token is caught immediately, instead of only surfacing when some
 * later action (like clearing errors) happens to fail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-admin-token')
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ ok: false }, { status: 401, headers: CORS })
  }
  return NextResponse.json({ ok: true }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

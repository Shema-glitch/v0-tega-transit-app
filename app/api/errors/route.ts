/**
 * GET /api/errors  — recent endpoint failures (in-memory ledger)
 * DELETE /api/errors — clear the ledger (admin-token protected)
 *
 * Feeds the status dashboard's "Recent errors" panel so a maintainer can see
 * what's failing without tailing Render logs. See lib/api/error-log.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { ErrorLog } from '@/lib/api/error-log'
import { CacheService } from '@/lib/api/cache.service'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET() {
  const errors = ErrorLog.getAll()
  return NextResponse.json(
    { errors, total: errors.length },
    { headers: { ...CORS, ...(CacheService.noCacheHeaders() as Record<string, string>) } }
  )
}

export async function DELETE(request: NextRequest) {
  const token = request.headers.get('x-admin-token')
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  ErrorLog.clear()
  return NextResponse.json({ success: true, cleared: true }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

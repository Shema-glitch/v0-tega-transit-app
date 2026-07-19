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
  // Prefer the durable store (survives redeploys); fall back to the in-memory
  // ledger when Supabase is unreachable or the table hasn't been created yet.
  const persisted = await ErrorLog.getPersisted()
  const errors = persisted ?? ErrorLog.getAll()
  const source = persisted ? 'supabase' : 'memory'
  return NextResponse.json(
    { errors, total: errors.length, source },
    { headers: { ...CORS, ...(CacheService.noCacheHeaders() as Record<string, string>) } }
  )
}

export async function DELETE(request: NextRequest) {
  const token = request.headers.get('x-admin-token')
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  ErrorLog.clear()
  await ErrorLog.clearPersisted()
  return NextResponse.json({ success: true, cleared: true }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

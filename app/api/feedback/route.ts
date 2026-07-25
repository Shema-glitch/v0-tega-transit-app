/**
 * GET /api/feedback     — recent rider bug reports (admin-token protected)
 * DELETE /api/feedback  — clear all reports (admin-token protected)
 * PATCH /api/feedback   — mark one report resolved, { id } (admin-token protected)
 *
 * Unlike /api/errors (open GET — technical failures aren't sensitive), these
 * require ADMIN_TOKEN to read: reports can carry incidental PII (page URL,
 * user agent), and only you should see what riders submit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { BugReports } from '@/lib/api/bug-reports'
import { CacheService } from '@/lib/api/cache.service'
import { CORS, corsPreflight } from '@/lib/api/cors'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  return request.headers.get('x-admin-token') === token
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const persisted = await BugReports.getPersisted()
  const reports = persisted ?? BugReports.getAll()
  const source = persisted ? 'supabase' : 'memory'
  return NextResponse.json(
    { reports, total: reports.length, source },
    { headers: { ...CORS, ...(CacheService.noCacheHeaders() as Record<string, string>) } }
  )
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  BugReports.clear()
  await BugReports.clearPersisted()
  return NextResponse.json({ success: true, cleared: true }, { headers: CORS })
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const body = await request.json().catch(() => null)
  const id = body?.id
  if (!id || (typeof id !== 'string' && typeof id !== 'number')) {
    return NextResponse.json({ error: 'id is required' }, { status: 400, headers: CORS })
  }

  try {
    const supabase = getSupabaseAdmin()
    await supabase.rpc('resolve_bug_report', { p_id: Number(id) })
    return NextResponse.json({ success: true }, { headers: CORS })
  } catch (error) {
    return NextResponse.json(
      { error: 'Could not resolve report', details: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: CORS }
    )
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

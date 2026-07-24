/**
 * GET /api/admin/stop-suggestions
 *
 * Pending queue of rider-submitted stop corrections, newest-oldest excluded
 * (oldest first — same "clear the backlog in order" convention as most
 * moderation queues). Requires ADMIN_TOKEN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { StopSuggestions } from '@/lib/api/stop-suggestions'
import { CORS, corsPreflight } from '@/lib/api/cors'

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
  try {
    const suggestions = await StopSuggestions.getPending()
    return NextResponse.json({ suggestions }, { headers: CORS })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

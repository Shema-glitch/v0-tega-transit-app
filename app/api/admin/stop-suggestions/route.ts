/**
 * GET /api/admin/stop-suggestions
 *
 * Pending queue of rider-submitted stop corrections, newest-oldest excluded
 * (oldest first — same "clear the backlog in order" convention as most
 * moderation queues). Requires ADMIN_TOKEN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { StopSuggestions } from '@/lib/api/stop-suggestions'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request).ok) {
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

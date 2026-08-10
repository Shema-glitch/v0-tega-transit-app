/**
 * POST /api/admin/stops/merge   { survivorId, victimIds[], reason?, dryRun? }
 *
 * Merges victim stops into a survivor (one transactional RPC — see
 * lib/api/stops-curator.ts and migration 0014). dryRun returns the exact
 * affected counts without writing — the UI's preview-before-commit step.
 *
 * Curator+; TOTP-gated when the actor has a second factor (merging reshapes
 * the map, which is exactly what a hijacked session shouldn't be able to do).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkAdminAuth } from '@/lib/api/admin-auth'
import { requireRole } from '@/lib/api/curators'
import { requireTotpForAction } from '@/lib/api/admin-totp'
import { mergeStops } from '@/lib/api/stops-curator'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/admin/stops/merge'

const MergeSchema = z.object({
  survivorId: z.string().trim().min(1),
  victimIds: z.array(z.string().trim().min(1)).min(1).max(50),
  reason: z.string().trim().max(300).optional(),
  dryRun: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  if (!(await requireRole(request, auth.email, 'curator')).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }

  const body = await request.json().catch(() => null)
  const parsed = MergeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
  }
  const { survivorId, victimIds, reason, dryRun } = parsed.data

  if (!dryRun) {
    if (!(await requireTotpForAction(request, auth.email)).ok) {
      return NextResponse.json(
        { error: 'totp-required', message: 'Enter your authenticator code to continue.' },
        { status: 403, headers: CORS }
      )
    }
  }

  try {
    const result = await mergeStops(survivorId, victimIds, auth.email, reason, !!dryRun)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Merge failed' }, { status: 422, headers: CORS })
    }
    return NextResponse.json(result, { headers: CORS })
  } catch (err) {
    ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

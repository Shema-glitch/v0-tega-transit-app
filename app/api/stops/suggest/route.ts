/**
 * POST /api/stops/suggest   { type, stopId?, proposedName?, proposedLat?, proposedLon?, reason?, clientId? }
 *
 * Public — no admin token. Any rider can suggest a stop correction:
 *   type 'rename' — stopId + proposedName (e.g. "wrong name")
 *   type 'delete' — stopId (e.g. "this stop doesn't exist")
 *   type 'add'    — proposedName + proposedLat + proposedLon (a missing stop)
 *
 * Nothing here touches the live `stops` table — it only inserts a pending
 * row. An admin reviews the queue (GET/PATCH /api/admin/stop-suggestions)
 * before anything actually changes for other riders. See
 * supabase/migrations/0005_stop_suggestions.sql for the moderation model.
 *
 * Rate-limited as a write endpoint (middleware.ts WRITE_PREFIXES) — the
 * queue itself is the abuse defense (a flood of junk is just something you
 * clear, never a corrupted map), but the rate limit still keeps one device
 * from spamming the queue full.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StopSuggestions } from '@/lib/api/stop-suggestions'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'
import { withRequestMetrics } from '@/lib/api/request-metrics'

export const dynamic = 'force-dynamic'

const PATH = '/api/stops/suggest'

const SuggestionSchema = z
  .object({
    type: z.enum(['add', 'rename', 'delete']),
    stopId: z.string().trim().min(1).max(100).optional(),
    proposedName: z.string().trim().min(1).max(200).optional(),
    proposedLat: z.number().finite().gte(-90).lte(90).optional(),
    proposedLon: z.number().finite().gte(-180).lte(180).optional(),
    reason: z.string().trim().max(500).optional(),
    clientId: z.string().trim().max(100).optional(),
  })
  .refine((v) => v.type !== 'rename' || (v.stopId && v.proposedName), {
    message: 'rename requires stopId and proposedName',
  })
  .refine((v) => v.type !== 'delete' || !!v.stopId, {
    message: 'delete requires stopId',
  })
  .refine((v) => v.type !== 'add' || (v.proposedName && v.proposedLat !== undefined && v.proposedLon !== undefined), {
    message: 'add requires proposedName, proposedLat, proposedLon',
  })

export async function POST(request: NextRequest) {
  return withRequestMetrics('stops.suggest', () => handlePost(request))
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = SuggestionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
    }

    await StopSuggestions.submit({
      type: parsed.data.type,
      stopId: parsed.data.stopId,
      proposedName: parsed.data.proposedName,
      proposedLat: parsed.data.proposedLat,
      proposedLon: parsed.data.proposedLon,
      reason: parsed.data.reason,
      clientId: parsed.data.clientId,
    })

    return NextResponse.json({ success: true }, { status: 201, headers: CORS })
  } catch (err) {
    console.error('[POST /api/stops/suggest] Unexpected error:', err)
    ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

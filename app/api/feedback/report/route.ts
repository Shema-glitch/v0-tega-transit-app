/**
 * POST /api/feedback/report
 *
 * Public endpoint for the frontend's landing-page "report a bug" form.
 * Replaces a mailto: link (which only works if the visitor has a mail
 * client configured, and gives you zero visibility until they hit send) —
 * reports land here durably and show up in the dashboard's "Bug reports"
 * panel immediately, regardless of the reporter's device.
 *
 * No auth required to submit (anyone reporting a bug shouldn't need a
 * token); reading them back (GET /api/feedback) requires ADMIN_TOKEN since
 * reports may contain incidental PII (page URL, user agent).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { BugReports } from '@/lib/api/bug-reports'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PATH = '/api/feedback/report'

const BugReportSchema = z.object({
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  pageUrl: z.string().max(500).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = BugReportSchema.safeParse(body)

    if (!parsed.success) {
      ErrorLog.record({ path: PATH, method: 'POST', status: 400, message: 'Invalid bug report payload', details: parsed.error.format() })
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400, headers: CORS })
    }

    BugReports.record({
      subject: parsed.data.subject,
      message: parsed.data.message,
      pageUrl: parsed.data.pageUrl,
      userAgent: request.headers.get('user-agent') ?? undefined,
    })

    return NextResponse.json({ success: true }, { headers: CORS })
  } catch (error) {
    console.error('Bug report API error:', error)
    ErrorLog.record({ path: PATH, method: 'POST', status: 500, message: error instanceof Error ? error.message : 'Unknown error' })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS })
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

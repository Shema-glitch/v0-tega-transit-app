/**
 * /api/admin/admins — manage who may sign in to the dashboard.
 *
 *   GET    → { admins: [{ email, source, invitedBy?, createdAt? }], dbOk }
 *   POST   { email }            → invite an address (idempotent upsert)
 *   DELETE ?email=…             → revoke an address
 *
 * Backed by the admin_emails Supabase table (see lib/api/admin-emails.ts).
 * Everything here is admin-gated twice: middleware returns 401 for
 * /api/admin/* without a valid session/token, and each handler re-checks.
 * Env-seeded (ADMIN_EMAILS) addresses can be listed but never invited-as-new
 * or revoked from here — they're managed at deploy time by design.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth, isAllowlistedAdmin } from '@/lib/api/admin-auth'
import { inviteAdminEmail, listAdminEmails, revokeAdminEmail } from '@/lib/api/admin-emails'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request).ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  const result = await listAdminEmails()
  return NextResponse.json(result, { headers: CORS })
}

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400, headers: CORS })
  }

  if (isAllowlistedAdmin(email)) {
    return NextResponse.json(
      { error: `${email} is already an admin via ADMIN_EMAILS — manage it in the deploy env.` },
      { status: 409, headers: CORS }
    )
  }

  const result = await inviteAdminEmail(email, auth.email)
  if (!result.ok) {
    return NextResponse.json(
      { error: `Could not invite ${email}: ${result.error}` },
      { status: 502, headers: CORS }
    )
  }
  return NextResponse.json({ ok: true, email }, { headers: CORS })
}

export async function DELETE(request: NextRequest) {
  if (!checkAdminAuth(request).ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }

  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400, headers: CORS })
  }

  if (isAllowlistedAdmin(email)) {
    return NextResponse.json(
      { error: `${email} is seeded via ADMIN_EMAILS and can't be revoked here — remove it from the deploy env instead.` },
      { status: 409, headers: CORS }
    )
  }

  const result = await revokeAdminEmail(email)
  if (!result.ok) {
    return NextResponse.json(
      { error: `Could not revoke ${email}: ${result.error}` },
      { status: 502, headers: CORS }
    )
  }
  if (result.notFound) {
    return NextResponse.json({ error: `${email} is not in the admin list` }, { status: 404, headers: CORS })
  }
  return NextResponse.json({ ok: true, email }, { headers: CORS })
}

export async function OPTIONS() {
  return corsPreflight()
}

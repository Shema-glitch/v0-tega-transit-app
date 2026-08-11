/**
 * /api/admin/settings/profile — the signed-in admin's own profile.
 *
 *   GET   → { email, role, displayName, createdAt }
 *   PATCH { displayName } → saves it (scoped to the caller's own row)
 *
 * Admin-gated the same way as every other settings route (middleware 401 +
 * in-handler check), and the write lands in the audit log. The role comes
 * from getAdminRole so a demoted curator still sees their current role here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkAdminAuth, sessionCookieHeader } from '@/lib/api/admin-auth'
import { getAdminRole } from '@/lib/api/curators'
import { getAdminProfile, updateAdminDisplayName } from '@/lib/api/admin-profile'
import { AuthLog } from '@/lib/api/auth-log'
import { clientIp } from '@/lib/api/client-ip'
import { CORS, corsPreflight } from '@/lib/api/cors'

export const dynamic = 'force-dynamic'

const PatchSchema = z.object({
  displayName: z.string().max(48),
})

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  const role = await getAdminRole(auth.email)
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }
  const profile = await getAdminProfile(auth.email)
  return NextResponse.json(
    {
      email: auth.email,
      role,
      displayName: profile?.displayName ?? null,
      createdAt: profile?.createdAt ?? null,
    },
    { headers: CORS }
  )
}

export async function PATCH(request: NextRequest) {
  const auth = checkAdminAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
  }
  const ip = clientIp(request.headers)

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: CORS })
  }
  const result = await updateAdminDisplayName(auth.email, parsed.data.displayName)
  AuthLog.record({ action: 'profile-update', email: auth.email, ip, ok: result.ok })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400, headers: CORS })
  }
  // Echo the saved profile back so the sidebar can update without a refetch,
  // and re-set the session cookie so the sidebar identity stays in sync.
  const profile = await getAdminProfile(auth.email)
  const setCookie = sessionCookieHeader(auth.email)
  return NextResponse.json(
    { ok: true, displayName: profile?.displayName ?? null },
    { headers: { ...CORS, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } }
  )
}

export async function OPTIONS() {
  return corsPreflight()
}

/**
 * GET /api/auth/callback?token_hash=…&type=…   (or ?code=… for PKCE)
 *
 * The "magic link" path of the admin login: when the admin clicks the link in
 * the emailed code, Supabase redirects the browser here. We exchange the
 * verification token server-side, check the email against ADMIN_EMAILS, and
 * set the same HttpOnly `admin_session` cookie the 6-digit code flow uses —
 * so both paths (type the code, or click the link) land on /admin.
 *
 * This endpoint must be listed in Supabase → Authentication → URL Configuration
 * → Redirect URLs (e.g. https://tega-transit-api.onrender.com/api/auth/callback).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { isAllowlistedAdmin, sessionCookieHeader } from '@/lib/api/admin-auth'
import { AuthLog } from '@/lib/api/auth-log'
import { clientIp } from '@/lib/api/client-ip'

export const dynamic = 'force-dynamic'

const LOGIN_URL = '/goToAdminAuth'

function redirectToLogin(url: URL, error: string) {
  url.pathname = LOGIN_URL
  url.search = ''
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

/** Exchanges the verification token for a user email, or null if the link is malformed. */
async function exchangeToken(url: URL): Promise<string | null> {
  const supabase = getSupabaseServer()
  const token_hash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const code = url.searchParams.get('code')
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type })
    if (error) throw error
    return data.user?.email ?? null
  }
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error
    return data.user?.email ?? null
  }
  return null
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const errorDesc = url.searchParams.get('error_description')
  const ip = clientIp(request.headers)

  if (errorDesc) {
    AuthLog.record({ action: 'magic-link-callback', email: null, ip, ok: false, detail: errorDesc })
    return redirectToLogin(url, 'That magic link was rejected or has expired. Request a new code.')
  }

  try {
    const email = await exchangeToken(url)
    if (!email) {
      AuthLog.record({ action: 'magic-link-callback', email: null, ip, ok: false, detail: 'incomplete link' })
      return redirectToLogin(url, 'That magic link is incomplete. Request a new code.')
    }
    if (!isAllowlistedAdmin(email)) {
      AuthLog.record({ action: 'magic-link-callback', email, ip, ok: false, detail: 'email not allowlisted' })
      return redirectToLogin(url, 'That account is not an admin. Request a code from an admin address.')
    }
    const cookie = sessionCookieHeader(email)
    if (!cookie) {
      AuthLog.record({ action: 'magic-link-callback', email, ip, ok: false, detail: 'no session secret configured' })
      return redirectToLogin(url, 'Auth is not configured on the server yet.')
    }
    AuthLog.record({ action: 'magic-link-login', email, ip, ok: true })
    const res = NextResponse.redirect(new URL('/admin', url))
    res.headers.set('Set-Cookie', cookie)
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    AuthLog.record({ action: 'magic-link-callback', email: null, ip, ok: false, detail: message })
    return redirectToLogin(url, 'That magic link could not be verified. Request a new code.')
  }
}

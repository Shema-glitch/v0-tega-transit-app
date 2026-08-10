/**
 * Runs in front of every /api/* request (and the /admin pages). Five jobs:
 *
 * 1. CORS allowlisting — reflects Access-Control-Allow-Origin only for the
 *    deployed frontend (FRONTEND_ORIGIN) and its Vercel preview deploys
 *    (*.vercel.app), instead of the old wildcard '*'. This stops OTHER
 *    websites' browser JS from reading responses cross-origin. It does NOT
 *    stop non-browser callers (curl, scripts, server-to-server) — CORS is a
 *    browser-enforced mechanism, not an auth mechanism. That's what the rate
 *    limiter and the per-endpoint auth checks are for.
 *
 * 2. Admin auth gate — /api/admin/* and /api/errors require a valid
 *    `admin_session` cookie (or the constant-time-checked legacy
 *    x-admin-token). Unauthenticated /admin pages get redirected to
 *    /goToAdminAuth, the login page. /admin/debug is exempt from the page
 *    redirect — that route validates its own credential.
 *
 * 3. Per-IP rate limiting — a fixed-window counter (lib/api/rate-limiter.ts)
 *    that caps how many requests one IP can make to one route group per
 *    minute. This is the actual defense against a script hammering the API
 *    or someone firing 10,000 requests at one endpoint. It will NOT stop a
 *    real distributed (multi-IP) DDoS — that needs a CDN/WAF (e.g.
 *    Cloudflare) in front of Render, not application code. The auth
 *    endpoints additionally have their own lockout + circuit breaker
 *    (lib/api/auth-guard.ts).
 *
 * 4. Maintenance enforcement — the admin dashboard (/admin) can flip an
 *    endpoint off (lib/api/endpoint-registry.ts + MaintenanceStore). This is
 *    what actually makes that real: a disabled endpoint gets a 503 here,
 *    before the route handler ever runs. See docs/ADMIN_DASHBOARD_PRD.md §4.
 *    Flags are durable (Supabase) and hydrated before any request is judged,
 *    so a restart never silently re-enables a disabled endpoint.
 *
 * Runs on the Node.js runtime (not edge) so it shares the same in-memory
 * globalThis singleton the route handlers use for everything else.
 */

import { NextRequest, NextResponse } from 'next/server'
import { RateLimiterStore } from '@/lib/api/rate-limiter'
import { ErrorLog } from '@/lib/api/error-log'
import { publicBaseUrl } from '@/lib/api/public-url'
import { RequestMetrics } from '@/lib/api/request-metrics'
import { findEndpoint } from '@/lib/api/endpoint-registry'
import { MaintenanceStore } from '@/lib/api/maintenance-store'
import { checkAdminAuth, maybeRefreshSessionCookie } from '@/lib/api/admin-auth'
import { clientIp } from '@/lib/api/client-ip'

export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
  runtime: 'nodejs',
}

const DEFAULT_FRONTEND_ORIGIN = 'https://busgo-track.vercel.app'
const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false
  const configured = process.env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN
  return origin === configured || VERCEL_PREVIEW_RE.test(origin)
}

const CORS_METHODS = 'GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE'
const CORS_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept, Accept-Version, X-Api-Version, X-Admin-Token'

// Mutating/write endpoints get a tighter budget than read-only lookups.
const WRITE_PREFIXES = [
  '/api/incidents/report',
  '/api/realtime/broadcast',
  '/api/admin',
  '/api/feedback/report',
  '/api/stops/suggest',
  '/api/auth', // magic-link request/verify + logout
]
const WINDOW_MS = 60_000
const READ_LIMIT = 120
const WRITE_LIMIT = 30

export async function middleware(request: NextRequest) {
  const origin = request.headers.get('origin')
  const allowed = isAllowedOrigin(origin)

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    Vary: 'Origin',
  }
  if (allowed) corsHeaders['Access-Control-Allow-Origin'] = origin

  // Preflight — answer directly, never reaches the route handler.
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders })
  }

  const path = request.nextUrl.pathname

  // Load-metrics group: the stable registry id when the endpoint is known
  // ("routes.shape"), else the rate-limit grouping (write = full path, read =
  // first 4 path segments) so synthetic/undocumented paths still aggregate
  // instead of exploding the group count.
  const endpoint = findEndpoint(path, request.method)
  const isWrite = WRITE_PREFIXES.some((p) => path.startsWith(p))
  const metricsGroup = endpoint
    ? endpoint.id
    : isWrite
      ? path
      : path.split('/').slice(0, 4).join('/')

  const recordRequest = () => {
    if (path.startsWith('/api')) RequestMetrics.recordRequest(metricsGroup)
  }

  // Maintenance kill switch — checked before rate limiting so a disabled
  // endpoint doesn't even spend the caller's rate-limit budget. Hydrate the
  // durable flags first (fast after the first load) so the first request
  // after a restart already sees what was disabled before it.
  await MaintenanceStore.ensureHydrated()
  if (endpoint) {
    const flags = MaintenanceStore.getAll()
    const flag = flags.find((f) => f.feature === endpoint.id)
    if (flag) {
      recordRequest()
      RequestMetrics.record(metricsGroup, 503)
      return NextResponse.json(
        { error: 'Endpoint temporarily disabled', reason: flag.reason, since: flag.since },
        { status: 503, headers: corsHeaders }
      )
    }
  }

  // Admin auth gate — /api/admin/* and /api/errors (error details can be
  // sensitive: stack traces, DB messages). GET /api/admin/maintenance stays
  // public: the flags themselves are shown to riders in the status banner.
  const isAdminApi = path.startsWith('/api/admin') || path === '/api/errors'
  const isPublicMaintenanceGet = path === '/api/admin/maintenance' && request.method === 'GET'
  let refreshedCookie: string | null = null
  if (isAdminApi && !isPublicMaintenanceGet) {
    const auth = checkAdminAuth(request)
    if (!auth.ok) {
      recordRequest()
      RequestMetrics.record(metricsGroup, 401)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
    }
    // Sliding session: an authenticated request re-issues the cookie (throttled
    // to every 5 min), so 15 minutes of real inactivity kills it server-side.
    refreshedCookie = maybeRefreshSessionCookie(request)
  }

  // Page gate — /admin (and subpages except /admin/debug) need a session;
  // otherwise send the user to the login page. If a session cookie WAS sent
  // but rejected (idle-expired, past the 8h cap, or tampered), pass the
  // reason along so the login page can say "your session expired" instead of
  // silently bouncing.
  const isAdminPage = path === '/admin' || path.startsWith('/admin/')
  if (isAdminPage && path !== '/admin/debug') {
    const auth = checkAdminAuth(request)
    if (!auth.ok) {
      const login = new URL('/goToAdminAuth', publicBaseUrl(request.nextUrl.origin))
      if (auth.reason === 'invalid') {
        login.searchParams.set('error', 'Your session expired — sign in again.')
      }
      return NextResponse.redirect(login.toString(), 302)
    }
    refreshedCookie ??= maybeRefreshSessionCookie(request)
  }

  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT
  const key = `${clientIp(request.headers)}:${isWrite ? path : path.split('/').slice(0, 4).join('/')}`

  const result = await RateLimiterStore.check(key, limit, WINDOW_MS)

  if (!result.allowed) {
    recordRequest()
    RequestMetrics.record(metricsGroup, 429, { rateLimited: true })
    ErrorLog.record({
      path,
      method: request.method,
      status: 429,
      message: 'Rate limit exceeded',
    })
    const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000)
    return NextResponse.json(
      { error: 'Too Many Requests' },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  recordRequest()

  const response = NextResponse.next()
  for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v)
  if (refreshedCookie) response.headers.set('Set-Cookie', refreshedCookie)
  response.headers.set('X-RateLimit-Limit', String(limit))
  response.headers.set('X-RateLimit-Remaining', String(result.remaining))
  return response
}

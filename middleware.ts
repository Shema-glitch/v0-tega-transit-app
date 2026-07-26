/**
 * Runs in front of every /api/* request. Three jobs:
 *
 * 1. CORS allowlisting — reflects Access-Control-Allow-Origin only for the
 *    deployed frontend (FRONTEND_ORIGIN) and its Vercel preview deploys
 *    (*.vercel.app), instead of the old wildcard '*'. This stops OTHER
 *    websites' browser JS from reading responses cross-origin. It does NOT
 *    stop non-browser callers (curl, scripts, server-to-server) — CORS is a
 *    browser-enforced mechanism, not an auth mechanism. That's what the rate
 *    limiter and the per-endpoint ADMIN_TOKEN checks are for.
 *
 * 2. Per-IP rate limiting — a fixed-window counter (lib/api/rate-limiter.ts)
 *    that caps how many requests one IP can make to one route group per
 *    minute. This is the actual defense against a script hammering the API
 *    or someone firing 10,000 requests at one endpoint. It will NOT stop a
 *    real distributed (multi-IP) DDoS — that needs a CDN/WAF (e.g.
 *    Cloudflare) in front of Render, not application code.
 *
 * 3. Maintenance enforcement — the admin dashboard (/admin) can flip an
 *    endpoint off (lib/api/endpoint-registry.ts + MaintenanceStore). This is
 *    what actually makes that real: a disabled endpoint gets a 503 here,
 *    before the route handler ever runs. See docs/ADMIN_DASHBOARD_PRD.md §4.
 *
 * Runs on the Node.js runtime (not edge) so it shares the same in-memory
 * globalThis singleton the route handlers use for everything else.
 */

import { NextRequest, NextResponse } from 'next/server'
import { RateLimiterStore } from '@/lib/api/rate-limiter'
import { ErrorLog } from '@/lib/api/error-log'
import { findEndpoint } from '@/lib/api/endpoint-registry'
import { MaintenanceStore } from '@/lib/api/maintenance-store'

export const config = {
  matcher: '/api/:path*',
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
const WRITE_PREFIXES = ['/api/incidents/report', '/api/realtime/broadcast', '/api/admin', '/api/feedback/report', '/api/stops/suggest']
const WINDOW_MS = 60_000
const READ_LIMIT = 120
const WRITE_LIMIT = 30

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'unknown'
}

export function middleware(request: NextRequest) {
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

  // Maintenance kill switch — checked before rate limiting so a disabled
  // endpoint doesn't even spend the caller's rate-limit budget.
  const endpoint = findEndpoint(path, request.method)
  if (endpoint) {
    const flags = MaintenanceStore.getAll()
    const flag = flags.find((f) => f.feature === endpoint.id)
    if (flag) {
      return NextResponse.json(
        { error: 'Endpoint temporarily disabled', reason: flag.reason, since: flag.since },
        { status: 503, headers: corsHeaders }
      )
    }
  }

  const isWrite = WRITE_PREFIXES.some((p) => path.startsWith(p))
  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT
  const key = `${clientIp(request)}:${isWrite ? path : path.split('/').slice(0, 4).join('/')}`

  const result = RateLimiterStore.check(key, limit, WINDOW_MS)

  if (!result.allowed) {
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

  const response = NextResponse.next()
  for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v)
  response.headers.set('X-RateLimit-Limit', String(limit))
  response.headers.set('X-RateLimit-Remaining', String(result.remaining))
  return response
}

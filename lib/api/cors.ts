/**
 * Shared CORS policy for all API route handlers.
 *
 * The actual Access-Control-Allow-Origin value is decided in middleware.ts
 * (it needs the incoming request's Origin header to reflect it against an
 * allowlist — see FRONTEND_ORIGIN). This constant only carries the
 * origin-independent headers, so routes that still spread `...CORS` into
 * their own responses don't duplicate/conflict with what middleware sets.
 */

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
}

/**
 * Standard preflight response — export as `OPTIONS` from route handlers.
 * In practice middleware.ts answers OPTIONS for /api/* before the route is
 * ever reached; this stays as a harmless fallback for any route middleware
 * doesn't cover.
 */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

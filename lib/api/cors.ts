/**
 * Shared CORS policy for all API route handlers.
 * Keeps the open-CORS decision in one place so it can be tightened later
 * (e.g. restricted to the deployed frontend origin) without touching every route.
 */

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/** Standard preflight response — export as `OPTIONS` from route handlers. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

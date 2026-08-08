/**
 * lib/api/client-ip.ts — resolve the caller's IP from proxy headers.
 * Used by middleware rate limiting and the auth brute-force guard.
 */

export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return headers.get('x-real-ip') || 'unknown'
}

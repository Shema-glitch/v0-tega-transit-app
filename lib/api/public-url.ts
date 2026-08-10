/**
 * lib/api/public-url.ts — the public base URL the deployed app is reachable at.
 *
 * Used for links that get embedded in emails (the OTP magic-link redirect),
 * which must point at the public site even when the request arrived through a
 * proxy, a health check, or a local dev server — otherwise the emailed link
 * bounces off localhost.
 *
 * Resolution order:
 *   1. ADMIN_PUBLIC_URL (explicit — set this to the Render URL)
 *   2. NEXT_PUBLIC_APP_URL (generic frontend-URL convention)
 *   3. RENDER_EXTERNAL_URL (auto-set by Render to the service's public URL —
 *      covers deployments where the proxy presents the request to the app
 *      with an internal host like localhost:10000, which would otherwise
 *      poison every emailed link and redirect)
 *   4. the request's own origin (last resort — correct for local dev)
 */
export function publicBaseUrl(fallbackOrigin?: string): string {
  const configured =
    process.env.ADMIN_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL
  const base = configured && configured.trim() ? configured.trim() : fallbackOrigin || 'http://localhost:3000'
  return base.replace(/\/+$/, '')
}

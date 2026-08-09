/**
 * lib/api/http-error.ts — typed HTTP error for route handlers.
 *
 * Lets a cacheWrap() producer signal a terminal response (404/500/etc.)
 * without caching it: cacheWrap never stores a rejected promise, so
 * transient failures and not-found states stay uncached and the route's
 * catch maps the error back to the exact response shape it used before.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>
  ) {
    super(`HttpError ${status}`)
    this.name = 'HttpError'
  }
}

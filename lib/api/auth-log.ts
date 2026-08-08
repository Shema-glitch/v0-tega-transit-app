/**
 * lib/api/auth-log.ts — in-memory audit trail of auth events.
 *
 * Ring buffer capped at MAX entries. Also mirrored to the process console so
 * events survive in Render logs even if the in-memory buffer is reset by a
 * redeploy. Consumed by GET /api/admin/auth-log.
 */

const MAX = 100

export interface AuthLogEvent {
  at: number
  action: string
  email: string | null
  ip: string
  ok: boolean
  detail?: string
}

const events: AuthLogEvent[] = []

export const AuthLog = {
  record(ev: Omit<AuthLogEvent, 'at'>): void {
    const entry: AuthLogEvent = { ...ev, at: Date.now() }
    events.unshift(entry)
    if (events.length > MAX) events.length = MAX
    console.log(
      `[auth] ${ev.action} ${ev.ok ? 'ok' : 'FAIL'} ${ev.email ?? '-'} ip=${ev.ip}${
        ev.detail ? ` (${ev.detail})` : ''
      }`
    )
  },
  getRecent(): AuthLogEvent[] {
    return [...events]
  },
}

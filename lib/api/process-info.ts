/**
 * Timestamp this Node process started. Used by the admin dashboard to warn
 * "this process just restarted" — every maintenance flag lives in-memory
 * only (see maintenance-store.ts), so a Render restart mid-incident silently
 * re-enables everything with no trace. A short-uptime nudge on dashboard
 * load is the cheap v1 mitigation; a durable flag store is the real fix,
 * deliberately deferred (see docs/ADMIN_DASHBOARD_PRD.md).
 */

const KEY = Symbol.for('tega.process-info')
type GlobalWithProcessInfo = typeof globalThis & { [KEY]?: number }

const g = globalThis as GlobalWithProcessInfo
if (!g[KEY]) {
  g[KEY] = Date.now()
}

export const PROCESS_STARTED_AT: number = g[KEY]!

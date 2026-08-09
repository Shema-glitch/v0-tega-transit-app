/**
 * lib/api/load-alerts.ts — threshold alerts for the admin console.
 *
 * Watches the RequestMetrics totals and flips an alert when a metric crosses
 * its threshold: request rate (total requests/min) and rate-limit trips
 * (429s in the window — the "under attack" signal). Evaluated every time the
 * admin polls /api/admin/metrics (the Load panel polls every 10 s), so the
 * console is the watch surface — alerts appear the moment someone is looking.
 *
 * State machine per kind: idle → triggered (severity scales with how far
 * over) → resolved (back under threshold). A triggered alert is NOT re-fired
 * every poll — it stays active and refreshes its value until it resolves, so
 * the console never gets alert spam. Trigger/resolve events both land in a
 * capped history ring so you can see the spike after the fact.
 *
 * Thresholds (env-overridable):
 *   LOAD_ALERT_RPM_THRESHOLD   default 120 requests/min total
 *   LOAD_ALERT_429_THRESHOLD   default 10 rate-limited trips per window
 */

export type LoadAlertKind = 'requests_per_min' | 'rate_limited'
export type LoadAlertState = 'triggered' | 'resolved'

export interface LoadAlert {
  kind: LoadAlertKind
  severity: 'warn' | 'critical'
  value: number
  threshold: number
  state: LoadAlertState
  at: number
}

const MAX_HISTORY = 20

function thresholds() {
  return {
    rpm: Number(process.env.LOAD_ALERT_RPM_THRESHOLD) || 120,
    rateLimited: Number(process.env.LOAD_ALERT_429_THRESHOLD) || 10,
  }
}

function kindLabel(kind: LoadAlertKind): string {
  return kind === 'requests_per_min' ? 'Request rate' : 'Rate-limit trips'
}

class LoadAlertTracker {
  private active = new Map<LoadAlertKind, LoadAlert>()
  private history: LoadAlert[] = []
  readonly startedAt = Date.now()

  /** Called with the RequestMetrics totals on every metrics poll. */
  evaluate(totals: { requestsPerMin: number; rateLimited: number }): void {
    const t = thresholds()
    this.evaluateKind('requests_per_min', totals.requestsPerMin, t.rpm)
    this.evaluateKind('rate_limited', totals.rateLimited, t.rateLimited)
  }

  private evaluateKind(kind: LoadAlertKind, value: number, threshold: number): void {
    const current = this.active.get(kind)

    if (value >= threshold) {
      if (!current) {
        const severity = value >= threshold * 2 ? 'critical' : 'warn'
        const alert: LoadAlert = {
          kind,
          severity,
          value,
          threshold,
          state: 'triggered',
          at: Date.now(),
        }
        this.active.set(kind, alert)
        this.pushHistory(alert)
      } else {
        // Still over — refresh the value so the console shows the current
        // magnitude, but don't re-fire a second alert for the same episode.
        current.value = value
      }
      return
    }

    if (current) {
      this.active.delete(kind)
      this.pushHistory({ ...current, value, state: 'resolved', at: Date.now() })
    }
  }

  private pushHistory(alert: LoadAlert): void {
    this.history.unshift(alert)
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY
  }

  snapshot(): { active: LoadAlert[]; recent: LoadAlert[] } {
    return {
      active: [...this.active.values()].map((a) => ({ ...a })),
      recent: this.history.map((h) => ({ ...h })),
    }
  }

  /** Test hook — wipes state so tests don't bleed into each other. */
  __resetForTests(): void {
    this.active.clear()
    this.history.length = 0
  }
}

export const LoadAlerts = new LoadAlertTracker()
export { kindLabel }

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LoadAlerts } from '../load-alerts'

describe('LoadAlerts', () => {
  beforeEach(() => {
    LoadAlerts.__resetForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('triggers a warn alert when requests/min crosses the default threshold', () => {
    LoadAlerts.evaluate({ requestsPerMin: 150, rateLimited: 0 })
    const snap = LoadAlerts.snapshot()
    expect(snap.active).toHaveLength(1)
    expect(snap.active[0].kind).toBe('requests_per_min')
    expect(snap.active[0].severity).toBe('warn')
    expect(snap.active[0].state).toBe('triggered')
  })

  it('escalates to critical at 2x the threshold', () => {
    LoadAlerts.evaluate({ requestsPerMin: 300, rateLimited: 0 })
    expect(LoadAlerts.snapshot().active[0].severity).toBe('critical')
  })

  it('does not re-fire while an alert is active, but refreshes the value', () => {
    LoadAlerts.evaluate({ requestsPerMin: 150, rateLimited: 0 })
    LoadAlerts.evaluate({ requestsPerMin: 220, rateLimited: 0 })
    LoadAlerts.evaluate({ requestsPerMin: 180, rateLimited: 0 })
    const snap = LoadAlerts.snapshot()
    expect(snap.active).toHaveLength(1)
    expect(snap.active[0].value).toBe(180)
    expect(snap.recent).toHaveLength(1) // one trigger, not three
  })

  it('resolves when the value drops back under the threshold', () => {
    LoadAlerts.evaluate({ requestsPerMin: 150, rateLimited: 0 })
    LoadAlerts.evaluate({ requestsPerMin: 40, rateLimited: 0 })
    const snap = LoadAlerts.snapshot()
    expect(snap.active).toHaveLength(0)
    expect(snap.recent).toHaveLength(2) // trigger + resolve
    expect(snap.recent[0].state).toBe('resolved')
    expect(snap.recent[0].value).toBe(40)
  })

  it('tracks rate-limit trips as their own alert kind', () => {
    LoadAlerts.evaluate({ requestsPerMin: 5, rateLimited: 25 })
    const snap = LoadAlerts.snapshot()
    expect(snap.active).toHaveLength(1)
    expect(snap.active[0].kind).toBe('rate_limited')
    expect(snap.active[0].severity).toBe('critical')
  })

  it('honors env threshold overrides', () => {
    vi.stubEnv('LOAD_ALERT_RPM_THRESHOLD', '50')
    LoadAlerts.evaluate({ requestsPerMin: 60, rateLimited: 0 })
    expect(LoadAlerts.snapshot().active[0].threshold).toBe(50)
  })

  it('caps the history ring', () => {
    for (let i = 0; i < 30; i++) {
      LoadAlerts.evaluate({ requestsPerMin: 150, rateLimited: 0 })
      LoadAlerts.evaluate({ requestsPerMin: 10, rateLimited: 0 })
    }
    const snap = LoadAlerts.snapshot()
    expect(snap.recent.length).toBeLessThanOrEqual(20)
  })
})

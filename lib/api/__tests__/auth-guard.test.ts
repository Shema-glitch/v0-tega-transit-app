import { describe, it, expect, beforeEach } from 'vitest'
import { getAuthGuardStatus, recordAuthFailure, recordAuthSuccess, resetAuthGuard } from '@/lib/api/auth-guard'

describe('auth guard', () => {
  beforeEach(() => {
    resetAuthGuard()
  })

  it('starts unlocked', () => {
    expect(getAuthGuardStatus('1.1.1.1').blocked).toBe(false)
  })

  it('locks an IP after repeated failures and reports a retry window', () => {
    for (let i = 0; i < 5; i++) recordAuthFailure('1.1.1.1')
    const status = getAuthGuardStatus('1.1.1.1')
    expect(status.blocked).toBe(true)
    expect(status.retryAfterSec).toBeGreaterThan(0)
    // A different IP is unaffected
    expect(getAuthGuardStatus('2.2.2.2').blocked).toBe(false)
  })

  it('resets the lockout on a successful login', () => {
    for (let i = 0; i < 5; i++) recordAuthFailure('1.1.1.1')
    expect(getAuthGuardStatus('1.1.1.1').blocked).toBe(true)
    recordAuthSuccess('1.1.1.1')
    expect(getAuthGuardStatus('1.1.1.1').blocked).toBe(false)
  })

  it('trips the global circuit breaker on a burst of failures across IPs', () => {
    // 20 failures across many IPs inside one window trips the breaker.
    for (let i = 0; i < 20; i++) recordAuthFailure(`10.0.0.${i}`)
    // Even a never-seen IP is now blocked.
    const status = getAuthGuardStatus('99.99.99.99')
    expect(status.blocked).toBe(true)
    expect(status.retryAfterSec).toBeGreaterThan(0)
  })
})

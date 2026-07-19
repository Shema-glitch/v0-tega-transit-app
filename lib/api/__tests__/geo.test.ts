import { describe, it, expect } from 'vitest'
import { haversineMeters, walkingMinutes, bareRouteId } from '@/lib/api/geo'

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(-1.95, 30.06, -1.95, 30.06)).toBe(0)
  })

  it('returns a sane distance for two known Kigali-area points (~1.5km)', () => {
    // Roughly 0.0135 degrees latitude apart ≈ 1.5km
    const d = haversineMeters(-1.9536, 30.0605, -1.9670, 30.0605)
    expect(d).toBeGreaterThan(1000)
    expect(d).toBeLessThan(2000)
  })

  it('is symmetric', () => {
    const a = haversineMeters(-1.95, 30.06, -1.96, 30.07)
    const b = haversineMeters(-1.96, 30.07, -1.95, 30.06)
    expect(a).toBeCloseTo(b, 6)
  })
})

describe('walkingMinutes', () => {
  it('rounds up to the nearest whole minute', () => {
    expect(walkingMinutes(84)).toBe(1)
    expect(walkingMinutes(85)).toBe(2)
    expect(walkingMinutes(0)).toBe(0)
  })
})

describe('bareRouteId', () => {
  it('strips a route- prefix', () => {
    expect(bareRouteId('route-101')).toBe('101')
  })

  it('is case-insensitive on the prefix', () => {
    expect(bareRouteId('ROUTE-101')).toBe('101')
  })

  it('leaves already-bare ids untouched', () => {
    expect(bareRouteId('101')).toBe('101')
  })
})

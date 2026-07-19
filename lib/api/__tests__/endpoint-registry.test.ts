import { describe, it, expect } from 'vitest'
import { ENDPOINT_REGISTRY, findEndpoint } from '@/lib/api/endpoint-registry'

describe('ENDPOINT_REGISTRY', () => {
  it('every entry has a unique id', () => {
    const ids = ENDPOINT_REGISTRY.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('excludes meta/admin endpoints — those must never be disableable', () => {
    const forbidden = ['/api/health', '/api/status', '/api/errors', '/api/feedback', '/api/admin/maintenance', '/api/admin/verify']
    for (const path of forbidden) {
      expect(findEndpoint(path, 'GET')).toBeUndefined()
    }
  })
})

describe('findEndpoint', () => {
  it('matches an exact path', () => {
    expect(findEndpoint('/api/stops', 'GET')?.id).toBe('stops.list')
  })

  it('matches a dynamic segment', () => {
    expect(findEndpoint('/api/stops/24626187/arrivals', 'GET')?.id).toBe('stops.arrivals')
    expect(findEndpoint('/api/routes/101/shape', 'GET')?.id).toBe('routes.shape')
    expect(findEndpoint('/api/gtfs/stops/24626187/routes', 'GET')?.id).toBe('gtfs.stop.routes')
  })

  it('does not match the wrong method', () => {
    expect(findEndpoint('/api/incidents/report', 'GET')).toBeUndefined()
    expect(findEndpoint('/api/stops', 'POST')).toBeUndefined()
  })

  it('does not match an unrelated path', () => {
    expect(findEndpoint('/api/stops/24626187/nearby', 'GET')).toBeUndefined()
  })

  it('returns undefined for a completely unknown path', () => {
    expect(findEndpoint('/api/does-not-exist', 'GET')).toBeUndefined()
  })
})

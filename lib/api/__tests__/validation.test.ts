import { describe, it, expect } from 'vitest'
import { GeoQuerySchema, VehicleSchema, SearchSuggestSchema } from '@/lib/api/validation'

describe('GeoQuerySchema', () => {
  it('accepts a valid lat/lng and coerces string query params to numbers', () => {
    const result = GeoQuerySchema.parse({ lat: '-1.95', lng: '30.06' })
    expect(result.lat).toBe(-1.95)
    expect(result.lng).toBe(30.06)
    expect(result.radius).toBe(2000) // default
    expect(result.limit).toBe(10) // default
  })

  it('rejects out-of-range latitude', () => {
    expect(() => GeoQuerySchema.parse({ lat: 200, lng: 30 })).toThrow()
  })

  it('rejects out-of-range longitude', () => {
    expect(() => GeoQuerySchema.parse({ lat: 0, lng: -200 })).toThrow()
  })

  it('clamps radius/limit to their configured bounds', () => {
    expect(() => GeoQuerySchema.parse({ lat: 0, lng: 0, radius: 50 })).toThrow() // below min 100
    expect(() => GeoQuerySchema.parse({ lat: 0, lng: 0, limit: 500 })).toThrow() // above max 50
  })
})

describe('VehicleSchema', () => {
  const base = { id: 'v1', lat: -1.95, lon: 30.06, brg: 90, spd: 5 }

  it('accepts the minimal required shape', () => {
    expect(() => VehicleSchema.parse(base)).not.toThrow()
  })

  it('accepts full crowdsourced-ping fields', () => {
    const full = {
      ...base,
      route_id: '101',
      occupancy: 'seats',
      plate: 'RAD 123 A',
      operator: 'Kigali Bus Co',
      driver: 'Jean',
      live: true,
      direction_id: 1,
      destination_stop_id: 'stop-42',
      reporters: 2,
    }
    expect(() => VehicleSchema.parse(full)).not.toThrow()
  })

  it('rejects a bearing outside 0-360', () => {
    expect(() => VehicleSchema.parse({ ...base, brg: 400 })).toThrow()
  })

  it('rejects negative speed', () => {
    expect(() => VehicleSchema.parse({ ...base, spd: -1 })).toThrow()
  })

  it('rejects direction_id outside 0/1', () => {
    expect(() => VehicleSchema.parse({ ...base, direction_id: 2 })).toThrow()
  })

  it('rejects a non-positive reporters count', () => {
    expect(() => VehicleSchema.parse({ ...base, reporters: 0 })).toThrow()
  })

  it('rejects NaN for a required numeric field', () => {
    expect(() => VehicleSchema.parse({ ...base, lat: NaN })).toThrow()
  })
})

describe('SearchSuggestSchema', () => {
  it('rejects a query shorter than 2 characters', () => {
    expect(() => SearchSuggestSchema.parse({ q: 'a' })).toThrow()
  })

  it('defaults limit to 5', () => {
    expect(SearchSuggestSchema.parse({ q: 'kigali' }).limit).toBe(5)
  })
})

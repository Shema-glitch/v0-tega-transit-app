/**
 * Canonical list of toggleable API endpoints — the single source of truth
 * shared between middleware.ts (which actually enforces a disabled
 * endpoint) and the admin dashboard (which renders the toggle switches).
 *
 * Deliberately excludes meta/admin endpoints (health, status, errors,
 * feedback, admin/*) — those are the tools you'd use to turn things back
 * on, so they can't be disabled themselves.
 *
 * `id` is what gets stored as the MaintenanceStore "feature" key. It's a
 * stable identifier independent of the display path (which may contain
 * placeholders like {id} that can't be matched against a real pathname).
 */

export interface EndpointRegistryEntry {
  id: string
  method: 'GET' | 'POST'
  label: string // display path, e.g. '/api/stops/{id}/arrivals'
  group: string
  match: (pathname: string) => boolean
}

function exact(path: string) {
  return (pathname: string) => pathname === path
}

function segment(prefix: string, suffix: string) {
  // Matches prefix + '/' + <one path segment> + suffix, e.g.
  // segment('/api/stops', '/arrivals') matches /api/stops/24626187/arrivals
  const re = new RegExp(`^${prefix}/[^/]+${suffix}$`)
  return (pathname: string) => re.test(pathname)
}

export const ENDPOINT_REGISTRY: EndpointRegistryEntry[] = [
  // Stops & Arrivals
  { id: 'stops.list', method: 'GET', label: '/api/stops', group: 'Stops & Arrivals', match: exact('/api/stops') },
  { id: 'stops.arrivals', method: 'GET', label: '/api/stops/{id}/arrivals', group: 'Stops & Arrivals', match: segment('/api/stops', '/arrivals') },
  { id: 'search.suggest', method: 'GET', label: '/api/search/suggest', group: 'Stops & Arrivals', match: exact('/api/search/suggest') },

  // GTFS Static
  { id: 'gtfs.stops', method: 'GET', label: '/api/gtfs/stops', group: 'GTFS Static', match: exact('/api/gtfs/stops') },
  { id: 'gtfs.stop.routes', method: 'GET', label: '/api/gtfs/stops/{id}/routes', group: 'GTFS Static', match: segment('/api/gtfs/stops', '/routes') },
  { id: 'gtfs.hubs', method: 'GET', label: '/api/gtfs/hubs', group: 'GTFS Static', match: exact('/api/gtfs/hubs') },
  { id: 'gtfs.routes', method: 'GET', label: '/api/gtfs/routes', group: 'GTFS Static', match: exact('/api/gtfs/routes') },
  { id: 'routes.list', method: 'GET', label: '/api/routes', group: 'GTFS Static', match: exact('/api/routes') },
  { id: 'routes.shape', method: 'GET', label: '/api/routes/{id}/shape', group: 'GTFS Static', match: segment('/api/routes', '/shape') },
  { id: 'routes.sequence', method: 'GET', label: '/api/routes/{id}/sequence', group: 'GTFS Static', match: segment('/api/routes', '/sequence') },

  // Realtime
  { id: 'vehicles.live', method: 'GET', label: '/api/vehicles/live', group: 'Realtime', match: exact('/api/vehicles/live') },
  { id: 'realtime.sse', method: 'GET', label: '/api/realtime/sse', group: 'Realtime', match: exact('/api/realtime/sse') },
  { id: 'realtime.broadcast', method: 'POST', label: '/api/realtime/broadcast', group: 'Realtime', match: exact('/api/realtime/broadcast') },
  { id: 'incidents.report', method: 'POST', label: '/api/incidents/report', group: 'Realtime', match: exact('/api/incidents/report') },
  { id: 'incidents.active', method: 'GET', label: '/api/incidents/active', group: 'Realtime', match: exact('/api/incidents/active') },

  // Community
  { id: 'stops.suggest', method: 'POST', label: '/api/stops/suggest', group: 'Community', match: exact('/api/stops/suggest') },

  // Deprecated
  { id: 'arrivals.legacy', method: 'GET', label: '/api/arrivals', group: 'Deprecated', match: exact('/api/arrivals') },
]

/** Finds the registry entry matching a request, if any. */
export function findEndpoint(pathname: string, method: string): EndpointRegistryEntry | undefined {
  return ENDPOINT_REGISTRY.find((e) => e.method === method && e.match(pathname))
}

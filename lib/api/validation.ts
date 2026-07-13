import { z } from 'zod'

// Location parameter validation
export const GeoQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(100).max(10000).optional().default(2000),
  limit: z.coerce.number().min(1).max(50).optional().default(10),
})

// ETA Validation
export const ArrivalSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  routeId: z.string(),
  routeName: z.string(),
  destination: z.string(),
  stopId: z.string(),
  etaMin: z.number().nonnegative(),
  etaMax: z.number().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  delaySeconds: z.number().default(0),
})

// Vehicle Location Validation (Minified keys for bandwidth optimization)
export const VehicleSchema = z.object({
  id: z.string(),
  routeId: z.string().optional(), // Optional in delta stream to save bytes
  lat: z.number(),
  lng: z.number(),
  brg: z.number().min(0).max(360),
  spd: z.number().nonnegative(),
  // String rather than enum: simulated feeds use 'standing_room_only'/'full'
  // while crowdsourced pings use 'empty'/'seats'/'standing'/'packed'
  occupancy: z.string().optional(), // Optional in delta
  // Broadcaster-submitted vehicle info (first broadcast only)
  plate: z.string().optional(),
  operator: z.string().optional(),
  driver: z.string().optional(),
})

// Status/Telemetry Validation
export const SystemStatusSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'offline']),
  database: z.enum(['connected', 'disconnected']),
  realtimeServices: z.enum(['active', 'fallback']),
  gtfsFreshnessHours: z.number(),
  outages: z.array(z.string()),
  telemetry: z.object({
    activeSSEConnections: z.number(),
    averagePayloadSizeBytes: z.number(),
    averageApiLatencyMs: z.number(),
    totalMessagesSent: z.number(),
  }).optional(),
  timestamp: z.string().datetime(),
})

// Search Suggestion Validation
export const SearchSuggestSchema = z.object({
  q: z.string().min(2).max(100),
  limit: z.coerce.number().min(1).max(20).optional().default(5),
})

export type GeoQuery = z.infer<typeof GeoQuerySchema>
export type Arrival = z.infer<typeof ArrivalSchema>
export type Vehicle = z.infer<typeof VehicleSchema>
export type SystemStatus = z.infer<typeof SystemStatusSchema>
export type SearchSuggestQuery = z.infer<typeof SearchSuggestSchema>

// Incident Validation
// `incident_type`/`type` accepts any known keyword AND any other string —
// unrecognized types are logged and accepted rather than rejected, since a
// 400 on a forward-compat field name breaks callers using a newer client
// (docs/BACKEND_HANDOFF.md #7, e.g. the search UI's "missing_stop" report).
// vehicle_id/route_id/latitude/longitude are optional because a "missing
// stop" report has no vehicle or exact coordinate to attach.
export const IncidentSchema = z.object({
  vehicle_id: z.string().optional(),
  route_id: z.string().optional(),
  client_id: z.string(),
  incident_type: z.string().optional(),
  type: z.string().optional(),
  description: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  destination_stop_id: z.string().optional()
}).refine((d) => d.incident_type || d.type, {
  message: 'incident_type (or type) is required',
})

export type IncidentReport = z.infer<typeof IncidentSchema>

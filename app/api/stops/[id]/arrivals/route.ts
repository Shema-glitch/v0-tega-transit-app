/**
 * GET /api/stops/{stop_id}/arrivals
 *
 * Returns upcoming arrivals for a given stop.
 *
 * Rules:
 *  - {stop_id} is treated as a string (GTFS stop_ids are TEXT in the schema)
 *    but the path also handles numeric IDs produced by the GTFS feed.
 *  - If the stop does NOT exist in the Supabase `stops` table → 404.
 *  - If the stop exists but there are no scheduled stop_times → 200 {"arrivals": []}.
 *  - CORS is fully open so the React frontend is never blocked.
 *
 * Arrival data comes from the GTFS `stop_times` ⟶ `trips` ⟶ `routes` join.
 * Because GTFS scheduled times are static text (e.g. "08:30:00"), the engine
 * converts them relative to the current local time and filters to the next
 * 90 minutes of departures. Real-time crowdsourced data (if any live buses
 * are in the LiveVehicleStore) is merged in and sorted by ETA.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { EtaEngine } from '@/lib/api/eta.engine'
import { CacheService } from '@/lib/api/cache.service'
import { LiveVehicleStore } from '@/lib/api/live-store'
import { haversineMeters } from '@/lib/api/geo'
import { findStopIdsNear } from '@/lib/api/stops-cache'
import { ErrorLog } from '@/lib/api/error-log'
import { CORS, corsPreflight } from '@/lib/api/cors'
import { withRequestMetrics } from '@/lib/api/request-metrics'
import { cacheWrap } from '@/lib/api/ttl-cache'

// Micro-cache window for arrival payloads. A popular stop's concurrent
// checkers collapse onto ONE stop_times query (single-flight), and everyone
// within 5 s reads the same snapshot — fresh enough for ETAs, a fraction of
// the Supabase load (see docs/DEPLOYMENT_GUIDE.md §Scaling).
const ARRIVALS_MICRO_CACHE_MS = 5000

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a GTFS "HH:MM:SS" arrival_time string into minutes past midnight.
 * GTFS allows times like "25:00:00" for after-midnight services.
 */
function gtfsTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Current minutes past midnight in the server's local timezone. */
function nowMinutes(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withRequestMetrics('stops.arrivals', () => handleGet(request, ctx))
}

async function handleGet(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params
  const stopId = resolvedParams.id

  if (!stopId || stopId.trim() === '') {
    return NextResponse.json(
      { error: 'Stop ID required' },
      { status: 400, headers: CORS }
    )
  }

  try {
    const supabase = getSupabaseServer()

    // ── 1. Verify the stop exists ──────────────────────────────────────────────
    const { data: stopRow, error: stopErr } = await supabase
      .from('stops')
      .select('stop_id, stop_name, stop_lat, stop_lon')
      .eq('stop_id', stopId)
      .maybeSingle()

    if (stopErr) {
      console.error('[arrivals] Stop lookup error:', stopErr)
      return NextResponse.json(
        { error: 'Database error', details: stopErr.message },
        { status: 500, headers: CORS }
      )
    }

    // Stop does not exist in the database → genuine 404
    if (!stopRow) {
      return NextResponse.json(
        { error: `Stop '${stopId}' not found` },
        { status: 404, headers: CORS }
      )
    }

    const stopLat = stopRow.stop_lat as number
    const stopLon = stopRow.stop_lon as number

    // ── 2-4. Build the arrival payload (live merge + schedule join + sort),
    //         micro-cached for 5 s. 404s are decided above, before the cache,
    //         so a newly-imported stop never stays "not found" for 5 s.
    const payload = await cacheWrap(`arrivals:${stopId}`, ARRIVALS_MICRO_CACHE_MS, async () => {
    // ── 2. Merge live crowdsourced vehicles ────────────────────────────────────
    const liveBuses = LiveVehicleStore.getVehicles()
    const liveArrivals = liveBuses.map((bus, i) => {
      const dist = haversineMeters(bus.lat, bus.lng, stopLat, stopLon)
      const window = EtaEngine.calculateWindow({ distanceMeters: dist })
      return {
        id: `arrival-live-${Date.now()}-${i}`,
        vehicleId: bus.vehicleId,
        routeId: bus.routeId,
        routeName: `Route ${bus.routeId.replace(/^route-/i, '')}`,
        destination: 'Live',
        stopId,
        etaMin: window.etaMin,
        etaMax: window.etaMax,
        confidence: window.confidence,
        delaySeconds: 0,
        source: 'live' as 'live' | 'schedule',
      }
    })

    // ── 3. Fetch scheduled stop_times from Supabase ────────────────────────────
    const LOOKAHEAD_MIN = 90 // show arrivals in the next 90 minutes
    const currentMin = nowMinutes()

    // Resolve all stops within 50m (from the in-memory cache) to capture
    // fragmented schedules split across duplicate stop records.
    let nearbyStopIds = [stopId]
    try {
      const ids = await findStopIdsNear(stopLat, stopLon, 50)
      if (ids.length > 0) nearbyStopIds = ids
    } catch (err) {
      console.warn('[arrivals] stops cache unavailable, using exact stop only:', err)
    }

    const { data: stRows, error: stErr } = await supabase
      .from('stop_times')
      .select(
        `
        arrival_time,
        departure_time,
        trip_id,
        trips!inner (
          route_id,
          trip_headsign,
          routes!inner (
            route_short_name,
            route_long_name,
            route_color
          )
        )
      `
      )
      .in('stop_id', nearbyStopIds)
      .order('arrival_time', { ascending: true })
      .limit(200) // guard against massive result sets

    if (stErr) {
      console.error('[arrivals] stop_times query error:', stErr)
      // Graceful degradation: if the join fails, fall through to live-only
    }

    const scheduleArrivals: typeof liveArrivals = []

    for (const row of stRows ?? []) {
      if (!row.arrival_time) continue

      const arrMin = gtfsTimeToMinutes(row.arrival_time)
      const minutesAway = arrMin - currentMin

      // Filter to arrivals within our lookahead window
      // Also handle GTFS after-midnight services by checking +24h wrap
      const adjustedMinutes =
        minutesAway < -30
          ? minutesAway + 24 * 60 // next-day wrap
          : minutesAway

      if (adjustedMinutes < 0 || adjustedMinutes > LOOKAHEAD_MIN) continue

      const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips
      if (!trip) continue
      const route = Array.isArray(trip.routes) ? trip.routes[0] : trip.routes

      const routeId = trip.route_id ?? 'unknown'
      const routeShortName =
        route?.route_short_name ?? trip.route_id ?? 'Bus'
      const headsign = trip.trip_headsign ?? route?.route_long_name ?? 'Unknown'

      // Spread of 1–3 min for schedule-based confidence
      const spread = adjustedMinutes < 5 ? 1 : adjustedMinutes < 15 ? 2 : 3
      const confidence =
        adjustedMinutes < 5 ? 'high' : adjustedMinutes < 15 ? 'medium' : 'low'

      scheduleArrivals.push({
        id: `arrival-sched-${row.trip_id}-${stopId}`,
        vehicleId: `trip-${row.trip_id}`,
        routeId,
        routeName: `Route ${routeShortName}`,
        destination: headsign,
        stopId,
        etaMin: Math.max(0, Math.floor(adjustedMinutes - spread / 2)),
        etaMax: Math.ceil(adjustedMinutes + spread / 2),
        confidence: confidence as 'low' | 'medium' | 'high',
        delaySeconds: 0,
        source: 'schedule' as const,
      })
    }

    // ── 4. Merge + sort ────────────────────────────────────────────────────────
    // Live arrivals take precedence; schedules fill the rest
    const arrivals = [...liveArrivals, ...scheduleArrivals].sort(
      (a, b) => a.etaMin - b.etaMin
    )

    // Valid stop with no arrivals → 200 + empty array (NOT 404)
    return {
      stopId,
      arrivals,
      metadata: {
        timestamp: new Date().toISOString(),
        engine: 'eta_v2_predictive',
        stopName: stopRow.stop_name,
      },
    }
    }) // end cacheWrap

    // ── 5. Respond ─────────────────────────────────────────────────────────────
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        ...CORS,
        ...(CacheService.liveHeaders() as Record<string, string>),
      },
    })
  } catch (err) {
    console.error('[GET /api/stops/[id]/arrivals] Unexpected error:', err)
    ErrorLog.record({ path: '/api/stops/{id}/arrivals', method: 'GET', status: 500, message: err instanceof Error ? err.message : 'Unknown error' })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: CORS }
    )
  }
}

export async function OPTIONS() {
  return corsPreflight()
}

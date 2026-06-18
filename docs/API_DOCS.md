# Tega Transit API Documentation (v3.0)

> **Base URL**  
> Local: `http://localhost:3000/api`  
> Production: `https://tega-transit-api.onrender.com/api`

This is the complete reference for the Tega Transit backend API. Every endpoint is documented with its purpose, expected inputs, outputs, and practical coding advice.

---

## ⚡ Critical Note: Render.com Free Tier Cold Starts

> **Read this before connecting to the API.**

Render.com's free tier automatically **spins down** the server after 15 minutes of inactivity. The first request after a cold start can take **20–50 seconds** to respond while the server wakes up.

### Frontend Strategy — What to do *instead* of just waiting

Never simply show a blank screen or spinner. Here is a proven layered strategy:

#### 1. Ping Before Loading (Wake-Up Call)
On app mount, immediately fire a lightweight health-check request in the background *before* the user needs data. This starts the server warm-up process early.

```js
// Call this when the app first loads (e.g., in App.tsx useEffect)
async function wakeUpServer() {
  try {
    await fetch('https://tega-transit-api.onrender.com/api/health', { signal: AbortSignal.timeout(60000) })
  } catch {}
}
wakeUpServer()
```

#### 2. Show Skeleton UI Immediately
Render placeholder skeletons using your existing Framer Motion setup. Never show a blank map — always display the skeleton of the card, stop list, or bus markers immediately.

#### 3. Use Cached/Local Data While Waiting
Ship a **static snapshot** of stops data alongside the frontend (a `kigali_stops.json` file). Show it instantly while the real API wakes up, then swap it for live data when available.

```js
import fallbackStops from './kigali_stops_snapshot.json'

const { data: stops, isLoading } = useQuery({
  queryKey: ['stops'],
  queryFn: fetchStops,
  placeholderData: fallbackStops, // Show this instantly
  staleTime: 5 * 60 * 1000
})
```

#### 4. Friendly Cold-Start Banner
Detect a long-running first request (> 5 seconds) and show a specific message — not a generic spinner.

```js
const [showColdStartWarning, setShowColdStartWarning] = useState(false)

useEffect(() => {
  const timer = setTimeout(() => setShowColdStartWarning(true), 5000)
  return () => clearTimeout(timer)
}, [])

// Render: "☕ Waking up the server... this takes ~30s on first load"
```

#### 5. Progressive Loading Order
Fetch in this order of priority to show *something* useful as fast as possible:
1. `GET /api/health` → Wake server (fire immediately, don't wait)
2. `GET /api/stops` → Critical for the map
3. `GET /api/realtime/sse` → Live updates (connect after stops load)
4. `GET /api/vehicles/live` → Fallback snapshot if SSE fails

---

## API Reference

### System & Health

---

#### `GET /api/health`
**Purpose:** Ultra-lightweight liveness check. Use this as your warm-up ping. Responds in < 5ms once warm.

**Frontend Use:** Fire this on app launch to wake the server. Do not wait for the response before rendering the UI.

**Response**
```json
{ "status": "ok", "uptime": 12345 }
```

---

#### `GET /api/status`
**Purpose:** Returns full system health including database connectivity, GTFS data freshness, active SSE connections, and API latency telemetry.

**Frontend Use:** Display this on a developer dashboard or settings screen. Use the `status` field to show a "⚠️ Service Degraded" banner if it is not `"healthy"`.

**Response**
```json
{
  "status": "healthy",
  "database": "connected",
  "realtimeServices": "fallback",
  "gtfsFreshnessHours": 24,
  "outages": [],
  "telemetry": {
    "activeSSEConnections": 3,
    "averagePayloadSizeBytes": 212,
    "averageApiLatencyMs": 45,
    "totalMessagesSent": 892
  },
  "timestamp": "2026-06-15T08:30:00.000Z"
}
```

---

#### `GET /api/diagnostics`
**Purpose:** Identifies exactly which buses are having trouble. Returns the health status of every crowdsourced vehicle in the live stream, flagging those that are stale (silent > 2 minutes) or broadcasting anomalous speeds (GPS glitches).

**Frontend Use:** Add a "Debug Panel" in your dev/admin view that polls this endpoint to see which buses are misbehaving. Each entry includes a `reason` string explaining the problem in plain English.

**Response**
```json
{
  "overall": "healthy",
  "activeSSEConnections": 3,
  "averageApiLatencyMs": 45,
  "troubledBusesCount": 1,
  "troubledBuses": [
    {
      "vehicleId": "bus-101",
      "status": "stale",
      "reason": "No ping in 145 seconds",
      "lastPingTime": "2026-06-15T08:28:00.000Z"
    }
  ],
  "timestamp": "2026-06-15T08:30:00.000Z"
}
```

| `status` value  | Meaning |
|---|---|
| `healthy` | Bus is actively pinging and within expected speed |
| `stale` | Bus has not pinged in > 2 minutes — possibly offline |
| `speed_anomaly` | Bus pinged an impossible speed — likely a GPS glitch |

---

### Stops & Search

---

#### `GET /api/stops`
**Purpose:** Returns transit stops near a given GPS coordinate, sorted by walking distance. Falls back to the top 10 stops if no location is provided.

**Query Parameters**

| Param | Type | Required | Default | Max | Description |
|---|---|---|---|---|---|
| `lat` | float | No | — | — | User latitude |
| `lng` | float | No | — | — | User longitude |
| `radius` | int (meters) | No | 2000 | 10000 | Search radius in meters |
| `limit` | int | No | 10 | 50 | Number of results to return |

**Frontend Use:** Pass the user's device GPS coordinates to get the stops closest to them. Always call this before connecting to the SSE stream so the map has stop pins ready.

**Response**
```json
{
  "stops": [
    {
      "id": "stop-kacyiru",
      "name": "Kacyiru Bus Park",
      "latitude": -1.928,
      "longitude": 30.082,
      "walkingMeters": 340,
      "walkingDistance": 4
    }
  ],
  "total": 1,
  "center": { "lat": -1.9306, "lng": 30.0812 },
  "radius": 2000
}
```

---

#### `GET /api/stops/:id/arrivals`
**Purpose:** Returns upcoming bus arrivals for a specific stop. The engine prioritizes **real-time crowdsourced location data** (from the `broadcast` endpoint) over static schedules, giving the most accurate ETAs possible.

**Path Parameter:** `:id` — the stop ID (e.g., `stop-kacyiru`)

**Frontend Use:** Call this when the user taps a stop pin on the map. Render an ETA chip per arrival and use `etaMin`/`etaMax` to build the range display (e.g., "2–4 min"). The `confidence` field drives the color of the chip.

**Response**
```json
{
  "stopId": "stop-kacyiru",
  "arrivals": [
    {
      "id": "arrival-live-123",
      "vehicleId": "bus-101",
      "routeId": "route-101",
      "routeName": "Route 101",
      "destination": "Downtown",
      "stopId": "stop-kacyiru",
      "etaMin": 2,
      "etaMax": 4,
      "confidence": "high",
      "delaySeconds": 0
    }
  ],
  "metadata": {
    "timestamp": "2026-06-15T08:30:00.000Z",
    "engine": "eta_v2_predictive"
  }
}
```

| `confidence` value | What it means | Suggested chip color |
|---|---|---|
| `high` | Based on a live GPS ping < 1 min ago | 🟢 Green |
| `medium` | Based on a recent ping 1–5 min ago | 🟡 Amber |
| `low` | Based purely on static GTFS schedule | 🔴 Red / Grey |

---

#### `GET /api/search/suggest`
**Purpose:** Typo-tolerant stop search. Returns matching stops with their **intersecting routes pre-included**, so the frontend does not need to make follow-up requests to get route information.

**Query Parameters**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `q` | string | Yes | — | Search query (min 2 chars, max 100) |
| `limit` | int | No | 5 | Max results (max 20) |

**Frontend Use:** Wire this to your search bar with a `300ms` debounce. Render a suggestion list where each item shows the stop name and the route badges (e.g., `101`, `104`) from the `routes` array — no extra requests needed.

**Response**
```json
{
  "suggestions": [
    {
      "id": "stop-gatenga",
      "name": "Gatenga",
      "latitude": -1.958,
      "longitude": 30.075,
      "routes": ["102", "104"]
    }
  ],
  "metadata": { "totalCount": 1, "query": "Gate" }
}
```

---

### Routes & Transit Data

---

#### `GET /api/routes/:id/shape`
**Purpose:** Returns the geographic polyline of a route for rendering as a colored line on the Mapbox map.

**Path Parameter:** `:id` — route ID (e.g., `route-101`)

**Frontend Use:** Call this when the user selects a route to see its path. Pass the `coordinates` array directly to a Mapbox `LineLayer` source. This endpoint is aggressively cached (`Cache-Control: max-age=3600`) so it will load instantly on repeat views.

**Response**
```json
{
  "routeId": "route-101",
  "coordinates": [
    [30.0485, -1.9367],
    [30.0590, -1.9450]
  ],
  "metadata": { "simplified": true, "pointsCount": 10 }
}
```

> **Note:** Coordinates are in `[longitude, latitude]` order (GeoJSON standard), not the `[lat, lng]` convention — ensure your Mapbox layer handles this correctly.

---

#### `GET /api/routes/:id/sequence`
**Purpose:** Returns the **ordered list of stops** for a route, parsed directly from the real GTFS `stop_times.txt` data. This is what powers the vertical Timeline UI.

**Path Parameter:** `:id` — GTFS route ID (e.g., `101`)  
**Query Parameters:** `?direction=0` (Outbound) or `?direction=1` (Inbound), defaults to `0`.

**Frontend Use:** Fetch this when the user opens the Route Detail Overlay / Timeline view. Render each stop as a node in the vertical timeline. Use `stopSequence` for ordering. Apply an `isCurrent` flag by comparing each stop's coordinates with the nearest crowdsourced bus location.

**Response**
```json
{
  "routeId": "101",
  "directionId": "0",
  "tripId": "24626201",
  "sequence": [
    { "stopSequence": 1, "stopId": "24626187", "name": "campkigali", "lat": -1.943460, "lng": 30.057250 },
    { "stopSequence": 2, "stopId": "24626192", "name": "Kacyiru", "lat": -1.928000, "lng": 30.082000 }
  ],
  "metadata": { "source": "gtfs_real_data", "stopCount": 24 }
}
```

---

#### `GET /api/gtfs/hubs`
**Purpose:** Returns the major transit anchor hubs (Nyabugogo, Downtown, Remera, Kimironko), each with the list of physical `stop_id`s belonging to that hub.

**Frontend Use:** Use this on a "Hubs" screen or map overlay. Instead of rendering hundreds of individual stop pins at small zoom levels, render a single Hub pin per group. When the user taps it, query departures using the individual `stops` IDs.

**Response**
```json
{
  "hubs": [
    {
      "id": "hub-nyabugogo",
      "name": "Nyabugogo Transit Hub",
      "latitude": -1.9367,
      "longitude": 30.0485,
      "stops": ["stop-nyabugogo"]
    }
  ],
  "metadata": { "source": "static_hubs", "total": 4 }
}
```

---

#### `GET /api/gtfs/routes`
**Purpose:** Returns all bus routes in the Kigali GTFS network with IDs, names, colors, and destinations.

**Frontend Use:** Fetch once on startup and cache in your React Query store. Use the `color` field to paint route badges and map lines.

---

#### `GET /api/gtfs/stops`
**Purpose:** Returns all stops in the raw GTFS dataset.

**Frontend Use:** Use `GET /api/stops` (with coordinates) instead for most use cases. This endpoint returns the raw unfiltered list — useful if you want to pre-load and cache all stop data on the frontend.

---

#### `GET /api/gtfs/stops/:id/routes`
**Purpose:** Returns all routes that serve a specific stop.

**Path Parameter:** `:id` — stop ID

---

### Realtime & Live Tracking

---

#### `GET /api/realtime/sse`
**Purpose:** Establishes a persistent Server-Sent Events stream. Sends compact **delta payloads** (only what changed) every 2 seconds. Crowdsourced bus locations override simulated data automatically.

**Query Parameters**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `lat` | float | Yes | 0 | Your latitude — used to filter to nearby vehicles only |
| `lng` | float | Yes | 0 | Your longitude |
| `radius` | int | No | 2000 | Region radius in meters. Only buses within this radius are streamed. |

**Frontend Use (Vite/React):**
```js
useEffect(() => {
  const sse = new EventSource(
    `https://tega-transit-api.onrender.com/api/realtime/sse?lat=${lat}&lng=${lng}&radius=3000`
  )
  
  sse.addEventListener('message', (e) => {
    const { type, vehicles } = JSON.parse(e.data)
    if (type === 'vehicle:update') {
      // Merge delta updates into your existing map marker state
      vehicles.forEach(v => updateMarker(v.id, v))
    }
  })

  // EventSource auto-reconnects on drop — no extra logic needed
  return () => sse.close()
}, [lat, lng])
```

**Payload (delta — only changed fields)**
```json
{
  "type": "vehicle:update",
  "vehicles": [
    { "id": "bus-route-101-active", "lat": -1.94521, "lng": 30.06105, "brg": 142, "spd": 34 }
  ]
}
```

**Payload (incident alert)**
Pushed whenever an active incident overlaps with your `radius`.
```json
{
  "type": "incident:alert",
  "incidents": [
    {
      "vehicleId": "bus-101",
      "routeId": "route-101",
      "incidentType": "route_changed",
      "message": "Alert — Bus route-101 reported route changed."
    }
  ]
}
```

> **Connection Limit:** The server caps active SSE connections at 100. If this limit is reached, the API returns `503 Service Unavailable`. Implement a 5-second retry with exponential backoff.

---

#### `POST /api/realtime/broadcast`
**Purpose:** The Crowdsourcing Ingestion endpoint. Called by the "I'm on this Bus" feature. Accepts a commuter's GPS ping, validates it, and immediately injects it into the live SSE stream for all other connected users to see.

**Frontend Use:** Call this every 10–15 seconds while the user has the "I'm on this Bus" toggle enabled. Do not call more frequently than every 5 seconds — the server will still accept it but it is unnecessary battery drain.

**Request Body**
```json
{
  "vehicle_id": "bus-101",
  "route_id": "route-101",
  "client_id": "uuid-v4-of-this-device",
  "latitude": -1.9441,
  "longitude": 30.0619,
  "speed_kmh": 35,
  "heading": 142,
  "timestamp": "2026-06-15T08:30:00Z"
}
```

**Validation Rules**
- `speed_kmh` > 120 → Rejected with `422 Unprocessable Entity` (spoofing protection)
- Missing required fields → Rejected with `400 Bad Request`

**Success Response**
```json
{ "success": true, "status": "Ingested" }
```

---

#### `POST /api/incidents/report`
**Purpose:** The Pinger Incident System Ingestion endpoint. Allows an onboard passenger to report an active incident (traffic, detour, skip stop) to the network.

**Frontend Use:** Call this when a user taps one of the incident buttons in the "I'm on this Bus" UI.

**Request Body**
```json
{
  "vehicle_id": "bus-101",
  "route_id": "route-101",
  "client_id": "uuid-v4-of-this-device",
  "incident_type": "route_changed", 
  "latitude": -1.9441,
  "longitude": 30.0619,
  "destination_stop_id": "stop-gatenga" 
}
```
*Note: `incident_type` must be exactly `"route_changed"`, `"traffic_delay"`, or `"skip_stop"`.*

**Success Response**
```json
{ "success": true, "status": "Incident Reported" }
```

---

#### `GET /api/vehicles/live`
**Purpose:** A one-shot HTTP snapshot of all currently active vehicles. Useful as a fallback if the SSE stream cannot connect.

**Frontend Use:** Use this as your **fallback strategy**. If `EventSource` fails to connect within 5 seconds, call this endpoint every 5 seconds via `setInterval` as a polling fallback. Switch back to SSE when a connection can be established.

**Response**
```json
{
  "vehicles": [
    { "id": "bus-route-101-active", "routeId": "route-101", "lat": -1.95, "lng": 30.06, "brg": 145, "spd": 32, "occupancy": "standing_room_only" }
  ],
  "metadata": { "timestamp": "2026-06-15T08:30:00.000Z", "source": "simulation_engine" }
}
```

---

## HTTP Status Code Reference

| Code | Meaning |
|---|---|
| `200` | Success |
| `400` | Invalid parameters — check your query params or request body |
| `404` | Resource not found (stop ID or route ID does not exist) |
| `422` | Data rejected due to validation failure (e.g., speed anomaly) |
| `500` | Internal server error — report to API maintainer |
| `503` | Server at capacity (SSE connection limit reached) — retry with backoff |

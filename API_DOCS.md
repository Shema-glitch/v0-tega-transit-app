# Tega Transit API Ecosystem (v2.0)

Welcome to the Tega Transit API. This architecture is designed for "investor-demo-quality" realtime transit tracking. It is built on **PostGIS** for spatial routing, **Zod** for robust data validation, and **Server-Sent Events (SSE)** for zero-latency live streams.

## Base URL
Local: `http://localhost:3000/api`  
Production: `https://your-app.onrender.com/api`

---

## 1. System Telemetry
### `GET /api/status`
Returns full system health, DB connection status, and GTFS freshness.

**Response**
```json
{
  "status": "healthy",
  "database": "connected",
  "realtimeServices": "fallback",
  "gtfsFreshnessHours": 24,
  "outages": [],
  "timestamp": "2026-05-24T21:30:00.000Z"
}
```

---

## 2. Spatial & Search
### `GET /api/search/suggest`
Intelligent, typo-tolerant search leveraging PostGIS fuzzy matching (`pg_trgm` ILIKE).

**Query Parameters**
- `q`: Search string (e.g. `Kiyo`)
- `limit`: Max results (default `5`)

**Response**
```json
{
  "suggestions": [
    { "id": "24626203", "name": "Kiyovu", "latitude": -1.943, "longitude": 30.061 }
  ],
  "metadata": { "totalCount": 1, "query": "Kiyo" }
}
```

---

## 3. Realtime SSE Streams
### `GET /api/realtime/sse`
Connect to this endpoint via the `EventSource` browser API to receive continuous JSON payloads of vehicle updates without polling. 

**Format**
```text
event: connected
data: {"status": "streaming"}

event: message
data: {"vehicles": [{ "id": "bus-1", "latitude": -1.9, "longitude": 30.0, "bearing": 120, "speedKmh": 35 }]}
```

---

## 4. Live Vehicles
### `GET /api/vehicles/live`
Fetches a snapshot of all active vehicles. Highly cached (5s edge cache) to absorb traffic spikes.

**Response**
```json
{
  "vehicles": [
    {
      "id": "bus-101-active",
      "routeId": "route-101",
      "latitude": -1.9536,
      "longitude": 30.0605,
      "bearing": 145,
      "speedKmh": 32,
      "occupancy": "standing_room_only",
      "updatedAt": "2026-05-24T21:35:00.000Z"
    }
  ]
}
```

---

## 5. Intelligent ETA Engine
### `GET /api/stops/:id/arrivals`
Uses the modular `EtaEngine` to return a confidence-weighted arrival window rather than fake absolute precision.

**Response**
```json
{
  "stopId": "24626203",
  "arrivals": [
    {
      "id": "arrival-101",
      "vehicleId": "bus-101-active",
      "routeId": "route-101",
      "routeName": "Route 101",
      "destination": "Downtown",
      "etaMin": 2,
      "etaMax": 4,
      "confidence": "high",
      "delaySeconds": 0
    }
  ],
  "metadata": { "engine": "eta_v2_predictive" }
}
```

---

## 6. Route Shapes
### `GET /api/routes/:id/shape`
Returns optimized polyline geometries for rendering a specific route on Mapbox/Google Maps.

**Response**
```json
{
  "routeId": "route-101",
  "coordinates": [ [30.0619, -1.9441], [30.0750, -1.9650] ],
  "metadata": { "simplified": true, "pointsCount": 2 }
}
```

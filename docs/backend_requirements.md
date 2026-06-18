# TegaBus Backend Evolution Blueprint

To fully unlock the frontend features we've built (like the Route Timeline, the Map Hubs, and the Crowdsourcing Toggle), the backend needs to evolve to provide the following endpoints and logic. 

This document serves as your API contract checklist for the next phase of backend development.

---

## 1. Ordered Route Sequences
**The Problem**: The frontend vertical timeline (`ETAChip` and `RouteDetailOverlay`) currently uses mock data.
**The Solution**: The backend must parse the GTFS `stop_times.txt` files to return a strictly ordered sequence of stops for a given route.

**Required Endpoint**: `GET /api/gtfs/routes/:route_id/sequence`
**Expected Response**:
```json
{
  "route_id": "101",
  "direction_id": 0,
  "sequence": [
    {
      "stop_id": "24626187",
      "stop_name": "Downtown",
      "stop_sequence": 1,
      "is_terminal": true
    },
    {
      "stop_id": "998123",
      "stop_name": "Payage",
      "stop_sequence": 2,
      "is_terminal": false
    }
  ]
}
```

---

## 2. Crowdsourcing Ingestion Pipeline
**The Problem**: The frontend "I'm on this Bus" toggle currently just logs coordinates to the browser console.
**The Solution**: The backend needs a secure ingestion pipeline to receive high-frequency GPS pings from commuters, validate them, and inject them into the live system.

**Required Endpoint**: `POST /api/realtime/broadcast` (or a dedicated WebSocket channel)
**Expected Payload**:
```json
{
  "vehicle_id": "bus-101", 
  "route_id": "101",
  "client_id": "uuid-v4",
  "latitude": -1.9441,
  "longitude": 30.0619,
  "speed_kmh": 45,
  "timestamp": "2026-06-15T08:30:00Z"
}
```
**Backend Logic**: 
- Implement speed validation to discard spoofed locations (e.g., traveling at 300km/h).
- Immediately push the validated coordinates to the existing `GET /api/realtime/sse` stream so other waiting commuters see the bus move instantly.

---

## 3. Dynamic ETA Engine Updates
**The Problem**: The `EtaEngine` currently calculates arrival times based on static GTFS scheduled intervals.
**The Solution**: Evolve the `GET /api/stops/:id/arrivals` endpoint. 
**Backend Logic**:
- If a bus has an active crowdsourced location stream, the ETA engine must prioritize that real-time spatial data over the static schedule.
- Use PostGIS distance calculations between the crowdsourced bus coordinate and the target stop coordinate to generate a hyper-accurate ETA.

---

## 4. Pre-Aggregated Search & Hubs
**The Problem**: Currently, when you search "Gatenga", the frontend receives duplicates (inbound vs outbound stops) and has to make multiple rapid `getStopRoutes` requests to disambiguate them.
**The Solution**: The backend search logic should be optimized to reduce client-side network load.

**Evolve Endpoint**: `GET /api/search/suggest`
**New Logic**:
- When returning a stop, the backend should do the SQL joins to include the intersecting routes directly in the payload.
**Expected Response**:
```json
{
  "suggestions": [
    { 
      "id": "24626203", 
      "name": "Gatenga", 
      "latitude": -1.943, 
      "longitude": 30.061,
      "routes": ["104", "105"] // NEW: Include intersecting routes directly
    }
  ]
}
```

**Evolve Endpoint**: `GET /api/gtfs/hubs` (New)
**New Logic**:
- Return a mapped grouping of major transit anchors (Nyabugogo, Remera, Kimironko, etc.) and all the underlying `stop_id`s that belong to that physical area, allowing the frontend to query a single "Hub ID" to get all departures.

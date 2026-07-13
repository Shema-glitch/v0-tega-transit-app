# Backend / API Handoff — Fixes & Improvements Needed

> Compiled 2026-07-13 from live probes of `https://tega-transit-api.onrender.com/api`
> and a full frontend audit. Ordered by priority. Each item states what's broken,
> the evidence, and what the frontend expects.

---

## P0 — Broken behavior the frontend currently works around

### 1. `GET /api/gtfs/stops` is capped at 50 stops
- **Evidence:** the full dataset has 1,082 stops; the endpoint returns 50 even with `?limit=2000`.
- **Impact:** any consumer relying on this endpoint sees <5% of the network (this is what made Gatenga disappear from the app).
- **Fix:** return the full dataset, or implement real pagination (`?limit=&offset=` honored, `total` in the response).
- Frontend currently ships the full dataset as a static file to bypass this.

### 2. Duplicate stops in the stops data
- **Evidence:** `GET /api/stops?lat=-1.9536&lng=30.0605&limit=100` returns e.g. **"Kubkurunziza North" three times** with distinct IDs (`1000000658`, `1000000066`, `1000000494`) all within ~100 m.
- **Impact:** doubled/tripled pins on the map; inflated "nearby stops" results.
- **Fix:** dedupe at ingestion. Suggested rule (same one the frontend now applies): merge records whose **normalized names match** (case/punctuation-insensitive) within ~60 m; **never** merge stops with different names — paired directional stops ("Gatenga" / "Gatenga East") legitimately sit meters apart.

### 3. Route ID scheme is inconsistent across endpoints
- **Evidence:** live vehicles report `routeId: "route-101"`, but `/gtfs/routes` uses `"101"`, and `GET /routes/route-101/shape` → 404 while `/routes/101/shape` → 200.
- **Impact:** joining a live vehicle to its route/shape/sequence fails.
- **Fix:** pick ONE form (recommend bare `"101"`) and use it in vehicles, routes, shapes, sequences, incidents.
- Frontend currently strips the `route-` prefix as a workaround.

### 4. Field naming is inconsistent across endpoints
- **Evidence:**
  - vehicles: `lng`, `routeId`
  - stops (`/api/stops`): `lat`, `lon`
  - hubs & search/suggest: `latitude`, `longitude`
  - incidents (SSE): `vehicleId`, `incidentType`; incident POST accepts `vehicle_id`, `type`
- **Impact:** every mismatch silently broke a frontend feature (live tracking died from exactly this — `parseFloat(undefined)` dropped every vehicle).
- **Fix:** standardize one convention API-wide (recommend `lat`/`lon` + `snake_case`), version the API (`/api/v2/...`) if changing in place.

### 5. SSE stream defaults to `(0, 0)` when `lat`/`lng` are omitted
- **Evidence:** docs list `lat`/`lng` as required with default 0; omitting them yields a stream that never contains a Kigali bus, with no error.
- **Impact:** a client that forgets the params gets a silently-empty stream forever.
- **Fix:** default to Kigali center (`-1.9536, 30.0605`, radius ≥ 15000), or reject with 400.

---

## P1 — Features the frontend has UI for, waiting on the backend

### 6. Per-route viewer counts over SSE
- The frontend listens for a frame shaped `{ "viewers": { "101": 5, "105": 12 } }` on the SSE stream and will show real "N watching" counts the moment it arrives. Until then the badge is simulated client-side.
- You already track `activeSSEConnections` — extend to per-route by counting subscribers whose selected route matches.

### 7. `type: "missing_stop"` on `POST /api/incidents/report`
- The search UI's "Can't find your stop? Report it" now POSTs `{ type: "missing_stop", client_id: "search-report", description: "Missing stop reported from search: \"<query>\"" }`.
- Please accept and log this type (don't 400 on unknown types — log-and-accept is safer for forward compat).

### 8. `GET /api/incidents/active`
- Incidents are currently only delivered via SSE, so anyone connecting after a report never sees it.
- Add a snapshot endpoint returning currently-active (non-expired) incidents so late joiners catch up; frontend will call it on connect.

### 9. Real per-route colors in `/gtfs/routes`
- **Evidence:** every route returns `"color": "#00a896"`.
- The frontend hardcodes brand colors for routes 101/102/105 because of this. Ship real distinct colors per route (GTFS `routes.txt` has a `route_color` column) and the frontend can drop its hardcoded map.

### 10. Verify broadcasts actually influence arrival ETAs
- Docs claim the ETA engine prioritizes crowdsourced pings over the static schedule.
- **Test to run:** POST a `/realtime/broadcast` ping for route 101 near Camp Kigali, then `GET /stops/24626202/arrivals` (CHUK, next stop downstream) — the response should include that vehicle with elevated `confidence`. If it doesn't, the core crowdsourcing loop is decorative.

---

## P2 — Operational / scale improvements

### 11. Cold starts (Render free tier)
- The frontend carries a "server waking up, ~15s" UX purely because of this. A cron warm-ping every 10 min, or the paid tier, removes a whole class of failures (and lets us delete retry complexity later).

### 12. SSE connection cap (100) won't scale
- For growth: move realtime to a managed pub/sub (e.g. Ably/Pusher/Supabase Realtime) **or** switch to plain HTTP snapshot polling with `Cache-Control: max-age=5` behind a CDN — cacheable snapshots scale horizontally for free and the frontend already has the polling path built.

### 13. `/api/status` telemetry accuracy
- `averageApiLatencyMs: 0` looks unimplemented. The frontend now displays this panel to users (Settings → System Health) — either report real numbers or omit the field.

### 14. Stop ID unification (longer-term)
- There are two stop-ID spaces (GTFS numeric IDs and `/api/stops` IDs). Both currently resolve on `/arrivals` and `/gtfs/stops/:id/routes`, which is good — please keep that guarantee, and document it. The frontend maintains a coordinate-matching `stopIdMap` as a defensive layer that could be deleted once one canonical ID space is guaranteed.

---

## Canonical shapes the frontend expects (after standardization)

```jsonc
// Vehicle (SSE frame and /vehicles/live)
{ "id": "bus-101-a", "route_id": "101", "lat": -1.9452, "lon": 30.0610,
  "spd": 34, "brg": 142, "occupancy": "seats", "plate": "RAG 402 D" }

// SSE incident frame
{ "type": "incident:alert",
  "incidents": [{ "vehicle_id": "bus-101-a", "route_id": "101",
                  "type": "route_changed", "message": "..." }] }

// SSE viewers frame
{ "viewers": { "101": 5, "105": 12 } }

// Stop (everywhere)
{ "id": "24626187", "name": "Camp Kigali", "lat": -1.94346, "lon": 30.05725, "type": "stop" }
```

*(The frontend tolerates today's mixed shapes via normalizers, but each normalizer is
tech debt we want to delete once the API standardizes.)*

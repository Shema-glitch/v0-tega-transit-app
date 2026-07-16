# Project Log — read this first if you're picking the project back up

This is a running log of what's been done, why, and what's still open. Newest
entry on top. If you've been away for a while, read the latest entry, then
skim "Open items" at the bottom before doing anything else.

---

## 2026-07-16 — Route ID + field naming standardized (the two items deliberately deferred on 07-13)

**Why now:** you shared `docs/PROJECT_LOG_FROM FRONTEND.md` (the frontend dev's own
session log, from the separate `BusGo_Track` repo). It showed the frontend's
`normalizeVehicles()` already defensively accepts every field-name variant
(`lng`/`lon`/`longitude`, `routeId`/`route_id`) and already strips a `route-`
prefix if present. That means the two API changes flagged as "breaking, needs
sign-off" on 07-13 are actually **zero-risk** — the live consumer was already
built to tolerate exactly this transition. You said "do it if there won't be a
crash on the frontend" — confirmed there won't be, then did it.

**What changed** (see `docs/BACKEND_HANDOFF.md` §"Canonical shapes" for the
target — this is now what's live):

- **Route IDs are bare everywhere** (`"101"`, not `"route-101"`). New
  `bareRouteId()` helper in `lib/api/geo.ts`. The mock/simulation data
  (`lib/kigali-gtfs.ts`) still uses `"route-101"` internally, but it's now
  stripped at every boundary that talks to a client: `realtime-hub.ts`'s tick
  output, and the crowdsourced-ping ingest in `realtime/broadcast/route.ts`
  (which now normalizes whatever a broadcaster sends — `"101"` or
  `"route-101"` — before storing, so matching against the simulation is
  robust either way).
- **Vehicle shape standardized**: `routeId`→`route_id`, `lng`→`lon`, across
  `HubVehicle` (realtime-hub.ts), `VehicleSchema` (validation.ts),
  `/api/vehicles/live`, and the SSE `vehicle:update` frames (including delta
  compression, which now compares on `.lon`).
- **Incident shape standardized**: `ActiveIncident` (live-store.ts) and every
  producer/consumer of it renamed to `vehicle_id`/`route_id`/`type`/
  `destination_stop_id`/`lon` — `/api/incidents/report` (write),
  `/api/incidents/active` (read, plus `reported_at` as ISO string), and the
  SSE `incident:alert` frame.
- **Stop shape standardized**: every stop-shaped response
  (`/api/stops`, `/api/gtfs/stops`, `/api/gtfs/hubs`, `/api/search/suggest` via
  `spatial.service.ts`) now returns `{ id, name, lat, lon, type }` — hubs get
  `type: "hub"`, everything else `type: "stop"`. `/api/gtfs/hubs` and
  `spatial.service.ts` previously used `latitude`/`longitude`; also dropped an
  internal `_distM` field that was leaking into `/api/stops` responses.
- **Deliberately left alone**: `/api/stops/{id}/arrivals`'s arrival objects
  (`vehicleId`, `routeId`, `etaMin`, etc.) — not part of the canonical shapes
  the frontend documented, and not evidenced as broken. Also left
  `/api/arrivals` (deprecated) and its `lib/kigali-gtfs.ts` mock data
  untouched — dead code path, out of scope.

**Verification:** `tsc --noEmit` clean. Ran a local dev server against the
*real* Supabase project this time (there's now a `.env.local` — wasn't there
in earlier sessions) — Supabase itself was unreachable from this sandbox
(DNS resolution failure on the project subdomain specifically, not a code
issue; `/api/stops` and `/api/gtfs/hubs` fell back to stale/local-CSV paths as
designed). What *did* verify end-to-end: broadcast a crowdsourced ping using
the **old** `"route-101"` form → `/api/vehicles/live` correctly matched it to
the simulated bus for route 101 and returned it with the **new** bare
`"route_id":"101"` and `"lon"` field, using the broadcasted position instead
of the random simulated one — proof the bare-ID matching and the field rename
both work through the full ingest → hub → API pipeline. Also directly
sampled the SSE stream and got correctly-shaped `vehicle:update`,
`viewer:counts` (keyed by bare route ID), and `incident:alert` frames.

**Not yet done:** pushing this to `main` / confirming with you it's live — see
top of this file for current status if you're reading this cold.

---

## 2026-07-13 — API refactor, dead UI removed, status dashboard added, live bugs fixed

**Context going in:** this repo is API-only now — the real production frontend
lives in a separate repository. What was in `app/`, `components/`, `hooks/`
here was a leftover mock UI (v0-generated), not used in production, and was
just cluttering an otherwise real, in-use API.

**What got done, roughly in order:**

1. **Architecture review** of the whole API surface (18 route handlers under
   `app/api/`). Found the data flow was split across four inconsistent
   sources: Supabase (real), local GTFS CSVs (real, fallback), hardcoded mock
   data in `lib/kigali-gtfs.ts` (still powering `/api/arrivals` and parts of
   the realtime simulation), and an in-process `LiveVehicleStore` singleton
   for crowdsourced pings.

2. **Performance fixes** (the actual point of the refactor):
   - `lib/api/stops-cache.ts` — new hourly in-memory cache of the Supabase
     `stops` table. Before this, `/api/stops`, `/api/gtfs/hubs`, and
     `/api/stops/{id}/arrivals` each did a full-table fetch **per request**
     just to do proximity math in JS.
   - `lib/api/gtfs-parser.ts` — GTFS CSVs (`trips.txt`, `stop_times.txt`,
     `stops.txt`, `routes.txt`) are now parsed once and kept in memory, with
     a `stop_id → route_ids` index built lazily. Before: `/api/gtfs/stops/[id]/routes`
     was reading and parsing 3 CSV files synchronously on every hit.
   - `lib/api/realtime-hub.ts` — **new**. One shared simulation/ingest loop
     per process instead of every SSE connection running its own
     `setInterval` and re-simulating bus positions independently (so with N
     clients you got N different simulated realities). `/api/vehicles/live`
     now reads the exact same snapshot the SSE stream broadcasts, so REST
     polling and the live stream never disagree.
   - `lib/api/geo.ts`, `lib/api/cors.ts` — pulled 5 copy-pasted haversine
     implementations and 4 copy-pasted CORS header blocks into one place
     each.
   - `LiveVehicleStore` (in `lib/api/live-store.ts`) pinned onto
     `globalThis` via a `Symbol.for(...)` key — Next.js can bundle a module
     separately per route, which previously risked the broadcast-ingest
     route and the SSE-read route getting *different* store instances.
   - **Still a real limitation:** all of the above in-memory state is
     per-process. It works for a single Render instance but will silently
     break the moment this runs multi-instance/serverless (a ping lands on
     instance A, an SSE reader on instance B never sees it). If/when this
     needs to scale horizontally, that state has to move to Redis or
     Supabase Realtime channels — noted but not done.

3. **Dead UI removed.** Deleted `components/`, `hooks/`, `app/settings/`,
   `lib/api.ts` (client-side API wrapper), `lib/mock-data.ts`, `lib/utils.ts`,
   `components.json`, `styles/`. Stripped `package.json` from ~30 UI
   dependencies (Mapbox, all Radix packages, framer-motion, recharts,
   react-hook-form, etc.) down to the 9 the API actually needs
   (`@supabase/supabase-js`, `csv-parse`, `pg`, `zod`, `dotenv`, `next`,
   `react`/`react-dom` + `autoprefixer` for the status page). Also removed
   the now-dead `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` from `render.yaml`.

4. **`app/page.tsx` replaced with a developer status dashboard** — since the
   repo has no real frontend of its own, `/` is now a page that lists every
   API endpoint grouped by category (System / Stops & Arrivals / GTFS Static
   / Realtime / Deprecated), runs a live health check against each one on
   load, shows status/latency/response preview per endpoint, and has a
   button to open the actual SSE stream and watch frames arrive for 8
   seconds. This was **your suggestion** mid-session and it's the right call
   for an API-only repo — much more useful than a blank page or a 404.

5. **Found `docs/BACKEND_HANDOFF.md`** (already in the working tree,
   uncommitted, compiled from real production-frontend probes against the
   live API) and fixed everything in it that was safe to fix without
   breaking the separate frontend's existing contract:
   - `/api/gtfs/stops` was hard-capped at 50 results regardless of `?limit`
     — now supports real `limit`/`offset` pagination (max 2000) and returns
     `total`.
   - Stop deduplication was merging *any* two stops within 50m regardless of
     name — which risked incorrectly collapsing legitimately distinct paired
     stops ("Gatenga" vs "Gatenga East"). Fixed to require a normalized name
     match **and** proximity.
   - `GET /api/realtime/sse` went silently empty forever if a client omitted
     `lat`/`lng` — now defaults to Kigali city center.
   - `POST /api/incidents/report` used to 400 on any incident type outside a
     3-value enum, which blocked the frontend's "missing_stop" report
     feature. Now accepts any type (logs unrecognized ones instead of
     rejecting), and made `vehicle_id`/coordinates optional since a
     "missing stop" report has neither.
   - Added `GET /api/incidents/active` — a snapshot endpoint so a client
     connecting after an incident was reported can still see it (previously
     incidents only ever went out over the SSE stream, so late joiners never
     saw anything already in flight).
   - SSE viewer-count frames now include a `viewers` key (in addition to the
     original `counts` key) — matches what the frontend is actually listening
     for.
   - `/api/status`'s `averageApiLatencyMs` was permanently 0 because nothing
     ever recorded latency. Wired up real tracking
     (`lib/api/telemetry.service.ts: withLatencyTracking`) on `/api/stops`,
     `/api/stops/{id}/arrivals`, and `/api/vehicles/live`.

6. **Deliberately did NOT fix**, because they'd break the live separate
   frontend's existing contract without your sign-off:
   - **Route ID scheme inconsistency** — live vehicles use `"route-101"`,
     `/gtfs/routes` uses bare `"101"`. `docs/BACKEND_HANDOFF.md` recommends
     picking one (bare `"101"`).
   - **Field naming inconsistency** — `lat/lng` vs `lat/lon` vs
     `latitude/longitude` depending on endpoint. Doc recommends standardizing
     on `lat`/`lon` + `snake_case`, versioning the API if changed in place.
   - Both are real, documented bugs. Whenever you're ready to take these on,
     it's a breaking-change/versioning decision, not a quick fix — see
     `docs/BACKEND_HANDOFF.md` items #3 and #4 for the full writeup and the
     "canonical shapes" section at the bottom of that doc for the target
     shape.

7. **Verification done:** `tsc --noEmit` clean, `pnpm install` resolves
   clean (switched off `npm install` after peer-dep conflicts — **this repo
   uses pnpm**, not npm; there's a stray untracked `package-lock.json` in the
   working tree from an earlier `npm install` attempt, harmless, not
   committed, safe to delete or ignore). Ran a local dev server and smoke
   tested: pagination on `/api/gtfs/stops`, the `missing_stop` incident flow
   end-to-end, `/api/incidents/active`, the SSE stream's Kigali-center
   default, and that `/api/vehicles/live` and the SSE stream report
   consistent vehicle positions. Supabase-backed endpoints 500 in this local
   sandbox only because there's no `.env.local` here — expected, unrelated to
   any of these changes.

8. **Committed and pushed to `main`** (`f281842..6bd8868`). Render
   auto-deploys from `main` per `render.yaml`, so that push should have
   triggered a live deploy. Note: GitHub shows a `Vercel` status check as
   "failure" on that commit — that's Vercel's own integration complaining it
   can't verify the commit author account (commit was made with a local git
   identity matching your GitHub account, not a Vercel-linked one). It does
   **not** affect Render, which deploys off its own GitHub webhook. Ignore it
   unless this repo is also actually deployed via Vercel somewhere.

---

## Open items / where to pick up next

- [x] ~~Decide on route ID scheme~~ — done 2026-07-16, standardized on bare
      `"101"` everywhere. See dated entry above.
- [x] ~~Decide on field naming standardization~~ — done 2026-07-16,
      standardized on `lat`/`lon` + snake_case. See dated entry above.
- [ ] **Real per-route colors** — `/api/gtfs/routes` returns `#00a896` for
      every route because `route_color` appears to be empty/null in the
      imported GTFS data itself. This is a data problem, not a code problem
      — needs a look at the GTFS import/`routes.txt` data quality, not
      another code fix. (`/api/routes`, the other routes endpoint, already
      returns real colors when the DB has them.)
- [ ] **Multi-instance scalability** — `LiveVehicleStore` and
      `realtime-hub.ts` are in-memory singletons. Fine for one Render
      instance; will silently misbehave the moment this scales
      horizontally. Move to Redis/Supabase Realtime if/when that happens.
- [ ] **Cold starts on Render free tier** — noted in
      `docs/BACKEND_HANDOFF.md` #11 but not actioned. A cron warm-ping every
      ~10 min or upgrading the Render tier removes this.
- [ ] Stray untracked `package-lock.json` at repo root — leftover from a
      failed `npm install` attempt, not used (this repo is pnpm), safe to
      delete whenever.
- [ ] `public/manifest.json` is now stale PWA metadata for the deleted mock
      UI and nothing references it anymore — low priority cleanup, harmless
      as-is.

---

## Quick orientation if you're totally cold

- **Repo type:** Next.js 16 app, but functionally it's an API service —
  `app/page.tsx` is a developer status dashboard, not a product frontend.
  The real frontend is a separate repo.
- **Data sources:** Supabase Postgres (primary, GTFS tables imported from
  `kigali_gtfs/*.txt`), with local-CSV fallback on a few endpoints, plus
  some legacy hardcoded mock data in `lib/kigali-gtfs.ts` still used by the
  deprecated `/api/arrivals` endpoint and as a fallback in the realtime
  simulation.
- **Realtime:** `lib/api/realtime-hub.ts` runs one shared tick loop;
  `/api/realtime/sse` and `/api/vehicles/live` both read from it.
  Crowdsourced pings come in via `POST /api/realtime/broadcast` into
  `lib/api/live-store.ts`'s `LiveVehicleStore` singleton.
- **Package manager:** pnpm (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Don't
  use `npm install` — it'll hit peer-dependency conflicts with the ESLint 10
  toolchain.
- **Deploy:** Render.com, auto-deploys `main` (see `render.yaml`). No CI gate
  currently — a push to `main` goes live.
- **Also read:** `docs/BACKEND_HANDOFF.md` for the still-open, real bugs
  reported by the live frontend; `docs/API_DOCS.md` / `docs/DEPLOYMENT_GUIDE.md`
  for reference (not verified for staleness this session).

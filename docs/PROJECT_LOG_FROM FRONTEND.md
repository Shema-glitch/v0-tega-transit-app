# BusGo Track — Project Status & Session Journal

> **Purpose of this file:** Open this whenever you come back to the project (or start a new
> Claude Code session) to remember where you left off, what's been done, what's pending,
> and how everything is set up. Keep it updated at the end of each work session.
>
> **Last updated:** 2026-07-14

---

## 1. Where things stand RIGHT NOW

- **Current branch:** `ux/mobile-usability` (pushed to origin, working tree clean)
- **Latest commit:** `d2a9021` — feat(ux): tour spotlight, single navbar CTA, returning users skip landing
- **Your next action:** Test the `ux/mobile-usability` branch locally (`cd frontend; npm run dev`).
  If you like it → merge into `main`:
  ```
  git checkout main
  git merge ux/mobile-usability
  git push
  ```
- **You explicitly deferred:** mobile search improvements — "the search on mobile is not good
  but I'll look into it after". See §5 for notes already gathered on it.
- **Tests:** 31 passing (`cd frontend; npm test`). **Lint:** 16 warnings left, all pre-existing
  set-state-in-effect patterns (down from 32 at project start). **Build:** clean.

---

## 2. What the project is

Kigali bus-tracking web app ("Tega Transit"). Frontend-only SPA:

- **Stack:** React 18 + Vite (rolldown-vite v8), Mapbox GL via react-map-gl, framer-motion, Tailwind, Vitest
- **Backend API:** `https://tega-transit-api.onrender.com/api` (Render free tier → cold starts up to ~15s, SSE capped at 100 connections). Maintained by a separate backend developer.
- **App state machine:** one `appState` string — ONBOARDING / DISCOVERY / SEARCH / STOP_DETAIL / ROUTE_DETAIL / SETTINGS (in `AppContext.jsx`)
- **Context nesting:** ToastProvider > AppProvider > GeolocationProvider > TransitProvider
- **Repo:** `Shema-glitch/BusGo_Track`, pushes go through your GitHub CLI credentials.
  Repo-local git identity: `Ismail-Nd <ndismail007@gmail.com>`
- ⚠️ **`docs/` is gitignored** (`.gitignore` line 14) — use `git add -f docs/<file>` to commit anything there.

---

## 3. Branch history — what each commit did

### On `ux/mobile-usability` (current, awaiting your test + merge)

**`d2a9021` — tour spotlight, single navbar CTA, returning users skip landing**
- **Map tutorial truly highlights elements** (`components/TutorialTour.jsx`, full rewrite):
  no more dashed box — an animated spotlight cutout (giant box-shadow trick) tracks real
  elements found via `data-tour="map|search|controls"` attributes; card auto-places in the
  opposite screen half; new EN/RW/FR copy.
- **Landing navbar de-clustered on mobile** (`landing/Navbar.jsx`): the duplicate
  arrow-icon + "Open App" buttons merged into one responsive CTA.
- **Returning users skip the landing page** (`Root.jsx`): once onboarded, you go straight
  to the app; `?landing` in the URL forces the marketing page back (for demos/sharing).
- **Hero phone mockup** (`landing/HeroSection.jsx`): now shows a stylized live-tracking
  preview (route path, pulsing bus, arrival card) instead of generic placeholder.
- Cleaned 7 pre-existing lint errors in ContextMenu / DiscoveryOverlay.

**`0e32a98` — touch targets, back-button history, sheet gesture separation** (top-3 UX fixes)
- **44px+ touch targets everywhere** — map stop dots/hubs wrapped in 44–48px invisible
  buttons, padded `queryRenderedFeatures` hit-testing (15px) in `MapboxWrapper.jsx`,
  bigger clear/expand buttons in SearchMatrix + LiveActivityFeed.
- **Android back button works** (`context/AppContext.jsx`): history stack mirrors app
  states via pushState/popstate, so back navigates STOP_DETAIL → DISCOVERY instead of
  exiting the site.
- **Bottom sheet drags only by its handle** (`components/BottomSheet.jsx`):
  `useDragControls` + `dragListener={false}` — scrolling the list no longer accidentally
  drags the sheet. Fling down: full → mid → collapsed peek → close.

### On `main`

**`c4bd79e` — pinned routes, favourite stops, map guide; remove all mock UI**
- All placeholders/mock data removed (you approved these decisions):
  - RouteDetailOverlay de-mocked — occupancy/bus info only from real `broadcasterInfo`;
    "Shared by a rider on this bus" attribution; real viewer counts from SSE.
  - Settings System Health is real (`api.system.getStatus()`), with a
    "Server unreachable — may be waking up" state.
  - Legend became a **Map Guide info section in Settings** (7 entries) — as you asked.
- New features: pin a route for live-arrival toasts (`togglePinnedRoute`), favourite stops
  (star in sheet header + list in Settings), ETA feedback thumbs (logged to Sentry).
- **`docs/BACKEND_HANDOFF.md`** written — the P0/P1/P2 API fix list for your backend
  developer (canonical JSON shapes, evidence from live probes). *Hand this to them.*

**`65eac62` — restore live tracking and full stops network** (the big production fixes)
Three stacked bugs had killed live tracking; all fixed client-side:
1. Server sends `lng`/`routeId`, client only parsed `lon`/`route_id` → every vehicle
   dropped as NaN. → `normalizeVehicles()` in `lib/transit.js` accepts all variants and
   strips the `route-` prefix.
2. SSE connected without coordinates → server defaulted to (0,0)+2km → zero Kigali buses.
   → `connectRealtimeSSE` now defaults to Kigali center, 15km radius (`lib/api.js`).
3. `/gtfs/stops` silently caps at 50 stops (that's why Gatenga & others vanished).
   → app loads the bundled `kigali_stops.json` (1,082 stops) first, API as fallback.
- **Stops dedup is now name-aware** (`dedupeStops` in `lib/transit.js`): only merges stops
  with the same normalized name within ~66m — your old blind 50m dedup was deleting real
  distinct neighbors (the Gatenga regression). There's a unit test locking this in:
  *"NEVER merges differently-named neighbors"*.
- Snapshot polling fallback (`/vehicles/live` every 20s) when SSE isn't connected.

**`03fe61c` — architecture refactor** (no behavior change)
- `lib/storage.js` — every localStorage key goes through a typed KEYS registry.
- `lib/config.js` — API base URL + Sentry DSN, env-overridable.
- `lib/transit.js` — pure helpers extracted (normalize, dedup, distance, colors).
- Code-splitting: landing 44kB / app 163kB / vendor 444kB / mapbox-gl 1.76MB lazy chunk.
- Vitest set up; 31 tests across transit/formatters/search.

---

## 4. Key files map (where to look for what)

| Area | File |
|---|---|
| App state machine + back-button history | `frontend/src/context/AppContext.jsx` |
| Live vehicles, SSE, stops loading, pins/favs | `frontend/src/context/TransitContext.jsx` |
| API client, SSE, Kigali-center defaults | `frontend/src/lib/api.js` |
| Pure helpers: normalize, name-aware dedup | `frontend/src/lib/transit.js` (+ `.test.js`) |
| localStorage keys | `frontend/src/lib/storage.js` |
| Map, circle layers, padded tap hit-testing | `frontend/src/components/MapboxWrapper.jsx` |
| Bottom sheet (handle-only drag) | `frontend/src/components/BottomSheet.jsx` |
| Tutorial spotlight tour | `frontend/src/components/TutorialTour.jsx` |
| Settings: System Health, Map Guide, favs | `frontend/src/components/SettingsOverlay.jsx` |
| Landing gate / returning-user skip | `frontend/src/Root.jsx` |
| Landing navbar (single CTA) | `frontend/src/landing/Navbar.jsx` |
| Backend fix list for API developer | `docs/BACKEND_HANDOFF.md` (gitignored dir!) |

Elements tagged for the tutorial tour: `data-tour="search"` (DiscoveryOverlay A-to-B pill),
`data-tour="controls"` (App.jsx mobile strip + ContextMenu desktop stack).

---

## 5. TODO / Pending

**Yours:**
- [ ] Test `ux/mobile-usability` locally → merge to `main` when happy
- [ ] Hand `docs/BACKEND_HANDOFF.md` to the backend developer (frontend has workarounds
      for all P0s, but real fixes belong server-side: field naming `lng/lon/longitude`,
      `route-` prefix, the 50-stop cap on `/gtfs/stops`, SSE default location)

**Deferred by you (next up when ready):**
- [ ] **Mobile search improvements** — notes so far: staggered result animations make fast
      typing feel laggy; the on-screen keyboard likely covers half the results list
- [ ] Remaining UX-audit items (4–6): 12px minimum type + contrast tokens; consolidate
      bottom-left FABs / swipe-to-dismiss the live feed; non-modal cold-start banner
      (instead of full-screen overlay); explicit language picker instead of cycling button

**Deliberately parked (needs its own branch/session):**
- [ ] TanStack Query migration / splitting the TransitContext god-context
      (tests now exist as a safety net for it)

---

## 6. Workflow & environment notes

- **Branching (agreed):** small tweaks straight on a shared UX branch; anything big gets
  its own `feat/...` branch; merge to `main` after you've tested and liked it.
- **Run locally:** `cd frontend` first — npm scripts live there, not repo root.
  `npm run dev` / `npm test` / `npm run lint` / `npm run build`.
- **MCP:** 21st.dev server added (`claude mcp list` → connected); tools load in new sessions.
- **Windows quirks:** shell cwd can reset between commands (always `cd frontend`);
  Python needs Windows-style paths, not `/c/...` or `/tmp`.

---

## 7. Session log

| Date | What happened |
|---|---|
| ~2026-07 (session 1) | Architecture audit → refactor (`03fe61c`): storage/config modules, code-splitting, Vitest |
| same session | Performance audit: fixed Live Activity crash, pin-route in production, legend→Settings info |
| same session | Diagnosed & fixed live tracking (3 stacked prod bugs) + Gatenga stops regression (`65eac62`) |
| same session | De-mocked all UI, wrote backend handoff, committed (`c4bd79e`) |
| same session | UX audit → top-3 fixes on `ux/mobile-usability` (`0e32a98`) |
| 2026-07-12 | Tour spotlight, navbar CTA merge, landing skip for returning users (`d2a9021`); added 21st.dev MCP |
| 2026-07-14 | Created this PROJECT_STATUS.md |

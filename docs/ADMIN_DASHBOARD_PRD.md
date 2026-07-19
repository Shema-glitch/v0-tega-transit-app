# Admin Dashboard — Product Requirements

**Status:** v1 implemented
**Owner:** solo maintainer (no team, no on-call rotation)
**Related:** `docs/API_DOCS.md`, `docs/CHECKLIST.md` (§9 Maintenance & Monitoring)

## 1. Problem

The public status page (`/`) was built incrementally, feature by feature, as each need came up: a health-check grid, then an SSE monitor, then an error panel, then a bug-report panel. Individually each piece works. As a whole it's a generic "is it up" page that happens to have some admin actions bolted onto it via `window.prompt()`. Specifically, it's missing:

1. **A real kill switch.** The existing "maintenance flag" only *displays* a banner — no endpoint actually checks it. Toggling it in the UI doesn't stop the frontend from calling that endpoint; it just tells you the toggle is on. There's no way to actually cut the frontend off from a specific broken endpoint while you fix it.
2. **One place to see what's broken.** Technical errors (`/api/errors`) and rider bug reports (`/api/feedback`) are two separate panels with two separate mental models. Nothing unifies "everything I need to look at today" into one triaged list.
3. **A real login.** Every admin action independently does `sessionStorage.getItem('admin-token') || window.prompt(...)`. There's no single "you are now in admin mode" state — it's death by a thousand prompts.
4. **Anything else being an admin tool needs**: search/filter, resolve-and-move-on workflows, a sense of "what's new since I last looked."

## 2. Goals

- **G1 — Real enforcement.** Disabling an endpoint from the dashboard must actually make the frontend get a clear error from that endpoint, not just show a banner nobody's code reads.
- **G2 — One inbox.** Errors and bug reports triaged together: filter, search, mark resolved, see counts.
- **G3 — One login.** A dedicated `/admin` route gated by the admin token, entered once per session, not re-prompted per action.
- **G4 — Keep the public page public.** `/` stays a lightweight, unauthenticated "is the API healthy" page for anyone (including future teammates) to sanity-check. Admin power tools do not leak into it.

## Non-goals (v1)

- Multi-admin / role-based access (it's a solo maintainer; one shared token is enough for now).
- Durable (Supabase-backed) maintenance flags — v1 keeps them in-memory, same as today, and this doc calls that out as a known limitation (§6).
- Alerting/paging (Slack, email, SMS) — out of scope; this is a pull, not a push, tool.
- Historical analytics/charts — v1 is about the *current* state (what's broken right now), not trends over time.

## 3. Users

Just one: **you**, checking in from a phone or laptop, sometimes mid-incident ("something's broken, what is it, can I turn it off without a full redeploy"), sometimes routine ("anything I should know about since yesterday").

## 4. Features

### P0 — Endpoint kill switch (actually enforced)

- A canonical registry of every toggleable endpoint (`lib/api/endpoint-registry.ts`), independent of the ad-hoc test catalog on the public page.
- `middleware.ts` checks this registry against `MaintenanceStore` on every request; a disabled endpoint returns `503` with a JSON body (`{ error, reason, since }`) **before the route handler ever runs**. The frontend genuinely loses access — this is the difference between "the banner says maintenance" and "the endpoint is actually down."
- Meta/admin endpoints (`/api/health`, `/api/status`, `/api/errors`, `/api/feedback`, `/api/admin/*`) are intentionally excluded from the toggle list — you can't lock yourself out of the tool that turns things back on.

### P0 — Unified issues feed

- One feed merging `ErrorEntry` (technical failures) and `BugReport` (rider feedback), sorted newest-first.
- Filter tabs: All / Errors / Bug Reports / Open only.
- Search box (matches path, message, or subject).
- Per-item action: mark resolved (bug reports) or clear (errors), inline, no page reload.
- Counts badge in the nav for "open" items — the number you actually care about at a glance.

### P0 — Real login

- `/admin` checks for a token in `sessionStorage` on load; if absent or invalid, shows a login screen (not a browser `window.prompt()`).
- A lightweight `GET /api/admin/verify` endpoint exists purely to validate a token immediately at login time, instead of only discovering it's wrong when an action fails.
- Logout clears the session token.

### P1 — Endpoint control panel

- Every registry endpoint listed with a toggle switch, grouped the same way as the existing catalog (Stops & Arrivals / GTFS Static / Realtime / Deprecated).
- Toggling off prompts for a reason (shown to anyone who hits the disabled endpoint, and in the maintenance banner elsewhere in the app).
- Shows who/when for every active flag.

### P1 — Stat bar

- Open bug reports, open errors, endpoints currently disabled, overall status pill (Operational / Degraded / Endpoints disabled).

### Future (not v1)

- Durable maintenance flags (Supabase-backed, same `SECURITY DEFINER` RPC pattern as `api_errors`/`bug_reports`), so a disabled endpoint survives a redeploy instead of resetting.
- Slack/email alert when a new bug report or a burst of errors comes in.
- Per-endpoint request-volume graphs (would need the rate limiter to record counts over time, not just enforce a window).

## 5. Data model additions

No new tables. Reuses `MaintenanceStore` (in-memory) with a changed key convention: **feature keys are now registry `id`s** (e.g. `stops.arrivals`), not raw display paths with query placeholders — the old convention couldn't be reliably matched against an incoming request's pathname.

## 6. Known limitations (accepted for v1)

- **Maintenance flags are in-memory only** — a Render restart/redeploy clears every disabled endpoint back to enabled. Acceptable for "I'm actively firefighting right now"; not for a planned multi-day maintenance window. Tracked as a Future item above.
- **Single shared admin token** — anyone with the token has full access; there's no audit log of who toggled what (there's only one "who," so this is fine for now).
- **Rate limiting is per-process** — if this ever runs on more than one Render instance, each counts independently (documented already in `lib/api/rate-limiter.ts`).

## 7. Success criteria

- Disabling an endpoint from `/admin` and then calling it from the frontend (or curl) returns `503` within the same request cycle — no redeploy needed.
- You can go from "something's wrong" to "here's the specific error or bug report, resolved" in one page, without opening a second tab for `/api/errors` and a third for Supabase.
- Logging into `/admin` happens once per session, not once per click.

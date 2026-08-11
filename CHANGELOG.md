# Changelog

> The detailed, frontend-facing changelog with consumption notes lives in the
> **version log**: [`public/version-log-2026-08-11.html`](public/version-log-2026-08-11.html)
> — it's also served live at `https://tega-transit-api.onrender.com/version-log-2026-08-11.html`
> and embedded in the admin console's **Guide** tab (earlier: [`version-log-2026-08-09.html`](public/version-log-2026-08-09.html)).
> This file is the one-line index of notable releases; the git log is the full
> record (`git log --oneline`).

## 2026-08-11 — Admin console redesign & polish

- Identity & settings: breadcrumbs, sidebar identity footer (email + Admin/Curator badge), Settings tab with **Profile** (display name via migration **0015**) and **Appearance** (Dark/Ivory) cards.
- Two console themes — warm dark (default) + ivory light — following `prefers-color-scheme` until toggled; theme mirrored onto `<html>` so portaled menus/dialogs theme correctly.
- Phosphor icon set replaces Lucide across the app (`@phosphor-icons/react`, consistent `regular` weight; `lucide-react` removed).
- Radius scale softened: `--radius` 0.625rem → 0.75rem (controls 9.6px, cards 16.8px).
- Chrome: solid sticky header, uniform 32px controls, normalized border radii, width-capped forms, per-panel stat cards, kebab menu for utility actions.
- Sidebar: categories reordered (Administration last), footer Links → Account → Log out, static brand lockup, teal active tint; NULL role now counts as admin.
- **Action:** run `supabase/migrations/0015_admin_profile.sql` in Supabase's SQL Editor for display-name saves to persist.

## 2026-08-09 — Scale batch

- Per-endpoint load metrics ring + admin **Load** panel (requests/min, p50/p95 latency, 429 trips, SSE gauge, cache hit rate) with load alerts and a sidebar red-dot when spikes are active.
- TTL cache with single-flight across shapes, sequences, search, routes, and arrivals — steady-state traffic stops hammering Supabase; real `max-age` cache headers.
- Optional Upstash Redis layer: shared cache L2, shared per-IP rate limiter, and live-store **pub/sub** so SSE subscribers span multiple instances.
- SSE connection cap via `MAX_SSE_CONNECTIONS`; type errors now fail the Render build.
- `pnpm load-test:scale` — concurrent search + arrivals + SSE load test with cache hit-rate reporting.

## 2026-08-08 — Admin console (durable)

- Durable admin console: invite/revoke admins, **15-minute idle session expiry** with an 8-hour cap and kill-reasons, Render-style uptime bars, shadcn sidebar, audit log persisted to Supabase.
- Supabase magic-code login (`/goToAdminAuth`) + HttpOnly session cookies, OTP error boundaries, redesigned login, square favicon.
- Dialog-driven endpoint disabling (real 503s via middleware), toasts, skeletons, motion polish; secret Debug Mode trigger + embedded maintenance guide tab.
- Rider-submitted stop suggestions with an admin review queue; admin write endpoints for the stops table; every admin-only RPC locked to `service_role`.

## Earlier

- Rebuilt the UI on shadcn/ui (removed the clay design-token system).
- CORS fix for the frontend origin; Vercel integration fully removed (Render is the deploy target) — see `docs/DEPLOYMENT_GUIDE.md`.

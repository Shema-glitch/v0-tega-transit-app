# BusGo Track API Deployment Guide

This backend is built with Next.js and configured specifically for Render.com:
`output: 'standalone'` in `next.config.js` and a `render.yaml` blueprint are
already in the repo, so deployment is essentially plug-and-play.

**Render.com is the only deployment target for this repository.** The repo was
previously also connected to a Vercel project (linked to an account that
doesn't own this GitHub repo), which produced a long tail of failed Vercel
deployments on every push. Nothing in this repo deploys to Vercel anymore —
see "Stopping the Vercel integration" below if those failures are still
showing up in GitHub's checks.

---

## Deploying on Render.com

Render is the right host for this API: Server-Sent Events (SSE) need
long-lived persistent connections, which Render's containers handle without
the timeout limits of serverless functions.

### Steps to Deploy on Render:

1. **Push to GitHub**: make sure the project is committed and pushed to a
   GitHub repository.
2. **Create a Render account** at [Render.com](https://render.com) and sign up
   with GitHub.
3. **Use the Blueprint (zero-config)**:
   - On the Render dashboard click **New +** → **Blueprint**.
   - Connect your GitHub account and select this repository
     (`v0-tega-transit-app`).
   - Render auto-detects `render.yaml` and provisions the web service.
   - Click **Apply**.
4. **Set environment variables** (Render → service → **Environment** tab).
   The keys are declared in `render.yaml` with `sync: false`, so you must add
   them manually:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_SUPABASE_CONNECTION_STRING`
   - `ADMIN_TOKEN`
   - `ADMIN_SESSION_SECRET`
   - `ADMIN_EMAILS`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REDIS_URL` (optional — Upstash Redis, see “Redis” below)
5. **Done.** Render runs `pnpm install && pnpm build` and starts the API with
   `pnpm start`. You get a URL like `https://tega-transit-api.onrender.com`.
   Every push to `main` auto-deploys via Render's GitHub webhook.

---

## ⚠️ SSE and hosting notes

Server-Sent Events keep HTTP connections open for a long time. Render uses
persistent containers, so the SSE connection stays open without dropping —
which is exactly what a realtime streaming API needs.

The SSE endpoint caps concurrent connections (default 250, override with
`MAX_SSE_CONNECTIONS`) as a defensive OOM guard. Per-client state is a few
KB, so a few hundred riders fit fine on a standard instance.

---

## Scaling & hardening

### How this app is built to scale (and why it's single-instance)

Every request starts with three cheap in-memory layers before anything hits
Supabase:

1. **Middleware** counts every request into a per-endpoint metrics ring
   (see the admin console's **Load** section) and enforces the per-IP rate
   limiter.
2. **The TTL cache** (`lib/api/ttl-cache.ts`) serves GTFS static data
   (routes, shapes, sequences, search suggestions) from memory with
   single-flight — concurrent callers share ONE Supabase query per key.
   Arrivals get a 5-second micro-cache for the same reason.
3. **Boot-time in-memory caches** (`stops-cache`, `gtfs-parser`) already
   hold the stops table and parsed GTFS CSVs.

Net effect: the hot search/shape/route endpoints stop hammering Postgres;
`Cache-Control` also carries `max-age` now, so returning riders' browsers
skip the server entirely.

The trade-off: this app is **deliberately single-instance**. Request
metrics, the realtime simulation, and telemetry live in one process. That
is fine — one beefy instance beats two anemic ones for this workload.
`render.yaml` keeps `maxInstances: 1` on purpose.

Two layers are already shared, so **scaling to N instances is now mostly
safe** (both require `REDIS_URL` set):

- **Rate limiter** — shared per-IP budget via atomic Redis INCR + NX-EXPIRE
  (`lib/api/rate-limiter.ts`). N instances count as ONE abuse budget.
- **Live vehicle store** — broadcast pings + incident reports fan out to
  every instance via Redis pub/sub (`lib/api/live-sync.ts`), so SSE
  subscribers on any instance see vehicles reported anywhere.

What remains per-instance (acceptable, cosmetic or connection-local): the
vehicle **simulation** (each instance runs its own demo fallback),
**viewer counts** (count only the clients connected to that instance —
correct by nature), and the **metrics window** (per-process request ring; a
load balancer distributes traffic evenly). Uptime history is already
Supabase-persisted (`lib/api/uptime-store.ts`).

### Instance sizing

The free Render instance (512 MB / 0.1 CPU) sleeps after ~15 min idle, so
the first request after a gap pays a cold start — bad for a transit status
page. On a paid instance, uncomment the `scaling:` block in `render.yaml`
(minInstances: 1) to keep it always-on, and raise `MAX_SSE_CONNECTIONS`
(e.g. 500) for hundreds of concurrent riders.

### Redis (optional, recommended once you scale)

Set `REDIS_URL` (Upstash REST URL) and `UPSTASH_REDIS_REST_TOKEN` and the
API automatically upgrades two things:

- **TTL cache gets a shared L2** — memory is the L1 fast path (single-flight),
  Redis is the L2. A Redis hit warms memory and skips Supabase entirely;
  cache warmth survives restarts and spans multiple instances.
- **Rate limiter becomes shared** — the per-IP window is an atomic INCR +
  NX-EXPIRE key, so N instances count as ONE abuse budget (the prerequisite
  for horizontal scaling).
- **Live store fan-out** — broadcast pings and incident reports publish to
  Redis channels (`tega:live-vehicle`, `tega:incident`) and every instance
  applies them to its local store, so realtime subscribers span instances
  (`lib/api/live-sync.ts`). Pub/sub is ephemeral: an instance that is down
  when an event fires never replays it — fine here, since pings expire
  after 5 minutes and the next ping re-syncs.

The admin console's **Load** section shows a `redis shared` badge when
connected — and `redis shared · pub/sub` once the live-store bridge is up. Without the env vars, or if Redis is unreachable, everything
degrades to the in-memory behavior automatically — an outage never breaks
reads.

### Putting a CDN/WAF in front (when abuse or traffic justifies it)

The in-app rate limiter stops scripts and single-IP scraping, but not a
distributed (multi-IP) DDoS — that needs Cloudflare or similar in front of
Render. The `s-maxage`/`stale-while-revalidate` directives in
`lib/api/cache.service.ts` are already CDN-friendly: point the DNS at
Cloudflare and GET caching kicks in automatically. Keep `no-cache` on
realtime/status/SSE (already the case).

---

## Stopping the Vercel integration

The failed deployments you see on GitHub come from Vercel's own GitHub App
integration, which was linked to this repo under a different Vercel account.
Deleting the Vercel project stops new deploys, but the **app can still be
installed** on the repo, and the deployment records it already created stay
behind in GitHub. Removing the whole thing takes three steps, all in GitHub:

1. **Delete the deployment environments Vercel created** — the "deployments
   latched onto the repo".
   Repo → **Settings → Environments** → delete every `vercel-*` entry
   (each one may have a "Delete this environment" link at the bottom of its
   page). This clears the deployment list/records on the repo.

2. **Remove the Vercel GitHub App's access to this repo** — this stops it from
   posting any new status checks on pushes/PRs.
   GitHub → **Settings → Applications** (account level) → under *Installed
   GitHub Apps* find **Vercel** → **Configure** → deselect this repository
   under *Repository access*, or **Uninstall** the app entirely. The Vercel
   project itself was already deleted, so there is nothing left to disconnect
   on Vercel's side.

3. **Drop any required "Vercel" check** (only if branch protection demands
   it). Repo → **Settings → Branches** → edit the protection rule for
   `main` → remove `Vercel` from *Require status checks to pass before
   merging*.

Old failed `Vercel` checks on **past** commits stay in the history (GitHub
never rewrites past check records), but no new ones will appear after steps
1–2, and only the Render deployment status remains going forward.

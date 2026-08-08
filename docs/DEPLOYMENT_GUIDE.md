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
5. **Done.** Render runs `pnpm install && pnpm build` and starts the API with
   `pnpm start`. You get a URL like `https://tega-transit-api.onrender.com`.
   Every push to `main` auto-deploys via Render's GitHub webhook.

---

## ⚠️ SSE and hosting notes

Server-Sent Events keep HTTP connections open for a long time. Render uses
persistent containers, so the SSE connection stays open without dropping —
which is exactly what a realtime streaming API needs.

---

## Stopping the Vercel integration

The 49+ failed deployments you may see on GitHub come from Vercel's own
GitHub App integration, which is still linked to this repo under a different
Vercel account. That link lives **outside** this repository, so unlink it in
one of these places:

- **Vercel dashboard** (sign in with the account that owns the stale project):
  open the project → **Settings → Git** → **Disconnect Git repository**
  (or just delete the project if it's unused). Any deploys it has queued will
  stop.
- **GitHub → Settings → Applications** (the account that owns the repo):
  find **Vercel** → **Configure** → restrict it to only the repositories that
  should auto-deploy, or revoke access entirely.

After that, GitHub stops showing the failing `Vercel` status check and only
the Render deployment status remains.

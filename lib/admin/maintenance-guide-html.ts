/**
 * Self-contained HTML/CSS/JS maintenance & QA guide, sourced from
 * BusGo_Track/FEATURES_MAINTENANCE_AND_QA_GUIDE.md (the frontend repo).
 *
 * Rendered inside an <iframe srcDoc={...}> on the /admin dashboard's
 * "Maintenance Guide" tab — NOT a public static file. It only reaches a
 * browser after the surrounding AdminPage component has already verified
 * ADMIN_TOKEN, unlike frontend/public/guide.html (the *rider-facing* guide,
 * deliberately public with no admin content at all — do not confuse the two).
 *
 * Checklist state persists per-browser via localStorage so progress survives
 * a reload/relogin. Update this string when the source .md changes; it's a
 * plain copy, not generated.
 */

export const MAINTENANCE_GUIDE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maintenance &amp; QA Guide</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0a0b;
    --card: #151517;
    --border: #27272a;
    --text: #e4e4e7;
    --dim: #9a9aa2;
    --accent: #6d8dfc;
    --accent-bg: rgba(109, 141, 252, 0.15);
    --good: #4ade80;
    --good-bg: rgba(74, 222, 128, 0.15);
    --warn: #fbbf24;
    --warn-bg: rgba(251, 191, 36, 0.15);
    --fe: #38bdf8;
    --fe-bg: rgba(56, 189, 248, 0.15);
    --be: #c084fc;
    --be-bg: rgba(192, 132, 252, 0.15);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 20px;
  }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); margin: 28px 0 10px; }
  h2:first-of-type { margin-top: 0; }
  p { margin: 0 0 8px; }
  .subtitle { color: var(--dim); font-size: 12.5px; margin-bottom: 18px; }
  .tabs {
    display: flex; gap: 4px; border-bottom: 1px solid var(--border);
    margin-bottom: 18px; overflow-x: auto;
  }
  .tab-btn {
    background: none; border: none; color: var(--dim); font: inherit; font-weight: 600;
    padding: 9px 14px; cursor: pointer; white-space: nowrap; border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab-btn.active { color: var(--text); border-bottom-color: var(--accent); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .badge {
    display: inline-block; font-size: 10.5px; font-weight: 700; padding: 2px 7px;
    border-radius: 4px; margin-right: 6px; vertical-align: middle;
  }
  .badge-fe { color: var(--fe); background: var(--fe-bg); }
  .badge-be { color: var(--be); background: var(--be-bg); }
  .badge-both { color: var(--accent); background: var(--accent-bg); }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 10px;
  }
  .card summary { cursor: pointer; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 4px; }
  .card summary::-webkit-details-marker { display: none; }
  .card summary::before { content: "▸"; color: var(--dim); font-size: 11px; transition: transform .15s; }
  .card[open] summary::before { transform: rotate(90deg); }
  .card .body { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); color: var(--text); }
  .card .body p { margin: 0 0 8px; }
  .card .body strong { color: var(--text); }
  .card .body .label { color: var(--dim); font-weight: 600; }
  .gotcha {
    background: var(--warn-bg); border: 1px solid rgba(251,191,36,0.3); border-radius: 8px;
    padding: 8px 10px; margin-top: 8px; font-size: 12.5px;
  }
  .gotcha strong { color: var(--warn); }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 4px; }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--border); }
  th { color: var(--dim); font-weight: 600; }
  ol.steps { padding-left: 20px; margin: 8px 0; }
  ol.steps li { margin-bottom: 3px; }
  .checklist-section { margin-bottom: 22px; }
  .checklist-section h3 {
    font-size: 12.5px; font-weight: 700; margin: 0 0 8px; color: var(--text);
    display: flex; align-items: center; gap: 8px;
  }
  .check-row {
    display: flex; align-items: flex-start; gap: 9px; padding: 7px 4px;
    border-radius: 6px; cursor: pointer;
  }
  .check-row:hover { background: rgba(255,255,255,0.03); }
  .check-row input { margin-top: 3px; width: 15px; height: 15px; accent-color: var(--good); flex-shrink: 0; cursor: pointer; }
  .check-row span { font-size: 13px; }
  .check-row.checked span { color: var(--dim); text-decoration: line-through; }
  .progress-wrap {
    position: sticky; top: 0; background: var(--bg); padding: 10px 0 14px; z-index: 5;
    border-bottom: 1px solid var(--border); margin-bottom: 16px;
  }
  .progress-bar-track { height: 8px; background: var(--border); border-radius: 5px; overflow: hidden; }
  .progress-bar-fill { height: 100%; background: var(--good); border-radius: 5px; transition: width .2s; }
  .progress-label { font-size: 12px; color: var(--dim); margin-bottom: 6px; display: flex; justify-content: space-between; }
  .reset-btn {
    background: none; border: 1px solid var(--border); color: var(--dim); border-radius: 6px;
    padding: 4px 9px; font: inherit; font-size: 11.5px; cursor: pointer;
  }
  .reset-btn:hover { color: var(--text); border-color: var(--dim); }
  .env-note { color: var(--dim); font-size: 12px; margin-top: 10px; }
  .repo-tag { color: var(--dim); }
</style>
</head>
<body>

<h1>Directions, Live-Bus Tap &amp; Community Editing</h1>
<p class="subtitle">Maintenance &amp; QA guide · two repos: <span class="repo-tag mono">BusGo_Track</span> (frontend, Vercel) + <span class="repo-tag mono">v0-tega-transit-app</span> (backend, Render). Checklist progress saves automatically in this browser.</p>

<div class="tabs">
  <button class="tab-btn active" data-tab="overview">Overview</button>
  <button class="tab-btn" data-tab="frontend">Frontend</button>
  <button class="tab-btn" data-tab="backend">Backend</button>
  <button class="tab-btn" data-tab="qa">QA Checklist</button>
</div>

<!-- ===================== OVERVIEW ===================== -->
<div class="tab-panel active" id="panel-overview">
  <h2>Required environment variables (backend, set on Render)</h2>
  <table>
    <tr><th>Variable</th><th>Used by</th></tr>
    <tr><td class="mono">ADMIN_TOKEN</td><td>Every <span class="mono">/api/admin/*</span> route's auth check</td></tr>
    <tr><td class="mono">SUPABASE_SERVICE_ROLE_KEY</td><td><span class="mono">getSupabaseAdmin()</span> — required for debug-mode stop writes and all admin-only reads/reviews</td></tr>
    <tr><td class="mono">FRONTEND_ORIGIN</td><td>CORS allowlist in <span class="mono">middleware.ts</span> — falls back to <span class="mono">https://busgo-track.vercel.app</span> if unset</td></tr>
  </table>

  <h2>Migrations that must be run manually (Supabase → SQL Editor)</h2>
  <p>Each one, in order, exactly once:</p>
  <ol class="steps">
    <li class="mono">0005_stop_suggestions.sql</li>
    <li class="mono">0006_stop_suggestion_get_one.sql</li>
    <li class="mono">0007_stops_admin_writes.sql</li>
    <li class="mono">0008_harden_function_access.sql</li>
  </ol>
  <p class="env-note">None of these features work without all four applied — this is the single most common way a fresh environment (or a teammate's first deploy) breaks silently.</p>

  <h2>What's in each category tab</h2>
  <p><span class="badge badge-fe">FRONTEND</span> React app in <span class="mono">BusGo_Track</span>, deployed on Vercel — UI, map interactions, client-side logic.</p>
  <p><span class="badge badge-be">BACKEND</span> Next.js API in <span class="mono">v0-tega-transit-app</span>, deployed on Render — routes, Supabase, security.</p>
  <p><span class="badge badge-both">SHARED</span> features that touch both repos are listed in both tabs.</p>
</div>

<!-- ===================== FRONTEND ===================== -->
<div class="tab-panel" id="panel-frontend">

  <h2>Features</h2>

  <details class="card">
    <summary><span class="badge badge-fe">FRONTEND</span> 1. Origin → Destination Directions</summary>
    <div class="body">
      <p>Searching a destination matches you to a real bus — board here, ride N stops, get off there — with a live-updating walk to your boarding stop.</p>
      <p><span class="label">Where it lives:</span></p>
      <ul>
        <li><span class="mono">frontend/src/lib/journey.js</span> — matching logic (<span class="mono">findNearestStop</span>, <span class="mono">distanceToStop</span>, <span class="mono">findConnectingRoutes</span>). Pure, framework-free, tested in <span class="mono">journey.test.js</span>. No backend changes needed.</li>
        <li><span class="mono">frontend/src/components/DirectionsOverlay.jsx</span> — results screen + live walk-distance re-measurement.</li>
        <li><span class="mono">frontend/src/components/MapboxWrapper.jsx</span> — draws the road-snapped walking line, frames the camera on <span class="mono">DIRECTIONS</span> state.</li>
        <li><span class="mono">frontend/src/components/SearchMatrix.jsx</span> — <span class="mono">handleSelectStop</span> branches on <span class="mono">searchIntent</span>.</li>
      </ul>
      <p><span class="label">To change something common:</span></p>
      <ul>
        <li>Arrival threshold ("You've reached X"): <span class="mono">DirectionsOverlay.jsx</span>, the <span class="mono">meters &lt;= 25</span> check.</li>
        <li>Matching logic (e.g. multi-stop transfers): <span class="mono">journey.js</span>'s <span class="mono">findConnectingRoutes</span> — currently single-direct-route by design; transfers are a real scope increase.</li>
        <li>Walking-line styling: <span class="mono">MapboxWrapper.jsx</span>, the <span class="mono">walking-route-line</span> Layer.</li>
      </ul>
      <div class="gotcha"><strong>Known gotcha:</strong> none — no backend dependency, no migration.</div>
    </div>
  </details>

  <details class="card">
    <summary><span class="badge badge-fe">FRONTEND</span> 2. Tapping a Live Bus</summary>
    <div class="body">
      <p>Tapping a moving bus dot opens its route directly, auto-picking your nearest boarding stop if location is on.</p>
      <p><span class="label">Where it lives:</span> <span class="mono">frontend/src/components/MapboxWrapper.jsx</span> — <span class="mono">handleVehicleClick</span> and <span class="mono">LiveVehicles</span>'s <span class="mono">onSelect</span> prop.</p>
      <p><span class="label">To change something common:</span> boarding-stop auto-pick reuses <span class="mono">findNearestStop</span> from <span class="mono">journey.js</span>.</p>
      <div class="gotcha"><strong>Known gotcha:</strong> only active while <span class="mono">appState === 'DISCOVERY'</span> — tapping a bus on another screen is intentionally a no-op.</div>
    </div>
  </details>

  <details class="card">
    <summary><span class="badge badge-both">SHARED</span> 3. Debug Mode — Direct Stop Editing (admin-token gated)</summary>
    <div class="body">
      <p>With Debug Mode on and a valid admin token, you can rename, delete, or create stops directly from the map — writes go straight to the live database.</p>
      <p><span class="label">Frontend:</span> <span class="mono">SettingsOverlay.jsx</span> (<span class="mono">DebugModeSettings</span> — toggle + token field), <span class="mono">BottomSheet.jsx</span> (<span class="mono">StopDebugPanel</span>), <span class="mono">MapboxWrapper.jsx</span> (<span class="mono">handleStopLayerClick</span> — tap empty map to create a stop).</p>
      <p><span class="label">Backend:</span> see the Backend tab for the API/RPC side of this feature.</p>
      <div class="gotcha"><strong>Known gotcha (important):</strong> these writes do <em>not</em> use the plain anon Supabase client — see the Backend tab entry for the full explanation.</div>
    </div>
  </details>

  <details class="card">
    <summary><span class="badge badge-both">SHARED</span> 4. Community Stop Suggestions (public, reviewed)</summary>
    <div class="body">
      <p>Any rider can suggest a stop correction. Nothing changes on the live map until an admin approves it.</p>
      <p><span class="label">Frontend:</span> <span class="mono">BottomSheet.jsx</span> (<span class="mono">SuggestFixPanel</span> — shown instead of the debug panel when Debug Mode is off), <span class="mono">DiscoveryOverlay.jsx</span> (pin button that arms one map tap to report a missing stop), <span class="mono">CommunityGuideDialog.jsx</span> (one-time explainer), <span class="mono">lib/api.js</span> (<span class="mono">api.community.suggestStopEdit</span>).</p>
      <p><span class="label">To review suggestions:</span> <span class="mono">/admin</span> dashboard → <strong>Stop Suggestions</strong> tab. Approve or reject each one; nothing is batch-applied.</p>
      <div class="gotcha"><strong>Known gotcha:</strong> RLS story on the backend side (see Backend tab) — <span class="mono">getOne()</span> must go through the <span class="mono">get_pending_stop_suggestion</span> RPC, or approve/reject 404s on a suggestion that visibly exists.</div>
    </div>
  </details>

  <details class="card">
    <summary><span class="badge badge-fe">FRONTEND</span> 5. Duplicate Stop Finder (debug-only)</summary>
    <div class="body">
      <p>Finds stops sitting suspiciously close together <em>regardless of name</em> — the gap the app's own automatic dedup can't catch.</p>
      <p><span class="label">Where it lives:</span> <span class="mono">frontend/src/lib/duplicateStops.js</span> (<span class="mono">findDuplicateClusters</span> — pure, union-find over haversine distance, tested in <span class="mono">duplicateStops.test.js</span>), <span class="mono">frontend/src/components/DuplicateStopsPanel.jsx</span> (UI, reachable via Preferences → Diagnostics → Debug Mode → "Find duplicate stops").</p>
      <p><span class="label">To change something common:</span> default radius is 60m, adjustable live via slider (20–150m). To change the <em>default</em>, edit <span class="mono">useState(60)</span> in <span class="mono">DuplicateStopsPanel.jsx</span>.</p>
      <div class="gotcha"><strong>Known gotcha:</strong> finder only — never writes anything. Deleting a duplicate still goes through the normal debug-mode delete panel, one at a time, on purpose.</div>
    </div>
  </details>

  <details class="card">
    <summary><span class="badge badge-fe">FRONTEND</span> 7. Public Rider's Guide</summary>
    <div class="body">
      <p>A static, self-contained page at <span class="mono">frontend/public/guide.html</span> (deployed at <span class="mono">https://busgo-track.vercel.app/guide.html</span>) explaining the app to riders and community contributors. No admin/debug content — meant to be handed out.</p>
      <p><span class="label">To update it:</span> edit <span class="mono">frontend/public/guide.html</span> directly — single self-contained HTML file (fonts embedded as data URIs, no build step, no external requests). Edit the deployed file directly going forward.</p>
      <p><span class="label">To share it:</span> <span class="mono">/admin</span> dashboard header → "Copy community guide link" button.</p>
    </div>
  </details>

  <h2>Regression checks (frontend)</h2>
  <ul>
    <li><span class="mono">npm test</span> in <span class="mono">frontend/</span> — all passing, no new failures</li>
    <li><span class="mono">npm run build</span> — completes without errors</li>
  </ul>
</div>

<!-- ===================== BACKEND ===================== -->
<div class="tab-panel" id="panel-backend">

  <h2>Features</h2>

  <details class="card">
    <summary><span class="badge badge-both">SHARED</span> 3. Debug Mode — Direct Stop Editing (backend side)</summary>
    <div class="body">
      <p><span class="label">Where it lives:</span> <span class="mono">app/api/admin/stops/route.ts</span> (POST, create) and <span class="mono">app/api/admin/stops/[id]/route.ts</span> (PATCH/DELETE), both gated by the <span class="mono">x-admin-token</span> header. Writes live in <span class="mono">lib/api/stops-admin.ts</span> (<span class="mono">createStopRow</span>/<span class="mono">updateStopRow</span>/<span class="mono">deleteStopRow</span>).</p>
      <div class="gotcha">
        <strong>Known gotcha (important):</strong> these writes do <em>not</em> use the plain anon Supabase client. The live <span class="mono">stops</span> table has RLS enabled with no permissive policy for the anon key — direct writes fail with "new row violates row-level security policy." Writes go through <span class="mono">SECURITY DEFINER</span> functions (<span class="mono">admin_create_stop</span>, <span class="mono">admin_update_stop</span>, <span class="mono">admin_delete_stop</span> — migration <span class="mono">0007</span>) called via the <strong>service-role</strong> client (<span class="mono">getSupabaseAdmin()</span> in <span class="mono">lib/supabase-server.ts</span>), never <span class="mono">getSupabaseServer()</span>. Any new stop-writing path must call <span class="mono">getSupabaseAdmin()</span> + one of these RPCs — never <span class="mono">.from('stops').insert(...)</span> directly, or it silently fails in production.
      </div>
    </div>
  </details>

  <details class="card">
    <summary><span class="badge badge-both">SHARED</span> 4. Community Stop Suggestions (backend side)</summary>
    <div class="body">
      <p><span class="label">Where it lives:</span> <span class="mono">app/api/stops/suggest/route.ts</span> (public POST, no token — rate-limited as a write endpoint), <span class="mono">app/api/admin/stop-suggestions/route.ts</span> (GET, review queue), <span class="mono">app/api/admin/stop-suggestions/[id]/route.ts</span> (PATCH, approve/reject — approving replays the same <span class="mono">stops-admin.ts</span> write functions used by direct debug edits).</p>
      <p><span class="label">Data:</span> <span class="mono">stop_suggestions</span> table, migration <span class="mono">0005</span> (+ fixes in <span class="mono">0006</span>).</p>
      <div class="gotcha"><strong>Known gotcha:</strong> same RLS story — <span class="mono">getOne()</span> (fetch a single pending suggestion before approving) must go through the <span class="mono">get_pending_stop_suggestion</span> RPC (migration <span class="mono">0006</span>), not a direct table query, or approve/reject 404s on a suggestion that visibly exists in the queue.</div>
    </div>
  </details>

  <details class="card" open>
    <summary><span class="badge badge-be">BACKEND</span> 6. Security Model — Admin-Only Database Functions</summary>
    <div class="body">
      <p>This isn't a feature so much as a rule the whole backend now follows, added after a real vulnerability was caught (migration <span class="mono">0008</span>).</p>
      <p><span class="label">The rule:</span> every <span class="mono">SECURITY DEFINER</span> Postgres function that does anything admin-only (read bug reports/errors/suggestions, resolve/clear them, write to <span class="mono">stops</span>) is granted <span class="mono">EXECUTE</span> to <span class="mono">service_role</span> <strong>only</strong> — never <span class="mono">anon</span>/<span class="mono">authenticated</span>. Only the genuinely public, rider-facing functions (<span class="mono">submit_bug_report</span>, <span class="mono">submit_stop_suggestion</span>, <span class="mono">log_api_error</span>) keep the anon grant.</p>
      <p><span class="label">Why it matters for future work:</span> the anon Supabase key is public — it ships to every browser as <span class="mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>. If a new admin-only RPC is ever added without this lockdown, anyone who extracts that key could call it directly via <span class="mono">/rest/v1/rpc/&lt;function_name&gt;</span>, completely bypassing the <span class="mono">ADMIN_TOKEN</span> check in the route handler.</p>
      <div class="gotcha"><strong>Rule for new admin functions:</strong> any new admin-only database function must be added to migration pattern <span class="mono">0008</span> (revoke anon/authenticated, grant service_role) in the same PR that creates it — not as an afterthought.</div>
      <p><span class="label">Where it lives:</span> <span class="mono">lib/supabase-server.ts</span> (<span class="mono">getSupabaseAdmin()</span>), <span class="mono">supabase/migrations/0008_harden_function_access.sql</span>.</p>
    </div>
  </details>

  <h2>Required environment variables (Render)</h2>
  <table>
    <tr><th>Variable</th><th>Used by</th></tr>
    <tr><td class="mono">ADMIN_TOKEN</td><td>Every <span class="mono">/api/admin/*</span> route's auth check</td></tr>
    <tr><td class="mono">SUPABASE_SERVICE_ROLE_KEY</td><td><span class="mono">getSupabaseAdmin()</span> — required for debug-mode stop writes and all admin-only reads/reviews</td></tr>
    <tr><td class="mono">FRONTEND_ORIGIN</td><td>CORS allowlist in <span class="mono">middleware.ts</span> — falls back to <span class="mono">https://busgo-track.vercel.app</span> if unset</td></tr>
  </table>

  <h2>Migrations (Supabase → SQL Editor, run once, in order)</h2>
  <ol class="steps">
    <li class="mono">0005_stop_suggestions.sql</li>
    <li class="mono">0006_stop_suggestion_get_one.sql</li>
    <li class="mono">0007_stops_admin_writes.sql</li>
    <li class="mono">0008_harden_function_access.sql</li>
  </ol>
  <p class="env-note">Known unfixable-on-hosted-Supabase linter finding: <span class="mono">public.spatial_ref_sys</span> (a PostGIS system table) shows an RLS-disabled warning. It's owned by the postgis extension, not by any role available on a hosted project — <span class="mono">ALTER TABLE</span> on it fails with "must be owner of table spatial_ref_sys." Documented Supabase false positive; no app data lives there.</p>

  <h2>Regression checks (backend)</h2>
  <ul>
    <li><span class="mono">npx vitest run</span> — all passing</li>
    <li><span class="mono">npx tsc --noEmit</span> — no type errors</li>
    <li><span class="mono">npx next build</span> — completes, <span class="mono">/admin</span> and all <span class="mono">/api/*</span> routes listed</li>
  </ul>
</div>

<!-- ===================== QA CHECKLIST ===================== -->
<div class="tab-panel" id="panel-qa">
  <div class="progress-wrap">
    <div class="progress-label">
      <span id="progress-text">0 / 0 checked</span>
      <button class="reset-btn" id="reset-btn">Reset all</button>
    </div>
    <div class="progress-bar-track"><div class="progress-bar-fill" id="progress-fill" style="width:0%"></div></div>
  </div>

  <p class="env-note" style="margin-bottom:18px;">Use after any deploy touching the features above, or periodically as a health check. Ordered so each step's prerequisites are already confirmed by the step before it. Checked state is saved in this browser only.</p>

  <div class="checklist-section">
    <h3><span class="badge badge-be">BACKEND</span> A. Environment sanity (do this first, always)</h3>
    <label class="check-row"><input type="checkbox" data-id="a1"><span>Backend health check responds: <span class="mono">GET /api/health</span> → <span class="mono">"status": "healthy"</span>, <span class="mono">"database": "connected"</span></span></label>
    <label class="check-row"><input type="checkbox" data-id="a2"><span><span class="mono">SUPABASE_SERVICE_ROLE_KEY</span> is set on Render (Dashboard → the service → Environment)</span></label>
    <label class="check-row"><input type="checkbox" data-id="a3"><span><span class="mono">ADMIN_TOKEN</span> is set on Render and matches what you're testing with</span></label>
    <label class="check-row"><input type="checkbox" data-id="a4"><span>All 4 migrations (<span class="mono">0005</span>–<span class="mono">0008</span>) have been run in Supabase SQL Editor</span></label>
  </div>

  <div class="checklist-section">
    <h3><span class="badge badge-fe">FRONTEND</span> B. Directions (no login/token needed)</h3>
    <label class="check-row"><input type="checkbox" data-id="b1"><span>Open the app, allow location</span></label>
    <label class="check-row"><input type="checkbox" data-id="b2"><span>Tap "Get Directions," search a real destination stop</span></label>
    <label class="check-row"><input type="checkbox" data-id="b3"><span>A matched route appears with a stop count and ETA — not just a bare list of stops</span></label>
    <label class="check-row"><input type="checkbox" data-id="b4"><span>Walking distance/time updates as you move — it isn't frozen at the initial number</span></label>
    <label class="check-row"><input type="checkbox" data-id="b5"><span>Search a destination with genuinely no direct route → honest "no direct bus" message + fallback list, not an error or silent empty screen</span></label>
  </div>

  <div class="checklist-section">
    <h3><span class="badge badge-fe">FRONTEND</span> C. Live bus tap</h3>
    <label class="check-row"><input type="checkbox" data-id="c1"><span>With at least one bus actively broadcasting, tap its dot on the map</span></label>
    <label class="check-row"><input type="checkbox" data-id="c2"><span>Its route opens directly (not a blank/generic screen)</span></label>
    <label class="check-row"><input type="checkbox" data-id="c3"><span>If location is on, a boarding stop is pre-selected on that route</span></label>
  </div>

  <div class="checklist-section">
    <h3><span class="badge badge-both">SHARED</span> D. Debug mode (needs ADMIN_TOKEN)</h3>
    <label class="check-row"><input type="checkbox" data-id="d1"><span>Preferences → Diagnostics → toggle Debug Mode on, paste the admin token, Save</span></label>
    <label class="check-row"><input type="checkbox" data-id="d2"><span>Open any real stop → rename/delete controls appear (not "Suggest a fix")</span></label>
    <label class="check-row"><input type="checkbox" data-id="d3"><span>Rename a <strong>test</strong> stop → confirm the new name persists after closing and reopening</span></label>
    <label class="check-row"><input type="checkbox" data-id="d4"><span>Tap empty map area → prompted for a name → new stop appears immediately</span></label>
    <label class="check-row"><input type="checkbox" data-id="d5"><span>Delete that same test stop → confirm it's gone from search afterward</span></label>
    <label class="check-row"><input type="checkbox" data-id="d6"><span>Preferences → Diagnostics → "Find duplicate stops" → list renders, tapping an entry jumps to that stop's detail sheet</span></label>
  </div>

  <div class="checklist-section">
    <h3><span class="badge badge-both">SHARED</span> E. Community stop suggestions (no token needed for submission)</h3>
    <label class="check-row"><input type="checkbox" data-id="e1"><span>With Debug Mode <strong>off</strong>, open a stop → "Suggest a fix" is visible instead of rename/delete</span></label>
    <label class="check-row"><input type="checkbox" data-id="e2"><span>Submit a wrong-name suggestion → success toast, stop's real name is <strong>unchanged</strong> on the map</span></label>
    <label class="check-row"><input type="checkbox" data-id="e3"><span>Log into <span class="mono">/admin</span> → Stop Suggestions tab → the submitted suggestion appears</span></label>
    <label class="check-row"><input type="checkbox" data-id="e4"><span>Approve it → disappears from the queue AND the stop's name actually changes on the live map</span></label>
    <label class="check-row"><input type="checkbox" data-id="e5"><span>Submit a second test suggestion, <strong>reject</strong> it → disappears from queue, map untouched</span></label>
    <label class="check-row"><input type="checkbox" data-id="e6"><span>Tap the map-pin "report missing stop" button, tap a spot, submit → same approve/reject checks as above</span></label>
  </div>

  <div class="checklist-section">
    <h3><span class="badge badge-both">SHARED</span> F. Admin dashboard</h3>
    <label class="check-row"><input type="checkbox" data-id="f1"><span><span class="mono">/admin</span> login screen rejects a wrong token, accepts the real one</span></label>
    <label class="check-row"><input type="checkbox" data-id="f2"><span>Issues tab loads without error</span></label>
    <label class="check-row"><input type="checkbox" data-id="f3"><span>Endpoints tab loads, toggling one and back doesn't error</span></label>
    <label class="check-row"><input type="checkbox" data-id="f4"><span>"Copy community guide link" button copies — confirm URL is <span class="mono">https://busgo-track.vercel.app/guide.html</span>, never anything containing <span class="mono">/admin</span></span></label>
  </div>

  <div class="checklist-section">
    <h3><span class="badge badge-fe">FRONTEND</span> G. Rider's Guide</h3>
    <label class="check-row"><input type="checkbox" data-id="g1"><span>Visit the guide URL directly (logged out, no token) — loads standalone, no admin content visible anywhere</span></label>
    <label class="check-row"><input type="checkbox" data-id="g2"><span>Scroll-spy nav highlights the current section as you scroll</span></label>
    <label class="check-row"><input type="checkbox" data-id="g3"><span>The "Get Directions" interactive walkthrough's 4 tabs all render distinct content</span></label>
    <label class="check-row"><input type="checkbox" data-id="g4"><span>FAQ accordion opens/closes</span></label>
  </div>

  <div class="checklist-section">
    <h3><span class="badge badge-both">SHARED</span> H. Regression pass (run the full existing suites)</h3>
    <label class="check-row"><input type="checkbox" data-id="h1"><span><span class="badge badge-fe" style="margin-right:8px;">FE</span><span class="mono">npm test</span> in <span class="mono">frontend/</span> — all passing, no new failures</span></label>
    <label class="check-row"><input type="checkbox" data-id="h2"><span><span class="badge badge-fe" style="margin-right:8px;">FE</span><span class="mono">npm run build</span> — completes without errors</span></label>
    <label class="check-row"><input type="checkbox" data-id="h3"><span><span class="badge badge-be" style="margin-right:8px;">BE</span><span class="mono">npx vitest run</span> in the API repo — all passing</span></label>
    <label class="check-row"><input type="checkbox" data-id="h4"><span><span class="badge badge-be" style="margin-right:8px;">BE</span><span class="mono">npx tsc --noEmit</span> — no type errors</span></label>
    <label class="check-row"><input type="checkbox" data-id="h5"><span><span class="badge badge-be" style="margin-right:8px;">BE</span><span class="mono">npx next build</span> — completes, <span class="mono">/admin</span> and all <span class="mono">/api/*</span> routes listed</span></label>
  </div>

  <div class="checklist-section">
    <h3>Cleanup after testing</h3>
    <label class="check-row"><input type="checkbox" data-id="z1"><span>Any stop created/renamed for testing (steps D, E) has been deleted via Debug Mode so test data doesn't linger in the real database</span></label>
  </div>
</div>

<script>
(function () {
  var STORAGE_KEY = 'tega-maintenance-qa-checklist-v1';

  // ---- tabs ----
  var tabBtns = document.querySelectorAll('.tab-btn');
  var panels = document.querySelectorAll('.tab-panel');
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabBtns.forEach(function (b) { b.classList.remove('active'); });
      panels.forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ---- checklist persistence ----
  var checkboxes = Array.prototype.slice.call(document.querySelectorAll('.check-row input[type="checkbox"]'));

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — checklist still works this session */ }
  }

  function updateProgress() {
    var total = checkboxes.length;
    var checked = checkboxes.filter(function (cb) { return cb.checked; }).length;
    document.getElementById('progress-text').textContent = checked + ' / ' + total + ' checked';
    document.getElementById('progress-fill').style.width = (total ? (checked / total * 100) : 0) + '%';
  }

  var state = loadState();
  checkboxes.forEach(function (cb) {
    var id = cb.dataset.id;
    if (state[id]) {
      cb.checked = true;
      cb.closest('.check-row').classList.add('checked');
    }
    cb.addEventListener('change', function () {
      state[cb.dataset.id] = cb.checked;
      cb.closest('.check-row').classList.toggle('checked', cb.checked);
      saveState(state);
      updateProgress();
    });
  });
  updateProgress();

  document.getElementById('reset-btn').addEventListener('click', function () {
    if (!window.confirm('Clear all checked items on this checklist?')) return;
    state = {};
    checkboxes.forEach(function (cb) {
      cb.checked = false;
      cb.closest('.check-row').classList.remove('checked');
    });
    saveState(state);
    updateProgress();
  });
})();
</script>
</body>
</html>
`

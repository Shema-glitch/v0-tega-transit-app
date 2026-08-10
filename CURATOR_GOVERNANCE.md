# Curator Governance — Map Editors for BusGo Track

**Status:** Proposed design (backend build target — the admin console and write RPCs live in the API repo, `v0-tega-transit-app`; this doc is the spec to build against).
**Applies to:** API repo (Next.js admin console + Supabase) · rider app (this repo) only for read-side redirects.
**Session target:** the 2pm backend session.

---

## 1. The problem

Riders keep reporting the map is messy: 3–4 stops stacked beside each other, the same physical spot named differently, stops sitting where there is no road. Today only **you** can fix that — the admin console's write endpoints are locked to `service_role`, and the rider app's debug mode is single-token. Meanwhile riders can only *suggest* fixes, which pile into a review queue you must action one by one.

**Goal:** a **curator** tier — a small number of vetted contributors you personally approve, who can see the map with all stops, and **rename, reposition, merge, and mark hubs** directly. Regular riders keep the ticket-only flow. Everything a curator does is audited, reversible, and invisible to the app until it's done.

**Non-goal:** giving any anonymous rider write access. Ever.

---

## 2. What already exists (verified)

| Piece | Where | State |
| --- | --- | --- |
| Suggestion queue (`POST /api/stops/suggest`, types `rename`/`delete`/`add`) | API repo | ✅ live, riders already use it |
| Admin review queue + approve/reject | API repo admin console (Supabase, migration `0006`) | ✅ live |
| Admin write endpoints: `POST /api/admin/stops`, `PATCH /api/admin/stops/{id}`, `DELETE /api/admin/stops/{id}` | API repo | ✅ live, locked to `service_role` |
| Auth: Supabase magic-code login → HttpOnly session cookie, 15-min idle expiry, 8h cap | API repo | ✅ live |
| Audit log persisted to Supabase | API repo | ✅ live |
| Duplicate-stop detector (`findDuplicateClusters` — union-find over haversine, 60m default, tested) | Rider app `frontend/src/lib/duplicateStops.js` | ✅ live, debug-mode only, **never writes** |
| Debug-mode direct edit (single `ADMIN_TOKEN`) | Rider app `frontend/src/lib/api.js` → `api.admin.*` | ✅ live (keep as-is; separate from curator console) |

**Gap:** no role below `admin`, no map UI in the console, no merge operation, no hub concept, no server-side duplicate detection.

---

## 3. Role model

One `admins` table, two roles. Reuse the existing magic-code login + HttpOnly session; the session now carries a role.

| Role | Can | Cannot |
| --- | --- | --- |
| `curator` | See the map + all stops; rename / reposition; **merge** stops; approve/reject stops-scoped suggestions; mark hubs; see audit rows for their own actions | Invite/revoke people, disable endpoints, touch config/load/metrics, hard-delete anything |
| `admin` | Everything, including everything curators can do | — |

- **Grant/revoke** = two RPCs (`admin_add_curator`, `admin_remove_curator`) in the existing People tab, always audit-logged with actor + timestamp. Revoking is immediate (session role is re-read on every request).
- **Middleware:** every admin RPC already checks the session; add a `requires: 'curator' | 'admin'` declarative tag to the existing role gate. Curators get the curator scope, admins get everything.
- **Capacity:** start with 2–3 trusted testers you personally know. Identity comes from the magic-code login (they have an email), so abuse is attributable — that's the whole point of not using a shared code.

---

## 4. Data model (Supabase migrations, next = `0007`)

```sql
-- stops: soft-state + hub + audit trail
ALTER TABLE stops
  ADD COLUMN status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'merged', 'hidden')),
  ADD COLUMN merged_into_id UUID REFERENCES stops(id),
  ADD COLUMN is_hub        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN edited_by     UUID REFERENCES admins(id),
  ADD COLUMN edited_at     TIMESTAMPTZ;

CREATE INDEX stops_status_idx      ON stops (status);
CREATE INDEX stops_merged_into_idx ON stops (merged_into_id);

-- admins: role
ALTER TABLE admins
  ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'curator'));

-- merge journal: the undo + audit record
CREATE TABLE stop_merges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id    UUID NOT NULL REFERENCES stops(id),
  actor_id       UUID NOT NULL REFERENCES admins(id),
  reason         TEXT,
  before_snapshot JSONB NOT NULL,   -- { stop_times: [...ids], sequences: [...] } touched by the merge
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stop_merge_victims (
  merge_id   UUID NOT NULL REFERENCES stop_merges(id) ON DELETE CASCADE,
  victim_id  UUID NOT NULL REFERENCES stops(id),
  PRIMARY KEY (merge_id, victim_id)
);
```

**Merge semantics (the important part):**

1. `POST /api/admin/stops/merge` runs **one transactional RPC**: validate all ids → rewrite every reference to the victims (`stop_times.stop_id`, route sequences, transfers, any **pending suggestions** still pointing at victims → retarget to survivor) → set victims `status='merged'`, `merged_into_id=survivor` → write the `before_snapshot` (the exact reference rows touched) → audit.
2. **Reads never break.** `GET /api/stops`, `/api/gtfs/stops`, and arrivals lookups resolve through `COALESCE(merged_into_id, id)` and filter out `status='merged'`. Old cached stop ids and deep links keep working — this is the only change the rider app needs, and it's server-side SQL, no frontend change.
3. **Undo.** `POST /api/admin/stops/merge/{mergeId}/undo` restores victims from the snapshot (`status='active'`, references rewritten back, survivor untouched). Snapshot retention: 90 days, then the journal row is pruned and the merge becomes permanent.
4. **No hard deletes, ever.** "Delete" in the curator UI = hide + redirect to the nearest active stop (or the chosen merge target). Hard delete stays admin-only and explicit.

---

## 5. API surface to build

All session-authed, all `service_role`, all audit-logged. Existing endpoints marked ✅ stay as-is.

| Endpoint | Method | Purpose | New? |
| --- | --- | --- | --- |
| `/api/admin/stops` | GET | Full stops read for the map (`?include=merged`, with name/lat/lon/status/is_hub/route counts) | **new** |
| `/api/admin/stops/{id}` | PATCH | Rename / move; extend to accept `is_hub` | extend ✅ |
| `/api/admin/stops/merge` | POST | `{ survivorId, victimIds[], reason }` → transactional merge, returns affected counts + redirect map | **new** |
| `/api/admin/stops/merge/{mergeId}/undo` | POST | Restore from snapshot | **new** |
| `/api/admin/stops/{id}/hide` | POST | Soft-hide + redirect to nearest (admin-only) | **new** |
| `/api/admin/stops/{id}/restore` | POST | Un-hide / un-merge a single stop | **new** |
| `/api/admin/suggestions` | GET | Review queue (exists) — scope curator view to stops suggestions | ✅ |
| `/api/admin/suggestions/{id}/approve` · `/reject` | POST | Exists; approve applies the edit through the same RPCs as a curator manual edit | ✅ |
| `/api/admin/curators` | POST/DELETE | Grant / revoke curator role (People tab) | **new** |
| `/api/admin/stops/detect-duplicates` | POST | Server-side port of `findDuplicateClusters` over the full stops table → candidate clusters with affected-stop_times counts, feeding the merge tool's "Suggested merges" pane | **new** |

`POST /api/admin/stops/detect-duplicates` is a straight port of the rider app's tested `findDuplicateClusters` (union-find over haversine, 60m default, radius param) — same algorithm, one function, tested there already.

---

## 6. Admin console UI (API repo, shadcn)

New **"Map & Stops"** tab (curator + admin only):

- **Map view** (Mapbox): every stop plotted — active teal, merged ghosted/dimmed, hubs pinned. Click a stop → edit drawer: rename, reposition (drag on map or lat/lon inputs), toggle hub, hide, or "merge this stop…".
- **Pending suggestions on the map:** rider suggestions render as live overlays so you review them where they matter — `add` shows a pulsing proposed pin at the suggested lat/lon, `rename` shows a badge on the existing stop, `delete` shows a strike/flag on the stop. Click any overlay → the review drawer (approve applies the edit through the same RPCs as a manual edit; reject with a reason). Reviewed overlays clear from the map immediately.
- **Merge mode:** tap a survivor, then tap victims (multi-select), then a confirm panel showing **exactly what will change** — how many `stop_times` rows move, which pending suggestions retarget — before committing. This preview is mandatory; a merge with zero affected rows is pointless and should warn.
- **Suggested merges pane:** fed by `detect-duplicates` + the review queue — "3 stops within 42 m at Kimironko — merge?" One click opens merge mode pre-selected.
- **Suggestions tab:** the list view (exists); add the apply-through-edit behavior so approving a rename/move/delete suggestion does the real edit (curators can approve; admins can too). The map overlay in Map & Stops is the visual twin of this list — same queue, two surfaces.
- **Audit tab:** filterable by actor — curators see their own, admins see all.
- **Nav is role-gated:** curators never see People / Endpoints / Load / Guide.

---

## 7. Safety rails (non-negotiable)

1. **Transactional everything.** A merge is one RPC — no partial states.
2. **Preview before commit** — affected-row counts, always.
3. **Reversible** — 90-day undo snapshot on every merge/hide.
4. **No bulk delete** — hide + redirect only; admin-only hard delete.
5. **Audit everything** — merge, hide, restore, hub toggle, suggestion approve/reject, role grant/revoke.
6. **Rate limits** on public suggest stays; curator endpoints inherit the session/idle-expiry rules.
7. **Attributable identity** — magic-code login means every change has an actor. No shared tokens.

---

## 8. Rollout

1. **Backend (this session):** migration `0007` → merge RPC + read-redirect SQL → role column + role gate → `detect-duplicates` → extend PATCH for `is_hub` → curators endpoints.
2. **Admin console:** Map & Stops tab (map + edit drawer + merge mode + suggested merges), role-gated nav, suggestions apply-through.
3. **Invite 2–3 trusted testers** and run a guided **map-cleaning pass** on the worst corridors: Kacyiru, Nyabugogo, Kimironko, Downtown. Curators fix duplicates/misnames/off-road stops there.
4. **Hubs last.** Flag `is_hub` only once the map is clean, or you'll be flagging wrong stops as hubs.
5. **Frontend:** no rider-app changes needed — read redirects are server-side; the debug `findDuplicateClusters` panel can stay for the rider app's debug mode.

---

## 9. Open questions

- **Suggestion approve/reject for curators:** recommended *yes* (stops-scoped only), audit anyway. Admins retain override. — Confirm.
- **Hub representation:** `is_hub` flag (simplest) vs a separate `hubs` table (cleaner if hubs have their own metadata like terminal name/amenities). Recommend flag now, table later if hubs get rich data.
- **Who can hide:** recommend admin-only; curators *merge* rather than hide. Merge is the constructive fix; hide is the nuclear one.
- **Should curators see the rider-app debug-mode token path?** No — two separate mechanisms; keep them apart.

---

## 10. Where this lands

- This doc: rider repo root (tracked, like `FEATURES_MAINTENANCE_AND_QA_GUIDE.md`). Copy into the API repo's `docs/` when you start the build.
- Existing files to reference during the build: `frontend/src/lib/duplicateStops.js` (algorithm to port), `frontend/src/lib/api.js` → `api.admin.*` + `api.community.suggestStopEdit` (contract), `FEATURES_MAINTENANCE_AND_QA_GUIDE.md` §5 (duplicate finder notes).

-- Curator tier (CURATOR_GOVERNANCE.md) — vetted map editors below full admin.
--
-- Adapts the spec to this repo's real schema: the admin allowlist is the
-- `admin_emails` table (email PK) rather than a separate `admins` table, so
-- the role column lands there; `stops` keys on `stop_id text`; `stop_times`
-- keys on (trip_id, stop_sequence) with stop_id NOT in the PK.
--
-- Semantics (from the spec):
--   * merge   → one transactional RPC: validate → rewrite stop_times refs →
--               retarget pending suggestions → mark victims 'merged' →
--               write the before_snapshot → journal. Reads never break: the
--               read layer resolves COALESCE(merged_into_id, stop_id) and
--               filters hidden/merged.
--   * undo    → restore stop_times + suggestions from the snapshot, reactivate
--               victims, drop the journal row (one-shot).
--   * hide    → admin-only soft-hide (no hard delete ever); restore reactivates.
--   * RPCs are SECURITY DEFINER + service_role-only (0008 lockdown pattern) —
--     the anon key ships to browsers and must never call these directly.
--
-- Run once in Supabase → SQL Editor, same as the other migrations.

-- ── Schema ────────────────────────────────────────────────────────────────

-- `IF EXISTS`: some projects were provisioned before 0009 (admin_emails) —
-- run 0009 first for the role column to land; the stops/curator parts below
-- work regardless.
alter table if exists public.admin_emails
  add column if not exists role text not null default 'admin'
  check (role in ('admin', 'curator'));

alter table public.stops
  add column if not exists status        text not null default 'active'
    check (status in ('active', 'merged', 'hidden')),
  add column if not exists merged_into_id text,
  add column if not exists is_hub        boolean not null default false,
  add column if not exists edited_by     text,
  add column if not exists edited_at     timestamptz;

create index if not exists stops_status_idx      on public.stops (status);
create index if not exists stops_merged_into_idx on public.stops (merged_into_id);
create index if not exists stop_times_stop_id_idx on public.stop_times (stop_id);

-- Merge journal: the undo + audit record.
create table if not exists public.stop_merges (
  id              uuid primary key default gen_random_uuid(),
  survivor_id     text not null,
  actor_id        text not null,
  reason          text,
  before_snapshot jsonb not null,
  created_at      timestamptz not null default now()
);

create table if not exists public.stop_merge_victims (
  merge_id  uuid not null references public.stop_merges(id) on delete cascade,
  victim_id text not null,
  primary key (merge_id, victim_id)
);

alter table public.stop_merges enable row level security;
alter table public.stop_merge_victims enable row level security;
revoke all on table public.stop_merges, public.stop_merge_victims from anon, authenticated;
grant all on table public.stop_merges, public.stop_merge_victims to service_role;

-- ── RPCs ──────────────────────────────────────────────────────────────────

-- Merge victims into a survivor. p_dry_run computes the exact affected counts
-- without writing anything (the UI's preview-before-commit step).
-- Returns a jsonb payload; never raises on validation, always answers
-- { ok, ... } or { ok: false, error }.
create or replace function public.admin_merge_stops(
  p_survivor_id text,
  p_victim_ids text[],
  p_actor text,
  p_reason text,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_victim_ids text[];
  v_merge_id uuid;
  v_survivor_status text;
  v_count int;
  v_affected int := 0;
  v_rewritten int := 0;
  v_suggestions int := 0;
  v_snapshot jsonb;
  v_snapshot_suggestions jsonb;
begin
  -- Survivor must exist and be active.
  select status into v_survivor_status from public.stops where stop_id = p_survivor_id;
  if v_survivor_status is null then
    return jsonb_build_object('ok', false, 'error', 'Survivor stop not found');
  end if;
  if v_survivor_status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Survivor stop is not active (merged or hidden)');
  end if;

  -- Dedupe victims, drop the survivor itself.
  select array_agg(distinct v) into v_victim_ids
    from unnest(p_victim_ids) as t(v)
   where v is not null and v <> p_survivor_id;
  if v_victim_ids is null or array_length(v_victim_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'No victim stops provided');
  end if;

  -- Every victim must exist and be active.
  select count(*) into v_count
    from public.stops
   where stop_id = any(v_victim_ids) and status = 'active';
  if v_count <> array_length(v_victim_ids, 1) then
    return jsonb_build_object('ok', false, 'error', 'One or more victim stops are missing or not active');
  end if;

  -- Before-snapshot: stop_times rows referencing victims + pending suggestions.
  select coalesce(jsonb_agg(
           jsonb_build_object('trip_id', trip_id, 'stop_sequence', stop_sequence, 'stop_id', stop_id)
         ), '[]'::jsonb)
    into v_snapshot
    from public.stop_times
   where stop_id = any(v_victim_ids);
  v_affected := jsonb_array_length(v_snapshot);

  select coalesce(jsonb_agg(
           jsonb_build_object('id', id, 'stop_id', stop_id)
         ), '[]'::jsonb)
    into v_snapshot_suggestions
    from public.stop_suggestions
   where stop_id = any(v_victim_ids) and status = 'pending';

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'survivorId', p_survivor_id,
      'victims', v_victim_ids,
      'affectedStopTimes', v_affected,
      'pendingSuggestions', jsonb_array_length(v_snapshot_suggestions)
    );
  end if;

  -- Rewrite stop_times references. Rows where the survivor already occupies
  -- the same (trip_id, stop_sequence) are left pointing at the victim and
  -- counted as collisions — the read layer still resolves them, so nothing
  -- breaks, and no data is silently dropped.
  update public.stop_times
     set stop_id = p_survivor_id
   where stop_id = any(v_victim_ids)
     and (trip_id, stop_sequence) not in (
       select trip_id, stop_sequence from public.stop_times where stop_id = p_survivor_id
     );
  get diagnostics v_rewritten = row_count;

  -- Retarget pending suggestions that point at victims.
  update public.stop_suggestions
     set stop_id = p_survivor_id
   where stop_id = any(v_victim_ids) and status = 'pending';
  get diagnostics v_suggestions = row_count;

  -- Mark victims merged + survivor edited.
  update public.stops
     set status = 'merged', merged_into_id = p_survivor_id,
         edited_by = p_actor, edited_at = now()
   where stop_id = any(v_victim_ids);
  update public.stops
     set edited_by = p_actor, edited_at = now()
   where stop_id = p_survivor_id;

  -- Journal.
  insert into public.stop_merges (survivor_id, actor_id, reason, before_snapshot)
  values (p_survivor_id, p_actor, p_reason,
          jsonb_build_object('stop_times', v_snapshot, 'suggestions', v_snapshot_suggestions))
  returning id into v_merge_id;

  insert into public.stop_merge_victims (merge_id, victim_id)
  select v_merge_id, unnest(v_victim_ids);

  return jsonb_build_object(
    'ok', true,
    'mergeId', v_merge_id,
    'survivorId', p_survivor_id,
    'victims', v_victim_ids,
    'affectedStopTimes', v_affected,
    'stopTimesRewritten', v_rewritten,
    'collisionsSkipped', v_affected - v_rewritten,
    'pendingSuggestions', jsonb_array_length(v_snapshot_suggestions),
    'suggestionsRetargeted', v_suggestions
  );
end;
$$;

-- Undo a merge from its snapshot: restore stop_times + pending suggestions,
-- reactivate the victims, drop the journal (one-shot undo).
create or replace function public.admin_undo_merge(p_merge_id uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merge public.stop_merges%rowtype;
  v_restored int := 0;
begin
  select * into v_merge from public.stop_merges where id = p_merge_id;
  if v_merge.id is null then
    return jsonb_build_object('ok', false, 'error', 'Merge not found (already undone or pruned)');
  end if;

  -- Restore stop_times rows that were rewritten to the survivor.
  update public.stop_times st
     set stop_id = sn.stop_id
    from jsonb_array_elements(v_merge.before_snapshot->'stop_times') sn
   where sn->>'trip_id' = st.trip_id
     and (sn->>'stop_sequence')::int = st.stop_sequence
     and st.stop_id = v_merge.survivor_id;

  -- Restore pending suggestions retargeted to the survivor.
  update public.stop_suggestions ss
     set stop_id = sn.stop_id
    from jsonb_array_elements(v_merge.before_snapshot->'suggestions') sn
   where ss.id = (sn->>'id')::bigint
     and ss.status = 'pending'
     and ss.stop_id = v_merge.survivor_id;

  -- Reactivate victims.
  update public.stops
     set status = 'active', merged_into_id = null,
         edited_by = p_actor, edited_at = now()
   where stop_id in (select victim_id from public.stop_merge_victims where merge_id = p_merge_id);
  get diagnostics v_restored = row_count;

  delete from public.stop_merge_victims where merge_id = p_merge_id;
  delete from public.stop_merges where id = p_merge_id;

  return jsonb_build_object('ok', true, 'restoredVictims', v_restored);
end;
$$;

-- Admin-only soft-hide (no hard delete ever). Fails if the stop is merged
-- (merge is the constructive fix; hide is for decommissioned stops).
create or replace function public.admin_hide_stop(p_stop_id text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.stops where stop_id = p_stop_id;
  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'Stop not found');
  end if;
  if v_status = 'merged' then
    return jsonb_build_object('ok', false, 'error', 'Merged stops are hidden via undo or merge, not hide');
  end if;
  update public.stops
     set status = 'hidden', edited_by = p_actor, edited_at = now()
   where stop_id = p_stop_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Un-hide a hidden stop (or pull a merged stop back to standalone active).
create or replace function public.admin_restore_stop(p_stop_id text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.stops where stop_id = p_stop_id;
  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'Stop not found');
  end if;
  update public.stops
     set status = 'active', merged_into_id = null,
         edited_by = p_actor, edited_at = now()
   where stop_id = p_stop_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Full patch: rename/move/hub in one call (coalesce semantics like
-- admin_update_stop, plus is_hub + actor audit fields).
create or replace function public.admin_update_stop_full(
  p_stop_id text, p_name text, p_lat double precision, p_lon double precision,
  p_is_hub boolean, p_actor text
) returns setof public.stops
language sql
security definer
set search_path = public
as $$
  update public.stops
  set
    stop_name = coalesce(p_name, stop_name),
    stop_lat  = coalesce(p_lat, stop_lat),
    stop_lon  = coalesce(p_lon, stop_lon),
    is_hub    = coalesce(p_is_hub, is_hub),
    edited_by = p_actor,
    edited_at = now()
  where stop_id = p_stop_id
  returning *;
$$;

-- Lock everything to service_role (0008 pattern) — the anon key must never
-- reach these.
revoke execute on function public.admin_merge_stops(text,text[],text,text,boolean)    from anon, authenticated;
revoke execute on function public.admin_undo_merge(uuid,text)                          from anon, authenticated;
revoke execute on function public.admin_hide_stop(text,text)                           from anon, authenticated;
revoke execute on function public.admin_restore_stop(text,text)                        from anon, authenticated;
revoke execute on function public.admin_update_stop_full(text,text,double precision,double precision,boolean,text) from anon, authenticated;
grant execute on function public.admin_merge_stops(text,text[],text,text,boolean)    to service_role;
grant execute on function public.admin_undo_merge(uuid,text)                          to service_role;
grant execute on function public.admin_hide_stop(text,text)                           to service_role;
grant execute on function public.admin_restore_stop(text,text)                        to service_role;
grant execute on function public.admin_update_stop_full(text,text,double precision,double precision,boolean,text) to service_role;

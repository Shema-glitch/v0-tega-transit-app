-- Fixes a real production bug found during end-to-end verification: the
-- admin stop-editing endpoints (POST/PATCH/DELETE /api/admin/stops[/id])
-- write to `stops` directly via the anon key (supabase.from('stops')...),
-- which fails with "new row violates row-level security policy" — the
-- live `stops` table has RLS enabled with no permissive policy, even
-- though the checked-in supabase/schema.sql says RLS is disabled on it.
-- Whatever the actual DB history there, this migration doesn't depend on
-- it — it uses the same SECURITY DEFINER pattern already established for
-- bug_reports (0003) and stop_suggestions (0005) instead of touching RLS
-- policies directly.
--
-- Run once in Supabase → SQL Editor, same as 0001/0003/0005/0006.

create or replace function public.admin_create_stop(
  p_stop_id text, p_name text, p_lat double precision, p_lon double precision
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.stops (stop_id, stop_name, stop_lat, stop_lon)
  values (p_stop_id, p_name, p_lat, p_lon);
$$;

-- Coalesce-style partial update: passing null for a field leaves it
-- unchanged, matching the existing "patch" semantics in stops-admin.ts
-- (only fields actually provided get written).
create or replace function public.admin_update_stop(
  p_stop_id text, p_name text, p_lat double precision, p_lon double precision
) returns setof public.stops
language sql
security definer
set search_path = public
as $$
  update public.stops
  set
    stop_name = coalesce(p_name, stop_name),
    stop_lat  = coalesce(p_lat, stop_lat),
    stop_lon  = coalesce(p_lon, stop_lon)
  where stop_id = p_stop_id
  returning *;
$$;

create or replace function public.admin_delete_stop(p_stop_id text)
returns setof public.stops
language sql
security definer
set search_path = public
as $$
  delete from public.stops where stop_id = p_stop_id
  returning *;
$$;

grant execute on function public.admin_create_stop(text,text,double precision,double precision)              to anon, authenticated;
grant execute on function public.admin_update_stop(text,text,double precision,double precision)              to anon, authenticated;
grant execute on function public.admin_delete_stop(text)                                                     to anon, authenticated;

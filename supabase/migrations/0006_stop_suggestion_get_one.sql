-- Fixes a bug in 0005: the admin approve/reject route (lib/api/stop-suggestions.ts
-- getOne) was querying `stop_suggestions` directly via `.from(...)` instead of
-- through a SECURITY DEFINER function. RLS on that table has NO policies by
-- design (see 0005), so PostgREST silently returned zero rows for the anon
-- key — every approve/reject failed with "not found" even though the row
-- existed and GET /api/admin/stop-suggestions (which DOES go through the
-- get_pending_stop_suggestions function) could see it fine.
--
-- Run once in Supabase → SQL Editor, same as 0001/0003/0005.

create or replace function public.get_pending_stop_suggestion(p_id bigint)
returns setof public.stop_suggestions
language sql
security definer
set search_path = public
as $$
  select * from public.stop_suggestions
  where id = p_id and status = 'pending';
$$;

grant execute on function public.get_pending_stop_suggestion(bigint) to anon, authenticated;

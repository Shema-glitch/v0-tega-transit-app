-- Rider-submitted stop corrections (community edit mode). Separate from
-- the `stops` table itself — a suggestion is a PROPOSAL, never applied
-- automatically. An admin reviews the pending queue and only then does it
-- become a real write to `stops` (via the existing admin/stops write path).
--
-- Run once in Supabase → SQL Editor, same as 0001/0003.
--
-- Same lockdown pattern as bug_reports (0003): RLS enabled with no
-- policies, anon key only gets in through SECURITY DEFINER functions.

create table if not exists public.stop_suggestions (
  id             bigint generated always as identity primary key,
  type           text        not null check (type in ('add', 'rename', 'delete')),
  -- Null for 'add' (there's no existing stop yet); required for
  -- 'rename'/'delete' (which existing stop this is about).
  stop_id        text,
  proposed_name  text,
  proposed_lat   double precision,
  proposed_lon   double precision,
  reason         text,
  -- Anonymous per-device id (same pattern as incident reports' client_id) —
  -- lets abuse be traced/rate-limited without any real identity.
  client_id      text,
  status         text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz
);

create index if not exists stop_suggestions_status_idx
  on public.stop_suggestions (status, created_at desc);

alter table public.stop_suggestions enable row level security;
-- Intentionally NO policies: all access goes through the functions below.

create or replace function public.submit_stop_suggestion(
  p_type text,
  p_stop_id text,
  p_proposed_name text,
  p_proposed_lat double precision,
  p_proposed_lon double precision,
  p_reason text,
  p_client_id text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.stop_suggestions
    (type, stop_id, proposed_name, proposed_lat, proposed_lon, reason, client_id)
  values
    (p_type, p_stop_id, p_proposed_name, p_proposed_lat, p_proposed_lon, p_reason, p_client_id);
$$;

create or replace function public.get_pending_stop_suggestions(p_limit int default 200)
returns setof public.stop_suggestions
language sql
security definer
set search_path = public
as $$
  select * from public.stop_suggestions
  where status = 'pending'
  order by created_at asc
  limit p_limit;
$$;

-- p_status must be 'approved' or 'rejected' — the route handler validates
-- this before calling in, but the check constraint on the column is the
-- real backstop.
create or replace function public.resolve_stop_suggestion(p_id bigint, p_status text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stop_suggestions
  set status = p_status, reviewed_at = now()
  where id = p_id and status = 'pending';
$$;

grant execute on function public.submit_stop_suggestion(text,text,text,double precision,double precision,text,text) to anon, authenticated;
grant execute on function public.get_pending_stop_suggestions(int)                                                  to anon, authenticated;
grant execute on function public.resolve_stop_suggestion(bigint,text)                                               to anon, authenticated;

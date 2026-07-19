-- Durable API error tracking.
--
-- Run once in Supabase → SQL Editor (or via the Supabase CLI). Until this
-- runs, the app's error logging silently falls back to its in-memory ledger,
-- so nothing breaks — you just don't get persistence yet.
--
-- Design: the app connects with the ANON/publishable key, so we do NOT expose
-- this table to the REST layer. RLS is enabled with no policies (direct anon
-- access denied), and three SECURITY DEFINER functions are the only way in.
-- They run with the owner's privileges, so the anon key can log/read/clear
-- through them without the raw table being world-readable.

create table if not exists public.api_errors (
  error_key   text primary key,          -- method|path|status|message signature
  path        text        not null,
  method      text        not null,
  status      int         not null,
  message     text        not null,
  details     jsonb,                      -- e.g. Zod validation error, context
  count       int         not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index if not exists api_errors_last_seen_idx
  on public.api_errors (last_seen desc);

alter table public.api_errors enable row level security;
-- Intentionally NO policies: all access goes through the functions below.

-- Upsert-with-increment: identical failures collapse to one row with a count,
-- atomically (no read-modify-write race).
create or replace function public.log_api_error(
  p_key text, p_path text, p_method text,
  p_status int, p_message text, p_details jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.api_errors (error_key, path, method, status, message, details)
  values (p_key, p_path, p_method, p_status, p_message, p_details)
  on conflict (error_key) do update
    set count     = public.api_errors.count + 1,
        last_seen = now(),
        details   = coalesce(excluded.details, public.api_errors.details);
$$;

create or replace function public.get_recent_api_errors(p_limit int default 50)
returns setof public.api_errors
language sql
security definer
set search_path = public
as $$
  select * from public.api_errors order by last_seen desc limit p_limit;
$$;

create or replace function public.clear_api_errors()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_errors;
$$;

grant execute on function public.log_api_error(text,text,text,int,text,jsonb) to anon, authenticated;
grant execute on function public.get_recent_api_errors(int)                   to anon, authenticated;
grant execute on function public.clear_api_errors()                           to anon, authenticated;

-- Optional retention: drop this in as a scheduled job (pg_cron) if you want
-- old rows to age out automatically. Left commented since it's not required.
-- delete from public.api_errors where last_seen < now() - interval '30 days';

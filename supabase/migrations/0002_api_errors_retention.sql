-- Retention for api_errors: enforces the 90-day window stated in the
-- privacy policy (error logs are technical/operational, not tied to a
-- user account, but they can contain a client_id/IP in `details`, so they
-- still get a retention limit rather than being kept forever).
--
-- Run once in Supabase → SQL Editor, same as 0001_api_errors.sql.
--
-- No pg_cron dependency: the app calls prune_api_errors() itself on a timer
-- (lib/api/error-log.ts, once every 24h while the Render process is up),
-- consistent with how log_api_error etc. are already invoked over the anon
-- key rather than requiring extra Supabase-side scheduling infrastructure.

create or replace function public.prune_api_errors(p_days int default 90)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_errors where last_seen < now() - (p_days || ' days')::interval;
$$;

grant execute on function public.prune_api_errors(int) to anon, authenticated;

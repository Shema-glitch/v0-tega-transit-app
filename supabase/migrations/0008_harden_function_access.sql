-- Fixes findings from the Supabase security linter (2026-07-25):
--
-- 1. ERROR: public.spatial_ref_sys (a PostGIS system table, not ours) is
--    public-exposed with RLS disabled. NOT fixed here: this table is owned
--    by the postgis extension itself, not by any role available to a
--    hosted Supabase project (confirmed via "must be owner of table
--    spatial_ref_sys" when attempting ALTER TABLE ... ENABLE ROW LEVEL
--    SECURITY). This is a documented Supabase false positive — the table
--    holds only public SRID reference constants, no app data, and hosted
--    projects have no supported way to change its RLS/ownership. Left as
--    an accepted, unfixable-on-this-plan finding.
--
-- 2. WARN (the real critical one): every SECURITY DEFINER function added in
--    0001/0003/0005/0006/0007 was granted EXECUTE to `anon`. That was fine
--    for the genuinely public, rider-facing ones (submit a bug report, submit
--    a stop suggestion, log an API error) — but it was ALSO granted to the
--    admin-only ones (read bug reports/errors/suggestions, resolve/clear them,
--    create/update/delete stops). Those admin routes gate access with
--    ADMIN_TOKEN at the Next.js layer (see app/api/admin/*), but the app
--    talks to Supabase with the anon key, and the anon key is PUBLIC — it's
--    shipped to every browser as NEXT_PUBLIC_SUPABASE_ANON_KEY. Anyone who
--    extracts it can call these RPCs directly against
--    /rest/v1/rpc/<function_name>, bypassing ADMIN_TOKEN entirely: reading
--    every bug report (PII: page URL, user agent), wiping the error/bug-report
--    tables, or creating/renaming/deleting real stops in production.
--
--    Fix: revoke EXECUTE from anon/authenticated on every admin-only
--    function and grant it to service_role instead. The app now needs a
--    service-role client (lib/supabase-server.ts: getSupabaseAdmin()) for
--    these specific calls — see the lib/api/*.ts changes in the same commit.
--    The three genuinely public submission functions keep their anon grant.

-- --- 1. Lock admin-only RPCs to service_role -----------------------------

-- api_errors (0001/0002): log_api_error stays public (fire-and-forget write
-- from every request); reading/clearing/pruning is admin/system-only.
revoke execute on function public.get_recent_api_errors(int) from anon, authenticated;
revoke execute on function public.clear_api_errors()          from anon, authenticated;
revoke execute on function public.prune_api_errors(int)       from anon, authenticated;
grant execute on function public.get_recent_api_errors(int) to service_role;
grant execute on function public.clear_api_errors()          to service_role;
grant execute on function public.prune_api_errors(int)       to service_role;

-- bug_reports (0003): submit_bug_report stays public; the rest is
-- admin-only (reports carry incidental PII — page URL, user agent).
revoke execute on function public.get_recent_bug_reports(int) from anon, authenticated;
revoke execute on function public.resolve_bug_report(bigint)  from anon, authenticated;
revoke execute on function public.clear_bug_reports()          from anon, authenticated;
grant execute on function public.get_recent_bug_reports(int) to service_role;
grant execute on function public.resolve_bug_report(bigint)  to service_role;
grant execute on function public.clear_bug_reports()          to service_role;

-- stop_suggestions (0005/0006): submit_stop_suggestion stays public; the
-- pending queue and its review are admin-only.
revoke execute on function public.get_pending_stop_suggestions(int)   from anon, authenticated;
revoke execute on function public.get_pending_stop_suggestion(bigint) from anon, authenticated;
revoke execute on function public.resolve_stop_suggestion(bigint,text) from anon, authenticated;
grant execute on function public.get_pending_stop_suggestions(int)   to service_role;
grant execute on function public.get_pending_stop_suggestion(bigint) to service_role;
grant execute on function public.resolve_stop_suggestion(bigint,text) to service_role;

-- stops-admin (0007): direct stop writes are always admin-invoked, no
-- public path uses these at all.
revoke execute on function public.admin_create_stop(text,text,double precision,double precision) from anon, authenticated;
revoke execute on function public.admin_update_stop(text,text,double precision,double precision) from anon, authenticated;
revoke execute on function public.admin_delete_stop(text)                                         from anon, authenticated;
grant execute on function public.admin_create_stop(text,text,double precision,double precision) to service_role;
grant execute on function public.admin_update_stop(text,text,double precision,double precision) to service_role;
grant execute on function public.admin_delete_stop(text)                                         to service_role;

-- Note on the "extension in public" warnings (postgis, pg_trgm): not fixed
-- here. Moving them to a dedicated `extensions` schema is the textbook fix,
-- but postgis in particular has deep dependencies (geometry types, operators,
-- the stops table's spatial indexes) that would need every reference
-- re-qualified and re-tested — real risk of an outage for a schema-layout
-- warning, not a live vulnerability. Left as an accepted, documented risk.

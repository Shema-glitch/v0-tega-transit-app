-- Durable uptime history.
--
-- The status page and admin dashboard render 90-day uptime bars per endpoint
-- (Render-style). Those bars need a source that survives restarts: this table
-- records one row per endpoint probe, and lib/api/uptime-tracker.ts hydrates
-- it on boot and writes every probe through to it, so the history outlives a
-- redeploy instead of resetting to "all gray, no data".
--
-- Like admin_emails/maintenance_flags/auth_log: RLS enabled with zero anon
-- grants. Only service_role (server-side key) writes or reads this table —
-- the public status page reads the aggregated bars via the API, never the
-- table, and the anon key must never be able to forge uptime history.

create table if not exists public.uptime_checks (
  endpoint    text not null,            -- registry id, e.g. 'stops.list'
  checked_at  timestamptz not null,
  status      text not null check (status in ('ok', 'degraded', 'down')),
  latency_ms  integer,
  detail      text,                     -- error message or 'maintenance'
  primary key (endpoint, checked_at)
);

create index if not exists uptime_checks_endpoint_idx
  on public.uptime_checks (endpoint, checked_at desc);

alter table public.uptime_checks enable row level security;

revoke all on table public.uptime_checks from anon, authenticated;
grant all on table public.uptime_checks to service_role;

-- Durable maintenance flags.
--
-- Previously the admin dashboard's "disable endpoint" toggles lived only in
-- the process's memory (lib/api/maintenance-store.ts), so a Render redeploy
-- or restart silently re-enabled everything that was disabled mid-incident —
-- the exact opposite of what you want during a maintenance window. This table
-- is the durable source of truth: middleware hydrates it on boot, and every
-- toggle writes through to it, so flags survive restarts.
--
-- Like admin_emails (0009): RLS enabled with no policies and every grant to
-- anon/authenticated revoked. Only service_role (server-side key, bypasses
-- RLS) reads or writes this table — the public status page reads flags via
-- the API, never the table, and the anon key must never be able to flip a
-- production endpoint off.

create table if not exists public.maintenance_flags (
  feature     text primary key,          -- registry id, e.g. 'stops.list'
  reason      text not null default '',
  since       timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.maintenance_flags enable row level security;

revoke all on table public.maintenance_flags from anon, authenticated;
grant all on table public.maintenance_flags to service_role;

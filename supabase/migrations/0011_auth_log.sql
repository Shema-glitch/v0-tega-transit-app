-- Durable auth audit log.
--
-- Login attempts (magic-link requests, code verifications, link callbacks)
-- used to live only in an in-memory ring buffer (lib/api/auth-log.ts) that a
-- redeploy wiped — so "did anyone try to log in?" was unanswerable after any
-- restart. Events now write through to this table and survive redeploys.
--
-- The rows carry PII (email + IP), so like admin_emails/maintenance_flags the
-- table is RLS-locked with zero anon grants: only service_role (server-side
-- key) may insert or read. The app writes from server-side auth routes and
-- reads from the admin-gated /api/admin/auth-log — never from the browser.

create table if not exists public.auth_log (
  id          bigint generated always as identity primary key,
  action      text not null,             -- magic-link-request | verify | login | ...
  email       text,                      -- the address being attempted
  ip          text not null,
  ok          boolean not null,
  detail      text,                      -- failure reason, error message, etc.
  created_at  timestamptz not null default now()
);

create index if not exists auth_log_created_at_idx
  on public.auth_log (created_at desc);

alter table public.auth_log enable row level security;

revoke all on table public.auth_log from anon, authenticated;
grant all on table public.auth_log to service_role;

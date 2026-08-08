-- Admin email allowlist — invite/revoke admins from the dashboard instead of
-- hand-editing ADMIN_EMAILS.
--
-- The old flow: ADMIN_EMAILS env var is the only allowlist, so adding an admin
-- meant redeploying with a new env value. Now the Supabase table below is the
-- dynamic source of truth (the env var still works as a bootstrap seed — see
-- lib/api/admin-emails.ts, which checks env first, then this table).
--
-- Security: this table is locked down the same way as the admin-only RPCs in
-- 0008. RLS is enabled with NO policies, and every grant to anon/authenticated
-- is revoked — so the anon key (which ships to every browser as
-- NEXT_PUBLIC_SUPABASE_ANON_KEY) can neither read nor write it. That's
-- deliberate: the allowlist must never be enumerable by the public. Only
-- service_role (bypasses RLS, server-side key only) touches this table, from
-- the admin-gated routes and the server-side magic-link allowlist check.

create table if not exists public.admin_emails (
  email      text primary key,
  invited_by text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;

revoke all on table public.admin_emails from anon, authenticated;
grant all on table public.admin_emails to service_role;

-- Owner bootstrap: the project owner's address is seeded here so they can sign
-- in even before ADMIN_EMAILS is set in the deploy env. It shows up in the
-- dashboard as a normal row and can be revoked like any other invite.
insert into public.admin_emails (email, invited_by)
values ('sonyxperiame1@gmail.com', 'bootstrap')
on conflict (email) do nothing;

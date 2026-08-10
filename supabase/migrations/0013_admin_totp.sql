-- Admin TOTP (Google Authenticator) second factor.
--
-- Complements the Supabase magic-code login: an admin who enrolls a TOTP
-- secret must present a fresh authenticator code for sensitive operations
-- (stop writes, maintenance toggles, admin invite/revoke, suggestion
-- approval). This protects the destructive surface even if the admin's email
-- account is compromised — a hijacker who can read the OTP emails still
-- cannot act without the authenticator app.
--
-- Enrollment is two-phase: `pending_secret` is set first (enrollment started,
-- showing the otpauth:// URI), and is promoted to `secret` only after the
-- admin proves they scanned it by entering a valid code. `enabled_at` is null
-- until activation, so a half-finished enrollment never gates anything.
--
-- Security: same lockdown as admin_emails (0009) — RLS on, no policies, no
-- anon/authenticated grants. Only service_role (server-side key) touches it,
-- from the admin-gated /api/admin/settings/totp routes and the sensitive-op
-- gate in lib/api/admin-totp.ts.

create table if not exists public.admin_totp (
  email          text primary key,
  secret         text,             -- active base32 secret (null until activated)
  pending_secret text,             -- secret awaiting activation during enrollment
  enabled_at     timestamptz,      -- set on activation; null while pending
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.admin_totp enable row level security;

revoke all on table public.admin_totp from anon, authenticated;
grant all on table public.admin_totp to service_role;

-- The cascade FK to the allowlist only makes sense when admin_emails exists
-- (migration 0009). Some projects were provisioned before it, so add the
-- constraint conditionally instead of letting this migration hard-fail.
-- If the allowlist is missing, run 0009 first (or after) — the constraint
-- can be added later with the same ALTER below.
do $$
begin
  if to_regclass('public.admin_emails') is not null then
    alter table public.admin_totp
      add constraint admin_totp_email_fkey
      foreign key (email) references public.admin_emails(email) on delete cascade;
  end if;
end
$$;

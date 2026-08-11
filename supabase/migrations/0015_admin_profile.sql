-- Admin profile (settings → Profile) — a display name for the console
-- sidebar so it shows "Jane, Transit Ops" instead of the raw email.
--
-- The column is nullable: an admin who never set a name keeps falling back
-- to their email everywhere. Only the row's own owner can write it (the
-- /api/admin/settings/profile route is admin-gated and scoped to the caller's
-- email), and this table stays locked down from anon/authenticated exactly as
-- it was in 0009.
--
-- Run once in Supabase → SQL Editor, same as the other migrations.

alter table if exists public.admin_emails
  add column if not exists display_name text;

-- Rider-submitted bug reports (frontend feedback form). Separate from
-- api_errors (0001) — those are technical/API failures, these are riders
-- telling you something is wrong, so they're never deduped/collapsed and
-- never auto-pruned; they need a human to read and resolve them.
--
-- Run once in Supabase → SQL Editor, same as 0001/0002.
--
-- Same lockdown pattern: RLS enabled with no policies, anon key only gets
-- in through SECURITY DEFINER functions.

create table if not exists public.bug_reports (
  id          bigint generated always as identity primary key,
  subject     text        not null,
  message     text        not null,
  page_url    text,
  user_agent  text,
  status      text        not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now()
);

create index if not exists bug_reports_created_at_idx
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;
-- Intentionally NO policies: all access goes through the functions below.

create or replace function public.submit_bug_report(
  p_subject text, p_message text, p_page_url text, p_user_agent text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.bug_reports (subject, message, page_url, user_agent)
  values (p_subject, p_message, p_page_url, p_user_agent);
$$;

create or replace function public.get_recent_bug_reports(p_limit int default 100)
returns setof public.bug_reports
language sql
security definer
set search_path = public
as $$
  select * from public.bug_reports order by created_at desc limit p_limit;
$$;

create or replace function public.resolve_bug_report(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bug_reports set status = 'resolved' where id = p_id;
$$;

create or replace function public.clear_bug_reports()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.bug_reports;
$$;

grant execute on function public.submit_bug_report(text,text,text,text) to anon, authenticated;
grant execute on function public.get_recent_bug_reports(int)              to anon, authenticated;
grant execute on function public.resolve_bug_report(bigint)               to anon, authenticated;
grant execute on function public.clear_bug_reports()                      to anon, authenticated;

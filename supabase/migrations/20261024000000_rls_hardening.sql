-- Row Level Security for LookBlog, made sure of (safe to run again: it changes nothing that's already in place).
-- Only the LookBlog server reads and writes, with the secret key (role service_role, which bypasses RLS).
-- Everyone else (the public key → role anon, or a signed-in Supabase user → role authenticated) gets nothing.

-- 1. RLS on the table, also for the table's owner
alter table public.docs enable row level security;
alter table public.docs force row level security;

-- 2. No policies for anon / authenticated, so RLS lets them see and change no rows.
--    (Remove any policy that may have been added by hand in the dashboard.)
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'docs' loop
    execute format('drop policy %I on public.docs', p.policyname);
  end loop;
end $$;

-- 3. And no rights at all for the public roles: the table, its sequence and its trigger function
revoke all on public.docs from anon, authenticated, public;
revoke all on sequence public.docs_seq from anon, authenticated, public;
revoke all on function public.docs_bump() from anon, authenticated, public;
-- (the server keeps everything it needs, granted to it by name)
grant all on public.docs to service_role;
grant all on sequence public.docs_seq to service_role;
grant execute on function public.docs_bump() to service_role;

-- 4. Tables created later in this schema start closed too (no automatic rights for the public roles)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- Check (should show rls_on = true, rls_forced = true, policies = 0):
-- select c.relname, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced,
--        (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind = 'r';

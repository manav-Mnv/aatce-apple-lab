-- Hardening from the Supabase security advisor.
--
-- 1. Pin search_path on every lab function (all references are schema-qualified),
--    so no caller can shadow a table or function with its own.
-- 2. Only the anon role (publishable key) calls public.api; nobody signs in with
--    Supabase Auth, so `authenticated` does not need it.
--
-- Accepted advisor notes: lab tables have RLS on and no policies on purpose
-- (no direct table access at all), and anon may execute the SECURITY DEFINER
-- public.api because it is the API — every action checks a role secret.

do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'lab'
  loop
    execute format('alter function %s set search_path = %L', f, '');
  end loop;
end $$;

revoke execute on function public.api(jsonb) from authenticated;

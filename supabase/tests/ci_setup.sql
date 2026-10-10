-- Plain-Postgres stand-ins for what Supabase provides, so CI can apply the core
-- and hardening migrations and run supabase/tests/api_test.sql.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

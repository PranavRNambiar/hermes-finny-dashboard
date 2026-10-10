-- Finny: close direct access to the database through the public anon key.
--
-- Before this, RLS was off, so anyone holding the anon key (shipped in the old
-- dashboard bundle) could read transactions straight from the Supabase REST API.
-- After this, only the service_role key can touch these tables. The agent, the
-- dashboard API routes, the MCP server and the iOS API all use service_role, which
-- bypasses RLS, so nothing in Finny needs a policy.
--
-- Run in the Supabase SQL Editor AFTER the dashboard build that stops using the
-- anon key is deployed. Otherwise the old dashboard's Home/Tags/Analytics charts go blank.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Tables created later get the same treatment for privileges (RLS must still be
-- enabled per table; add it to the CREATE TABLE migration).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Check: every row should show rls = true.
SELECT tablename, rowsecurity AS rls FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;

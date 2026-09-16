-- Supabase supplies these roles. The local Docker database needs lightweight
-- equivalents so the RLS migration can be applied unchanged.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

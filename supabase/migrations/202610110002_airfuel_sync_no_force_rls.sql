-- Apply after 202610110001_airfuel_sync.sql.
-- Removes FORCE ROW LEVEL SECURITY so the table owner is not subject to RLS. Only the security-definer
-- RPC (owned by the table owner) writes this table. Client roles (anon, authenticated) are not owners,
-- so they stay fully subject to RLS, their grants stay revoked, and their select policy still applies.
-- With FORCE, the RPC's insert was refused for any owner without BYPASSRLS, because the table has no
-- insert or update policy, so every sync write failed.
begin;
alter table public.airfuel_user_records no force row level security;
commit;

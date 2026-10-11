-- SEC-9: per-account row quota for the sync table. Apply after 202610110002_airfuel_sync_no_force_rls.sql.
--
-- Cap: 224,006 rows per account = 2 x 112,003. 112,003 is the sum of the client backup caps in
-- src/lib/schema.ts (backupLimits: 20,000 + 50,000 + 20,000 + 10,000 + 10,000 + 1,000 + 1,000 + 1 + 1),
-- the largest live data set one backup can hold. The factor of 2 leaves room for tombstones: deletes
-- are kept forever so old devices cannot resurrect them, and they count as rows.
--
-- Counting uses a per-account counter table, not count(*), so each write costs one indexed update.
-- Only NEW records count. Updating an existing record stays allowed at the cap.
-- A refused write raises SQLSTATE 53400 (configuration_limit_exceeded). The client classifies it as
-- permanent for that record only, so it is shown in the UI and is not retried.
-- Grants on airfuel_apply_change are unchanged from 202610110001.
begin;

create table public.airfuel_user_quota (
  user_id uuid primary key references auth.users(id) on delete cascade,
  record_count bigint not null default 0 check (record_count >= 0)
);
alter table public.airfuel_user_quota enable row level security;
-- No client access: only the security-definer RPC reads or writes the counter.
revoke all on public.airfuel_user_quota from anon, authenticated;

-- Backfill counters for rows written before this migration (no-op on a fresh database).
insert into public.airfuel_user_quota (user_id, record_count)
  select user_id, count(*) from public.airfuel_user_records group by user_id
  on conflict (user_id) do update set record_count = excluded.record_count;

create or replace function public.airfuel_apply_change(
  p_entity text, p_record_id text, p_revision bigint,
  p_operation_id uuid, p_deleted boolean, p_payload jsonb
) returns setof public.airfuel_user_records
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Clients cannot choose a user_id. The authenticated JWT is the only owner authority.
  -- A brand-new record counts against the quota. An update to an existing record does not.
  if not exists (
    select 1 from public.airfuel_user_records
    where user_id = caller and entity = p_entity and record_id = p_record_id
  ) then
    insert into public.airfuel_user_quota (user_id, record_count) values (caller, 0)
      on conflict (user_id) do nothing;
    update public.airfuel_user_quota set record_count = record_count + 1
      where user_id = caller and record_count < 224006;
    if not found then
      raise exception 'Record quota exceeded: this account already holds the maximum number of sync records'
        using errcode = '53400';
    end if;
  end if;
  insert into public.airfuel_user_records (user_id,entity,record_id,revision,operation_id,deleted,payload)
  values (caller,p_entity,p_record_id,p_revision,p_operation_id,p_deleted,p_payload)
  on conflict (user_id,entity,record_id) do update set
    revision = excluded.revision, operation_id = excluded.operation_id,
    deleted = excluded.deleted, payload = excluded.payload
  where (excluded.revision, excluded.operation_id) > (airfuel_user_records.revision, airfuel_user_records.operation_id);
  return query select * from public.airfuel_user_records
    where user_id = caller and entity = p_entity and record_id = p_record_id;
end;
$$;
-- Grants identical to 202610110001.
revoke all on function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) from public, anon;
grant execute on function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) to authenticated;
commit;

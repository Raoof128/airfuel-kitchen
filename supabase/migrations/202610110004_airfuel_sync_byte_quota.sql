-- Byte quota for the sync table (security review: resource exhaustion). Apply after
-- 202610110003_airfuel_sync_quota.sql.
--
-- The row quota (224,006) alone allows about 109 GiB per account, because each payload may be up to
-- 512 KiB. This migration adds a byte quota: the total octet length of an account's stored payloads
-- may not exceed 67,108,864 bytes (64 MiB). The client's backup maximum is about 20 MB, so 64 MiB leaves
-- room for legitimate data and bounds storage per account.
--
-- Accounting, under a row lock on the account's quota row so concurrent writes are serialised:
--   * delta = new payload size - stored payload size (0 for a tombstone or a missing row).
--   * The counter changes only when the write actually changes the row. The revision and UUID ordering
--     can make a write a no-op, and a no-op changes nothing.
--   * Growth that would exceed the cap is refused with SQLSTATE 53400. Shrinking updates and deletes
--     always succeed and free bytes.
-- Grants on airfuel_apply_change are unchanged from 202610110001.
begin;

alter table public.airfuel_user_quota
  add column payload_bytes bigint not null default 0 check (payload_bytes >= 0);

-- Backfill for rows written before this migration, and make the counters exact for existing accounts.
insert into public.airfuel_user_quota (user_id, record_count, payload_bytes)
  select user_id, count(*), sum(coalesce(octet_length(payload::text), 0))::bigint
  from public.airfuel_user_records group by user_id
  on conflict (user_id) do update set
    record_count = excluded.record_count, payload_bytes = excluded.payload_bytes;

create or replace function public.airfuel_apply_change(
  p_entity text, p_record_id text, p_revision bigint,
  p_operation_id uuid, p_deleted boolean, p_payload jsonb
) returns setof public.airfuel_user_records
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  existing public.airfuel_user_records%rowtype;
  existed boolean;
  will_change boolean;
  current_records bigint;
  current_bytes bigint;
  old_bytes bigint := 0;
  new_bytes bigint := 0;
  delta bigint := 0;
  affected integer;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Serialise this account's writes on its quota row before reading or changing anything.
  insert into public.airfuel_user_quota (user_id, record_count, payload_bytes) values (caller, 0, 0)
    on conflict (user_id) do nothing;
  select q.record_count, q.payload_bytes into current_records, current_bytes
    from public.airfuel_user_quota q where q.user_id = caller for update;
  -- Clients cannot choose a user_id. The authenticated JWT is the only owner authority.
  select r.* into existing from public.airfuel_user_records r
    where r.user_id = caller and r.entity = p_entity and r.record_id = p_record_id;
  existed := found;
  -- Same predicate as the upsert's WHERE, so the decision and the write agree.
  will_change := (not existed) or ((p_revision, p_operation_id) > (existing.revision, existing.operation_id));
  if will_change then
    old_bytes := case when existed then coalesce(octet_length(existing.payload::text), 0) else 0 end;
    new_bytes := coalesce(octet_length(p_payload::text), 0);
    delta := new_bytes - old_bytes;
    if not existed and current_records >= 224006 then
      raise exception 'Record quota exceeded: this account already holds the maximum number of sync records'
        using errcode = '53400';
    end if;
    if delta > 0 and current_bytes + delta > 67108864 then
      raise exception 'Storage quota exceeded: this account would exceed the 64 MiB sync storage limit'
        using errcode = '53400';
    end if;
  end if;
  insert into public.airfuel_user_records (user_id,entity,record_id,revision,operation_id,deleted,payload)
  values (caller,p_entity,p_record_id,p_revision,p_operation_id,p_deleted,p_payload)
  on conflict (user_id,entity,record_id) do update set
    revision = excluded.revision, operation_id = excluded.operation_id,
    deleted = excluded.deleted, payload = excluded.payload
  where (excluded.revision, excluded.operation_id) > (airfuel_user_records.revision, airfuel_user_records.operation_id);
  get diagnostics affected = row_count;
  if affected <> (case when will_change then 1 else 0 end) then
    raise exception 'sync quota: write did not match its ordering decision' using errcode = 'XX000';
  end if;
  if will_change then
    update public.airfuel_user_quota set
      record_count = record_count + (case when existed then 0 else 1 end),
      payload_bytes = payload_bytes + delta
    where user_id = caller;
  end if;
  return query select * from public.airfuel_user_records
    where user_id = caller and entity = p_entity and record_id = p_record_id;
end;
$$;
-- Grants identical to 202610110001.
revoke all on function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) from public, anon;
grant execute on function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) to authenticated;
commit;

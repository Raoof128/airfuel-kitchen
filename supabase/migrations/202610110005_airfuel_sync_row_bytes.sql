-- Row-size accounting for the sync byte quota (security finding: the counter undercounted physical
-- storage). Apply after 202610110004_airfuel_sync_byte_quota.sql.
--
-- Before: the counter summed only the jsonb text of each payload. Physical storage also holds a second
-- copy of record_id (the column), a primary-key index entry, and per-tuple header bytes. Measured on a
-- 300-character id that is roughly 2 to 3 times the counted bytes, and the gap grows with id length.
--
-- After: each stored row is charged an estimate of its physical size:
--     payload text bytes + 2 x record_id bytes + 128 bytes
--   * payload text: the jsonb text, which is what the table stores (null for a tombstone).
--   * 2 x record_id: the column copy plus the primary-key index entry, which both hold the id.
--   * 128: the other stored columns (user_id, entity, revision, operation_id, deleted), their share of the
--     primary-key index key, tuple and index headers, and page slack. Measured: with 300-character ids,
--     physical growth is 1.23 x the 64-byte estimate and 1.15 x this 128-byte one. Short ids are over-counted.
-- Tombstones are charged their id and overhead, because they stay on disk.
-- The 64 MiB cap is unchanged, and it now bounds this estimate, not the payload alone.
begin;

create function public.airfuel_row_bytes(p_record_id text, p_payload jsonb)
returns bigint
language sql immutable
set search_path = ''
as $$
  select (coalesce(octet_length(p_payload::text), 0) + 2 * octet_length(p_record_id) + 128)::bigint
$$;
-- Only the definer RPC calls this helper. Clients get no execute.
revoke all on function public.airfuel_row_bytes(text, jsonb) from public, anon, authenticated;
-- The RPC runs as its owner, so the owner needs execute on the helper. Granted to whichever role owns the RPC.
do $$
declare
  rpc_owner text;
begin
  select pg_get_userbyid(p.proowner) into rpc_owner
    from pg_proc p where p.oid = 'public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb)'::regprocedure;
  execute format('grant execute on function public.airfuel_row_bytes(text, jsonb) to %I', rpc_owner);
end $$;

-- Recompute every account's counters from the table, so existing accounts are exact under the new formula.
insert into public.airfuel_user_quota (user_id, record_count, payload_bytes)
  select user_id, count(*), sum(public.airfuel_row_bytes(record_id, payload))::bigint
  from public.airfuel_user_records group by user_id
  on conflict (user_id) do update set
    record_count = excluded.record_count, payload_bytes = excluded.payload_bytes;
update public.airfuel_user_quota set payload_bytes = 0
  where user_id not in (select user_id from public.airfuel_user_records);

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
    old_bytes := case when existed then public.airfuel_row_bytes(p_record_id, existing.payload) else 0 end;
    new_bytes := public.airfuel_row_bytes(p_record_id, p_payload);
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

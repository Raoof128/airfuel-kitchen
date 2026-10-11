-- Accounting hardening for the sync quota. Apply after 202610110005_airfuel_sync_row_bytes.sql.
--
-- Two review findings:
--   (a) Recompute race: the counter recompute in an earlier migration ran without locks, so RPC writes
--       could interleave with it and leave counters wrong. This migration locks both tables first.
--   (b) Parser differential: the counter measured the jsonb TEXT, but the table stores jsonb in BINARY form.
--       Dense structures (for example long arrays of zeros) take 2 to 4 times more bytes stored than their
--       text. The counter understated storage, and the 512 KiB row check measured text only.
--
-- Lock order: quota first, then records. The RPC locks its quota row before it writes the records table.
-- Taking the records lock first could deadlock with an in-flight RPC write (each waits for the other).
-- A quota-first lock makes each in-flight RPC wait at its first statement, holding nothing this migration needs.
begin;

lock table public.airfuel_user_quota in access exclusive mode;
lock table public.airfuel_user_records in share row exclusive mode;

-- Charged size of one stored row: the larger of the text form and the binary (stored) form of the
-- payload, plus twice the record_id (column copy and index entry), plus 128 bytes of overhead.
-- The binary size is measured on a fresh parse of the payload's text, so it does not depend on whether
-- the stored copy happens to be compressed. Otherwise an unchanged row could be charged differently on
-- update, and the counter would drift.
-- STABLE, not IMMUTABLE: pg_column_size depends on storage details.
create or replace function public.airfuel_row_bytes(p_record_id text, p_payload jsonb)
returns bigint
language sql stable
set search_path = ''
as $$
  select (coalesce(greatest(octet_length(p_payload::text), pg_column_size(p_payload::text::jsonb)), 0)
    + 2 * octet_length(p_record_id) + 128)::bigint
$$;
revoke all on function public.airfuel_row_bytes(text, jsonb) from public, anon, authenticated;
do $$
declare
  rpc_owner text;
begin
  select pg_get_userbyid(p.proowner) into rpc_owner
    from pg_proc p where p.oid = 'public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb)'::regprocedure;
  execute format('grant execute on function public.airfuel_row_bytes(text, jsonb) to %I', rpc_owner);
end $$;

-- Binary-size bound, in addition to the text bound. Rows that already exist are checked by VALIDATE.
-- Added NOT VALID first, so the table is not scanned while the constraint is being added.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.airfuel_user_records'::regclass and conname = 'bounded_binary_payload'
  ) then
    alter table public.airfuel_user_records add constraint bounded_binary_payload
      check (payload is null or pg_column_size(payload::text::jsonb) <= 524288) not valid;
  end if;
end $$;
alter table public.airfuel_user_records validate constraint bounded_binary_payload;

-- Recompute every counter from the table under the locks above, so nothing can interleave.
insert into public.airfuel_user_quota (user_id, record_count, payload_bytes)
  select user_id, count(*), sum(public.airfuel_row_bytes(record_id, payload))::bigint
  from public.airfuel_user_records group by user_id
  on conflict (user_id) do update set
    record_count = excluded.record_count, payload_bytes = excluded.payload_bytes;
update public.airfuel_user_quota set record_count = 0, payload_bytes = 0
  where user_id not in (select user_id from public.airfuel_user_records);
commit;

-- Apply manually to your own Supabase project. No credentials belong in this file.
begin;
create table public.airfuel_user_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check (entity in ('recipeStates','sessions','plans','pantry','shopping','customRecipes','overrides','preferences','activeCooking')),
  record_id text not null check (length(record_id) between 1 and 300),
  revision bigint not null check (revision between 1 and 9007199254740991),
  operation_id uuid not null,
  deleted boolean not null default false,
  payload jsonb,
  primary key (user_id, entity, record_id),
  constraint valid_tombstone check ((deleted and payload is null) or (not deleted and payload is not null and jsonb_typeof(payload) = 'object' and payload ? 'id' and jsonb_typeof(payload->'id') = 'string' and payload->>'id' = record_id)),
  constraint bounded_payload check (payload is null or octet_length(payload::text) <= 524288)
);
alter table public.airfuel_user_records enable row level security;
alter table public.airfuel_user_records force row level security;
create policy "Users read only their own kitchen records"
  on public.airfuel_user_records for select to authenticated
  using ((select auth.uid()) = user_id);
-- No direct mutation grants: the narrow RPC enforces identity and revision ordering.
revoke all on public.airfuel_user_records from anon, authenticated;
grant select on public.airfuel_user_records to authenticated;

create function public.airfuel_apply_change(
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
revoke all on function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) from public, anon;
grant execute on function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) to authenticated;
commit;

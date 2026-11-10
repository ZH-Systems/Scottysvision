-- Run once in Supabase SQL Editor before deploying. No operational data is seeded.
begin;
create table public.vision_events (
 seq bigint generated always as identity primary key,
 owner uuid not null references auth.users(id) on delete cascade,
 event_id text not null check(length(event_id) between 1 and 220),
 kind text not null check(kind in ('waste','waste_void','wing_event','wing_batch','recipe','ingredient','invoice','settings')),
 entity_id text not null, payload jsonb not null check(jsonb_typeof(payload)='object'),
 hash text not null, created_at bigint not null, received_at bigint not null,
 unique(owner,event_id)
);
create index vision_events_owner_seq on public.vision_events(owner,seq);
create index vision_events_entity on public.vision_events(owner,kind,entity_id,created_at);
create table public.vision_catalog_items (owner uuid not null references auth.users(id) on delete cascade,item_id text not null,payload jsonb not null,source_at bigint not null default 0,primary key(owner,item_id));
create table public.vision_files (
 key text primary key, owner uuid not null references auth.users(id) on delete cascade,
 file_id text not null, name text not null, mime text not null, size bigint not null check(size between 1 and 16777216),
 hash text not null, created_at bigint not null, unique(owner,file_id)
);
create table public.vision_postings (
 key text primary key, owner uuid not null references auth.users(id) on delete cascade,
 record_id text not null, kind text not null, hash text not null,
 status text not null check(status in ('attempting','confirmed','needs_reconciliation')),
 result jsonb, updated_at bigint not null
);
-- Global per-workbook lock coordinates all users of this deployment/database.
create table public.vision_locks (owner text primary key, token text not null, expires_at bigint not null);

-- Public clients can read only their own records. Mutations go through verified server routes.
alter table public.vision_catalog_items enable row level security;
create policy vision_catalog_read on public.vision_catalog_items for select to authenticated using(owner=auth.uid());
revoke all on public.vision_catalog_items from anon,authenticated;
grant select on public.vision_catalog_items to authenticated;
grant all on public.vision_catalog_items to service_role;
alter table public.vision_events enable row level security;
alter table public.vision_files enable row level security;
alter table public.vision_postings enable row level security;
alter table public.vision_locks enable row level security;
create policy vision_events_read on public.vision_events for select to authenticated using(owner=auth.uid());
create policy vision_files_read on public.vision_files for select to authenticated using(owner=auth.uid());
create policy vision_postings_read on public.vision_postings for select to authenticated using(owner=auth.uid());
revoke all on public.vision_events, public.vision_files, public.vision_postings, public.vision_locks from anon, authenticated;
grant select on public.vision_events, public.vision_files, public.vision_postings to authenticated;
grant all on public.vision_events, public.vision_files, public.vision_postings, public.vision_locks to service_role;
grant usage,select on sequence public.vision_events_seq_seq to service_role;

-- One transaction serializes push AND pull for an owner so cursor pagination cannot
-- skip an earlier uncommitted sequence allocated by another device.
create function public.vision_sync(p_owner uuid,p_events jsonb,p_since bigint,p_catalog jsonb default '[]',p_catalog_at bigint default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; old_hash text; page jsonb; next_cursor bigint; more_rows boolean;
begin
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>40 then raise exception 'Sync up to 40 entries'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if jsonb_typeof(p_catalog)<>'array' or jsonb_array_length(p_catalog)>5000 then raise exception 'Invalid reference catalog'; end if;
 insert into public.vision_catalog_items(owner,item_id,payload,source_at) select p_owner,value->>'id',value,p_catalog_at from jsonb_array_elements(p_catalog) on conflict(owner,item_id) do update set payload=excluded.payload,source_at=excluded.source_at where vision_catalog_items.source_at<=excluded.source_at;
 for e in select value from jsonb_array_elements(p_events) loop
  select hash into old_hash from public.vision_events where owner=p_owner and event_id=e->>'id';
  if found and old_hash<>e->>'hash' then raise exception 'Immutable event conflict: %',e->>'id' using errcode='23505'; end if;
  insert into public.vision_events(owner,event_id,kind,entity_id,payload,hash,created_at,received_at)
  values(p_owner,e->>'id',e->>'kind',e->>'entityId',e->'data',e->>'hash',(e->>'at')::bigint,(extract(epoch from clock_timestamp())*1000)::bigint)
  on conflict(owner,event_id) do nothing;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',event_id,'kind',kind,'entityId',entity_id,'at',created_at,'data',payload) order by seq),'[]'),coalesce(max(seq),greatest(p_since,0)) into page,next_cursor
 from (select * from public.vision_events where owner=p_owner and seq>greatest(p_since,0) order by seq limit 500) t;
 select exists(select 1 from public.vision_events where owner=p_owner and seq>next_cursor) into more_rows;
 return jsonb_build_object('status','success','ack',(select coalesce(jsonb_agg(value->>'id'),'[]') from jsonb_array_elements(p_events)), 'cursor',next_cursor,'more',more_rows,'events',page,'catalog',(select coalesce(jsonb_agg(payload order by item_id),'[]') from public.vision_catalog_items where owner=p_owner),'catalogAt',(select coalesce(max(source_at),0) from public.vision_catalog_items where owner=p_owner));
end $$;
revoke all on function public.vision_sync(uuid,jsonb,bigint,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.vision_sync(uuid,jsonb,bigint,jsonb,bigint) to service_role;

create function public.vision_acquire_lock(p_owner text,p_token text,p_now bigint)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare acquired text;
begin
 insert into public.vision_locks(owner,token,expires_at) values(p_owner,p_token,p_now+180000)
 on conflict(owner) do update set token=excluded.token,expires_at=excluded.expires_at where vision_locks.expires_at<p_now
 returning token into acquired;
 return acquired=p_token;
end $$;
revoke all on function public.vision_acquire_lock(text,text,bigint) from public,anon,authenticated;
grant execute on function public.vision_acquire_lock(text,text,bigint) to service_role;

-- Security-invoker views retain the underlying owner RLS. Every JSON field remains
-- available in payload; views make each operational category independently queryable.
create view public.vision_catalog with(security_invoker=true) as select owner,item_id,source_at,payload from public.vision_catalog_items;
create view public.vision_ingredients with(security_invoker=true) as
 select distinct on(owner,ingredient_id) owner,ingredient_id,event_id,created_at,
 payload->>'name' as name,payload->>'baseUnit' as base_unit,(payload->>'cost')::numeric as cost,
 (payload->>'confirmed')::boolean as reviewed,payload from (
 select owner,entity_id as ingredient_id,event_id,created_at,payload,1 as priority from public.vision_events where kind='ingredient'
 union all select owner,item_id as ingredient_id,null::text as event_id,source_at as created_at,payload,0 as priority from public.vision_catalog_items
 ) t order by owner,ingredient_id,priority desc,created_at desc,event_id desc;
create view public.vision_waste with(security_invoker=true) as
 select e.owner,e.entity_id as waste_id,e.event_id,e.created_at,e.payload,
 exists(select 1 from public.vision_events v where v.owner=e.owner and v.kind='waste_void' and v.payload->>'recordId'=e.entity_id) as voided
 from public.vision_events e where e.kind='waste';
create view public.vision_waste_voids with(security_invoker=true) as select owner,event_id,entity_id,created_at,payload from public.vision_events where kind='waste_void';
create view public.vision_wing_batches with(security_invoker=true) as select owner,entity_id as batch_id,event_id,created_at,payload from public.vision_events where kind='wing_batch';
create view public.vision_wing_events with(security_invoker=true) as select owner,entity_id as batch_id,event_id,created_at,payload from public.vision_events where kind='wing_event';
create view public.vision_recipe_revisions with(security_invoker=true) as select owner,entity_id as recipe_id,event_id,created_at,payload from public.vision_events where kind='recipe';
create view public.vision_invoices with(security_invoker=true) as select owner,entity_id as invoice_id,event_id,created_at,payload from public.vision_events where kind='invoice';
create view public.vision_settings with(security_invoker=true) as select distinct on(owner,entity_id) owner,entity_id,event_id,created_at,payload from public.vision_events where kind='settings' order by owner,entity_id,created_at desc,event_id desc;
create view public.vision_inventory_txns with(security_invoker=true) as
 select owner,'TX-'||waste_id as transaction_id,waste_id as reference_id,created_at,
 payload->>'visionId' as ingredient_id,'Waste'::text as transaction_type,
 -(payload->>'baseQty')::numeric as qty,payload->>'baseUnit' as uom,
 -(payload->>'value')::numeric as value,voided,payload
 from public.vision_waste;
grant select on public.vision_inventory_txns, public.vision_catalog, public.vision_ingredients, public.vision_waste, public.vision_waste_voids, public.vision_wing_batches, public.vision_wing_events, public.vision_recipe_revisions, public.vision_invoices, public.vision_settings to authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('vision-attachments','vision-attachments',false,16777216,array['image/jpeg','image/png','image/webp','application/pdf'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No public bucket policy: short-lived signed URLs are issued by verified routes.
commit;

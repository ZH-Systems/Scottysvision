begin;
-- A kitchen keeps the original owner's UUID as its data scope, so no existing
-- events, files, approvals or catalog rows need to be rewritten.
create table public.vision_workspaces(id uuid primary key references auth.users(id) on delete cascade,name text not null,created_at timestamptz not null default now());
create table public.vision_memberships(workspace_id uuid not null references public.vision_workspaces(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,role text not null check(role in ('viewer','staff','manager','owner')),primary key(workspace_id,user_id));
insert into public.vision_workspaces(id,name) select distinct owner,'Kitchen' from (select owner from public.vision_events union select owner from public.vision_catalog_items union select owner from public.vision_files) s;
insert into public.vision_memberships select id,id,'owner' from public.vision_workspaces;
create function public.vision_is_member(scope uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from public.vision_memberships where workspace_id=scope and user_id=auth.uid())$$;
revoke all on function public.vision_is_member(uuid) from public;
grant execute on function public.vision_is_member(uuid) to authenticated,service_role;
alter table public.vision_workspaces enable row level security;
alter table public.vision_memberships enable row level security;
create policy workspace_read on public.vision_workspaces for select to authenticated using(public.vision_is_member(id));
create policy membership_read on public.vision_memberships for select to authenticated using(public.vision_is_member(workspace_id));
revoke all on public.vision_workspaces,public.vision_memberships from anon,authenticated;
grant select on public.vision_workspaces,public.vision_memberships to authenticated;
grant all on public.vision_workspaces,public.vision_memberships to service_role;
drop policy vision_events_read on public.vision_events;
drop policy vision_files_read on public.vision_files;
drop policy vision_catalog_read on public.vision_catalog_items;
drop policy vision_postings_read on public.vision_postings;
create policy vision_events_read on public.vision_events for select to authenticated using(public.vision_is_member(owner));
create policy vision_files_read on public.vision_files for select to authenticated using(public.vision_is_member(owner));
create policy vision_catalog_read on public.vision_catalog_items for select to authenticated using(public.vision_is_member(owner));
create policy vision_postings_read on public.vision_postings for select to authenticated using(public.vision_is_member(owner));
alter table public.vision_events add column created_by uuid references auth.users(id);
create table public.vision_drafts(workspace_id uuid not null references public.vision_workspaces(id) on delete cascade,draft_key text not null,revision text not null,parent_revision text,payload jsonb not null,updated_by uuid not null references auth.users(id),updated_at bigint not null,primary key(workspace_id,draft_key,revision));
create table public.vision_operations(workspace_id uuid not null references public.vision_workspaces(id),operation_id text not null,kind text not null,payload jsonb not null,actor uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(workspace_id,operation_id));
create table public.vision_purchase_receipts(workspace_id uuid not null references public.vision_workspaces(id),invoice_key text not null,invoice_root text not null,operation_id text not null,state text not null check(state in ('active','reversed')),primary key(workspace_id,invoice_key));
create table public.vision_stock_movements(workspace_id uuid not null references public.vision_workspaces(id),movement_id text not null,operation_id text not null,item_id text not null,location text not null,unit text not null,qty numeric not null,unit_cost numeric,created_at timestamptz not null default now(),primary key(workspace_id,movement_id),foreign key(workspace_id,operation_id) references public.vision_operations(workspace_id,operation_id));
create index vision_stock_balance on public.vision_stock_movements(workspace_id,item_id,location,unit);
create table public.vision_push_subscriptions(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.vision_workspaces(id),user_id uuid not null references auth.users(id) on delete cascade,endpoint text not null,subscription jsonb not null,unique(user_id,endpoint));
create table public.vision_reminders(workspace_id uuid not null references public.vision_workspaces(id),reminder_key text not null,sent_at timestamptz not null default now(),primary key(workspace_id,reminder_key));
create table public.vision_reconciliations(workspace_id uuid not null references public.vision_workspaces(id),posting_key text not null,note text not null,actor uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(workspace_id,posting_key));
do $$declare t text;begin foreach t in array array['vision_purchase_receipts','vision_drafts','vision_operations','vision_stock_movements','vision_push_subscriptions','vision_reminders','vision_reconciliations'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
create policy drafts_read on public.vision_drafts for select to authenticated using(public.vision_is_member(workspace_id));
create policy operations_read on public.vision_operations for select to authenticated using(public.vision_is_member(workspace_id));
create policy stock_read on public.vision_stock_movements for select to authenticated using(public.vision_is_member(workspace_id));
grant select on public.vision_drafts,public.vision_operations,public.vision_stock_movements to authenticated;
create view public.vision_stock_balances with(security_invoker=true) as select workspace_id,item_id,location,unit,sum(qty) as qty,case when bool_and(unit_cost is not null) then sum(qty*unit_cost) else null end as recorded_value from public.vision_stock_movements group by workspace_id,item_id,location,unit;
grant select on public.vision_stock_balances to authenticated,service_role;

create function public.vision_bootstrap(p_user uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$begin insert into public.vision_workspaces(id,name) values(p_user,'My kitchen') on conflict do nothing;insert into public.vision_memberships values(p_user,p_user,'owner') on conflict do nothing;end $$;
create function public.vision_set_member(p_scope uuid,p_actor uuid,p_email text,p_role text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare target uuid;begin
 perform pg_advisory_xact_lock(hashtextextended(p_scope::text,1));
 if not exists(select 1 from public.vision_memberships where workspace_id=p_scope and user_id=p_actor and role='owner') then raise exception 'Only the kitchen owner can change membership' using errcode='42501';end if;
 select id into target from auth.users where lower(email)=lower(trim(p_email));if target is null then raise exception 'Create this user in Supabase Authentication first';end if;
 if target=p_scope then raise exception 'The kitchen owner cannot be removed or demoted';end if;
 if p_role='remove' then delete from public.vision_memberships where workspace_id=p_scope and user_id=target;delete from public.vision_push_subscriptions where workspace_id=p_scope and user_id=target;
 elsif p_role in ('viewer','staff','manager') then insert into public.vision_memberships values(p_scope,target,p_role) on conflict(workspace_id,user_id) do update set role=excluded.role;
 else raise exception 'Invalid role';end if;
end $$;

create function public.vision_sync_workspace(p_workspace uuid,p_actor uuid,p_events jsonb,p_since bigint,p_catalog jsonb default '[]',p_catalog_at bigint default 0,p_drafts jsonb default '[]') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare access_role text; e jsonb; d jsonb; output jsonb;op text;rec record;
begin
 select role into access_role from public.vision_memberships where workspace_id=p_workspace and user_id=p_actor;
 if access_role is null then raise exception 'Kitchen membership required' using errcode='42501';end if;
 if access_role='viewer' and (jsonb_array_length(p_events)>0 or jsonb_array_length(p_drafts)>0 or jsonb_array_length(p_catalog)>0) then raise exception 'Viewer accounts cannot write records' using errcode='42501';end if;
 if access_role not in ('owner','manager') and exists(select 1 from jsonb_array_elements(p_events) x where x->>'kind'='ingredient' or x->>'kind'='settings' and x->>'entityId'='waste-lists') then raise exception 'Manager permission required for ingredient and staff setup' using errcode='42501';end if;
 if jsonb_array_length(p_drafts)>40 then raise exception 'Too many drafts';end if;
 output=public.vision_sync(p_workspace,p_events,p_since,p_catalog,p_catalog_at);
 for e in select value from jsonb_array_elements(p_events) loop
  update public.vision_events set created_by=p_actor where owner=p_workspace and event_id=e->>'id' and created_by is null;
 end loop;
 for e in select jsonb_build_object('kind',kind,'entityId',entity_id,'data',payload) from public.vision_events where owner=p_workspace and kind='waste' loop
  -- Waste snapshots automatically create one stock movement, without inventing an opening balance.
  if e->>'kind'='waste' and (e->'data'->>'baseQty')::numeric>0 and e->'data'->>'baseUnit' is not null then
   op='waste:'||(e->>'entityId');
   insert into public.vision_operations(workspace_id,operation_id,kind,payload,actor) values(p_workspace,op,'waste',e->'data',p_actor) on conflict do nothing;
   insert into public.vision_stock_movements(workspace_id,movement_id,operation_id,item_id,location,unit,qty,unit_cost) values(p_workspace,op,op,e->'data'->>'itemId',coalesce(nullif(e->'data'->>'location',''),'Kitchen'),e->'data'->>'baseUnit',-(e->'data'->>'baseQty')::numeric,case when (e->'data'->>'baseQty')::numeric>0 then (e->'data'->>'value')::numeric/(e->'data'->>'baseQty')::numeric end) on conflict do nothing;
  end if;
 end loop;
 -- A correction restores local/Supabase stock exactly once. It does not claim to reverse Sheets.
 for rec in select distinct v.payload->>'recordId' as id from public.vision_events v where v.owner=p_workspace and v.kind='waste_void' loop
  op='void-waste:'||rec.id;
  if exists(select 1 from public.vision_stock_movements where workspace_id=p_workspace and movement_id='waste:'||rec.id) then
   insert into public.vision_operations values(p_workspace,op,'waste_void',jsonb_build_object('recordId',rec.id),p_actor,now()) on conflict do nothing;
   insert into public.vision_stock_movements select workspace_id,op,op,item_id,location,unit,-qty,unit_cost,now() from public.vision_stock_movements where workspace_id=p_workspace and movement_id='waste:'||rec.id on conflict do nothing;
  end if;
 end loop;
 for d in select value from jsonb_array_elements(p_drafts) loop
  if d->>'key' is null or d->>'revision' is null or jsonb_typeof(d->'payload')<>'object' then raise exception 'Invalid draft';end if;
  if exists(select 1 from public.vision_drafts where workspace_id=p_workspace and draft_key=d->>'key' and revision=d->>'revision' and payload<>d->'payload') then raise exception 'Immutable draft conflict';end if;
  insert into public.vision_drafts values(p_workspace,d->>'key',d->>'revision',d->>'parentRevision',d->'payload',p_actor,(d->>'at')::bigint) on conflict do nothing;
 end loop;
 return output||jsonb_build_object('drafts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select draft_key,revision,parent_revision,payload,updated_by,updated_at from public.vision_drafts d where workspace_id=p_workspace and not exists(select 1 from public.vision_drafts child where child.workspace_id=d.workspace_id and child.draft_key=d.draft_key and child.parent_revision=d.revision)) x));
end $$;

create function public.vision_apply_stock(p_workspace uuid,p_actor uuid,p_id text,p_kind text,p_payload jsonb,p_moves jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old jsonb;m jsonb;balance numeric;role_name text;idx integer=0;result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,0));
 select role into role_name from public.vision_memberships where workspace_id=p_workspace and user_id=p_actor;
 if role_name is null or role_name='viewer' or (p_kind<>'production' and role_name not in ('owner','manager')) then raise exception 'Insufficient stock permission' using errcode='42501';end if;
 if p_kind not in ('receipt','adjustment','transfer','production','reversal') or length(p_id)>220 or jsonb_array_length(p_moves) not between 1 and 200 then raise exception 'Invalid stock operation';end if;
 select payload into old from public.vision_operations where workspace_id=p_workspace and operation_id=p_id;
 if found then if old<>p_payload then raise exception 'Operation ID already has different details' using errcode='23505';end if;return jsonb_build_object('status','success','operationId',p_id,'alreadyConfirmed',true);end if;
 if p_kind='receipt' and p_payload->>'invoiceKey' is not null then
  if exists(select 1 from public.vision_purchase_receipts where workspace_id=p_workspace and invoice_key=p_payload->>'invoiceKey' and state='active') then raise exception 'This invoice already has an active stock receipt. Reverse it before receiving a corrected review' using errcode='23505';end if;
  insert into public.vision_purchase_receipts values(p_workspace,p_payload->>'invoiceKey',p_payload->>'invoiceRoot',p_id,'active') on conflict(workspace_id,invoice_key) do update set operation_id=excluded.operation_id,invoice_root=excluded.invoice_root,state='active';
 end if;
 if p_kind='reversal' then update public.vision_purchase_receipts set state='reversed' where workspace_id=p_workspace and operation_id=p_payload->>'operationId';end if;
 insert into public.vision_operations(workspace_id,operation_id,kind,payload,actor) values(p_workspace,p_id,p_kind,p_payload,p_actor);
 for m in select value from jsonb_array_elements(p_moves) loop
  idx=idx+1;
  if m->>'itemId' is null or m->>'location' is null or m->>'unit' not in ('g','kg','mL','L','ea','oz','lb') or (m->>'qty')::numeric=0 or coalesce((m->>'unitCost')::numeric,0)<0 then raise exception 'Invalid stock movement';end if;
  if p_kind='adjustment' then select coalesce(sum(qty),0) into balance from public.vision_stock_movements where workspace_id=p_workspace and item_id=m->>'itemId' and location=m->>'location' and unit=m->>'unit';if balance<>(p_payload->>'expectedBalance')::numeric then raise exception 'Stock changed. Refresh the count before approving';end if;end if;
  if p_kind in ('production','transfer') and (m->>'qty')::numeric<0 then
   select coalesce(sum(qty),0) into balance from public.vision_stock_movements where workspace_id=p_workspace and item_id=m->>'itemId' and location=m->>'location' and unit=m->>'unit';
   if balance+(m->>'qty')::numeric<0 then raise exception 'Insufficient stock for % at %',m->>'itemId',m->>'location';end if;
  end if;
  insert into public.vision_stock_movements(workspace_id,movement_id,operation_id,item_id,location,unit,qty,unit_cost) values(p_workspace,p_id||':'||idx,p_id,m->>'itemId',m->>'location',m->>'unit',(m->>'qty')::numeric,(m->>'unitCost')::numeric);
 end loop;
 return jsonb_build_object('status','success','operationId',p_id,'alreadyConfirmed',false);
end $$;
revoke all on function public.vision_bootstrap(uuid),public.vision_set_member(uuid,uuid,text,text),public.vision_sync_workspace(uuid,uuid,jsonb,bigint,jsonb,bigint,jsonb),public.vision_apply_stock(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.vision_bootstrap(uuid),public.vision_set_member(uuid,uuid,text,text),public.vision_sync_workspace(uuid,uuid,jsonb,bigint,jsonb,bigint,jsonb),public.vision_apply_stock(uuid,uuid,text,text,jsonb,jsonb) to service_role;

-- Append-only reconciliation note with an explicit manager attestation. No retry.

create function public.vision_reconcile_posting(p_workspace uuid,p_actor uuid,p_key text,p_note text,p_confirm boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare posting record;begin
 if not exists(select 1 from public.vision_memberships where workspace_id=p_workspace and user_id=p_actor and role in ('owner','manager')) then raise exception 'Manager permission required' using errcode='42501';end if;
 select * into posting from public.vision_postings where owner=p_workspace and key=p_key for update;
 if not found then raise exception 'Posting not found';end if;
 insert into public.vision_reconciliations values(p_workspace,p_key,p_note,p_actor,now()) on conflict(workspace_id,posting_key) do update set note=vision_reconciliations.note||E'\n'||excluded.note,actor=excluded.actor,created_at=excluded.created_at;
 if p_confirm then update public.vision_postings set status='confirmed',result=jsonb_build_object('status','success','eventId',posting.record_id,'manuallyReconciled',true,'confirmedAt',(extract(epoch from clock_timestamp())*1000)::bigint),updated_at=(extract(epoch from clock_timestamp())*1000)::bigint where owner=p_workspace and key=p_key;end if;
end $$;
revoke all on function public.vision_reconcile_posting(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.vision_reconcile_posting(uuid,uuid,text,text,boolean) to service_role;
commit;

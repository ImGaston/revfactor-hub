begin;

-- Checkpoints contain confirmed property identity, never credentials/invite URLs.
create table public.ghl_assembly_checkpoints (
  portal_id text not null,
  owner_key text not null,
  revision integer not null check(revision >= 0),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  updated_at timestamptz not null default now(),
  primary key(portal_id,owner_key),
  check((payload->>'revision')::integer = revision)
);
alter table public.ghl_assembly_checkpoints enable row level security;
create policy ghl_assembly_checkpoint_read on public.ghl_assembly_checkpoints for select to authenticated
  using(public.has_permission('onboarding','view'));

create table public.ghl_onboarding_exceptions (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.ghl_onboarding_journeys(id),
  job_id uuid not null references public.ghl_onboarding_jobs(id),
  owner_id text not null,
  code text not null check(code ~ '^[a-z0-9_]{1,100}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(job_id,code)
);
alter table public.ghl_onboarding_exceptions enable row level security;
create policy ghl_onboarding_exception_read on public.ghl_onboarding_exceptions for select to authenticated
  using(public.has_permission('ghl','view'));
create index ghl_onboarding_exception_open on public.ghl_onboarding_exceptions(journey_id) where resolved_at is null;
alter table public.ghl_onboarding_jobs add column failure_count integer not null default 0 check(failure_count >= 0);

-- attempts counts claims for diagnostics; only actual failures use the retry budget.
create or replace function public.claim_ghl_onboarding_job(p_kind text) returns setof public.ghl_onboarding_jobs
language sql security definer set search_path=public as $$
  update public.ghl_onboarding_jobs set status='running',attempts=attempts+1,
    lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid(),updated_at=now()
  where id=(select id from public.ghl_onboarding_jobs where kind=p_kind and failure_count<5
    and available_at<=now() and (status in ('pending','failed') or (status='running' and lease_until<now()))
    order by available_at for update skip locked limit 1) returning *;
$$;

create function public.cas_ghl_assembly_checkpoint(
  p_portal_id text,p_owner_key text,p_revision integer,p_payload jsonb,p_job_id uuid,p_lease_token uuid
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.ghl_onboarding_jobs%rowtype; owner_contact text; changed integer;
begin
  select * into job from public.ghl_onboarding_jobs where id=p_job_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_lease_token or job.lease_until<=now()
    or job.kind not in ('assembly_provision','activation_check') then return false; end if;
  select contact_id into owner_contact from public.ghl_onboarding_journeys where id=job.journey_id
    and submitted_snapshot is not null and stage in ('submitted','portal_invited','portal_active')
    and not coalesce((payload->>'manualTakeover')::boolean,false);
  if not found then return false; end if;
  if p_owner_key is distinct from 'rf-owner:'||owner_contact or nullif(btrim(p_portal_id),'') is null
    or jsonb_typeof(p_payload)<>'object'
    or (p_payload->>'revision')::integer is distinct from coalesce(p_revision+1,0) then raise exception 'checkpoint_invalid'; end if;
  if p_revision is null then
    insert into public.ghl_assembly_checkpoints(portal_id,owner_key,revision,payload)
      values(p_portal_id,p_owner_key,0,p_payload) on conflict do nothing;
  else
    update public.ghl_assembly_checkpoints set revision=p_revision+1,payload=p_payload,updated_at=now()
      where portal_id=p_portal_id and owner_key=p_owner_key and revision=p_revision;
  end if;
  get diagnostics changed = row_count;
  return changed=1;
end; $$;

create function public.finish_ghl_assembly_job(
  p_job_id uuid,p_lease_token uuid,p_outcome text,p_result jsonb,p_error_code text default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.ghl_onboarding_jobs%rowtype; journey public.ghl_onboarding_journeys%rowtype;
  target_stage text; terminal_code text; failures integer; company_id text; client_id text;
begin
  select * into job from public.ghl_onboarding_jobs where id=p_job_id;
  if not found then return false; end if;
  -- Match save/control lock order: journey first, then job. Otherwise a pause
  -- can deadlock while each transaction waits for the other's row lock.
  select * into journey from public.ghl_onboarding_journeys where id=job.journey_id for update;
  select * into job from public.ghl_onboarding_jobs where id=p_job_id for update;
  if not found or job.journey_id is distinct from journey.id or job.status<>'running' or job.lease_token is distinct from p_lease_token or job.lease_until<=now()
    or job.kind not in ('assembly_provision','activation_check') then return false; end if;
  if p_outcome not in ('pending','portal_invited','portal_active','manual_review','failed') or jsonb_typeof(p_result)<>'object'
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,100}$') then raise exception 'worker_result_invalid'; end if;
  if p_outcome in ('portal_invited','portal_active') and journey.submitted_snapshot is null then raise exception 'accepted_snapshot_required'; end if;
  if p_outcome in ('portal_invited','portal_active') then
    company_id=nullif(p_result->>'companyId','');client_id=nullif(p_result->>'clientId','');
    if company_id is null or client_id is null or length(company_id)>200 or length(client_id)>200 then raise exception 'portal_identity_required'; end if;
    if (journey.assembly_client_id is not null and journey.assembly_client_id<>client_id)
      or (journey.assembly_company_id is not null and journey.assembly_company_id<>company_id) then raise exception 'portal_identity_conflict'; end if;
    if journey.stage not in ('submitted','portal_invited','portal_active') or coalesce((journey.payload->>'manualTakeover')::boolean,false)
      then raise exception 'journey_not_accepting_progress'; end if;
    target_stage=case when journey.stage='portal_active' then 'portal_active' else p_outcome end;
    if journey.stage<>target_stage or journey.assembly_client_id is null then
      -- submitted_snapshot is deliberately never assigned here.
      update public.ghl_onboarding_journeys set stage=target_stage,payload=jsonb_set(payload,'{stage}',to_jsonb(target_stage)),
        assembly_client_id=client_id,assembly_company_id=company_id,revision=revision+1,last_progress_at=now(),updated_at=now(),exception_code=null
        where id=journey.id;
      insert into public.ghl_onboarding_events(journey_id,event_key,request_hash,event_type,revision)
        values(journey.id,'assembly:'||job.id::text||':'||target_stage,'provider-verified:'||client_id,target_stage,journey.revision+1)
        on conflict(journey_id,event_key) do nothing;
      insert into public.ghl_onboarding_jobs(journey_id,kind) values(journey.id,'ghl_progress')
        on conflict(journey_id,kind) do update set status='pending',available_at=now(),updated_at=now()
        where public.ghl_onboarding_jobs.status<>'running';
    end if;
    -- Implemented by the following migration. Failure rolls back the job completion;
    -- provider IDs remain recoverable from the durable checkpoint without another invite.
    perform public.link_ghl_onboarding_operations(job.journey_id);
    if target_stage='portal_invited' and job.kind='assembly_provision' then
      insert into public.ghl_onboarding_jobs(journey_id,kind,available_at) values(journey.id,'activation_check',now()+interval '1 hour')
        on conflict(journey_id,kind) do nothing;
    end if;
    update public.ghl_onboarding_jobs set status=case when target_stage='portal_invited' and kind='activation_check' then 'pending' else 'completed' end,
      available_at=now()+interval '1 hour',lease_until=null,lease_token=null,result=p_result,error_code=null,updated_at=now()
      where id=job.id;
  elsif p_outcome='pending' then
    update public.ghl_onboarding_jobs set status='pending',available_at=now()+interval '1 minute',lease_until=null,lease_token=null,
      result=p_result,error_code=null,updated_at=now() where id=job.id;
  else
    failures=job.failure_count+case when p_outcome='failed' then 1 else 0 end;
    terminal_code=case when p_outcome='manual_review' or failures>=5 then coalesce(p_error_code,'assembly_worker_failed') else null end;
    update public.ghl_onboarding_jobs set status=case when terminal_code is not null then 'manual_review' else 'failed' end,
      failure_count=failures,available_at=now()+interval '5 minutes',lease_until=null,lease_token=null,
      result=p_result,error_code=coalesce(p_error_code,'assembly_worker_failed'),updated_at=now() where id=job.id;
    if terminal_code is not null then
      insert into public.ghl_onboarding_exceptions(journey_id,job_id,owner_id,code)
        values(journey.id,job.id,journey.owner_id,terminal_code)
        on conflict(job_id,code) do update set updated_at=now(),resolved_at=null;
      update public.ghl_onboarding_journeys set exception_code=terminal_code,updated_at=now() where id=journey.id;
    end if;
  end if;
  return true;
end; $$;

revoke all on function public.claim_ghl_onboarding_job(text) from public,anon,authenticated;
revoke all on function public.cas_ghl_assembly_checkpoint(text,text,integer,jsonb,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_ghl_assembly_job(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_ghl_onboarding_job(text) to service_role;
grant execute on function public.cas_ghl_assembly_checkpoint(text,text,integer,jsonb,uuid,uuid) to service_role;
grant execute on function public.finish_ghl_assembly_job(uuid,uuid,text,jsonb,text) to service_role;
grant all on public.ghl_assembly_checkpoints,public.ghl_onboarding_exceptions to service_role;
grant select on public.ghl_onboarding_exceptions to authenticated;
commit;

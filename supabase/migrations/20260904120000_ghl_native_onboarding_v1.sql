-- Pre-Assembly intake ledger. Existing operational onboarding_runs remain intact.
-- Only the validated server service can write commercial truth or final snapshots.
begin;
create table public.ghl_onboarding_journeys (
  id uuid primary key,
  run_key text not null unique,
  contact_id text not null,
  opportunity_id text not null,
  appointment_id text not null,
  owner_id text not null,
  team_profile_id uuid references public.profiles(id),
  stage text not null check (stage in ('signup','awaiting_payment','onboarding','submitted','portal_invited','portal_active','exception')),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  submitted_snapshot jsonb,
  context_token_hash text not null unique,
  context_expires_at timestamptz not null,
  hub_client_id uuid references public.clients(id),
  onboarding_run_id uuid references public.onboarding_runs(id),
  assembly_client_id text,
  assembly_company_id text,
  exception_code text,
  last_progress_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payload->>'id' = id::text),
  check (payload->>'stage' = stage)
);
create index ghl_onboarding_journeys_queue on public.ghl_onboarding_journeys(stage,last_progress_at);
create table public.ghl_onboarding_commercial_bindings (
  account_id uuid primary key,
  journey_id uuid not null references public.ghl_onboarding_journeys(id),
  document_id text not null unique,
  invoice_id text not null unique,
  payment_intent_id text not null unique
);
alter table public.ghl_onboarding_commercial_bindings enable row level security;
create policy ghl_billing_admin_read on public.ghl_onboarding_commercial_bindings for select to authenticated
  using (public.get_my_role() = 'super_admin');
create table public.ghl_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.ghl_onboarding_journeys(id),
  event_key text not null,
  request_hash text not null,
  event_type text not null,
  revision integer not null,
  created_at timestamptz not null default now(),
  unique(journey_id,event_key)
);
create table public.ghl_onboarding_jobs (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.ghl_onboarding_journeys(id),
  kind text not null check (kind in ('assembly_provision','activation_check','ghl_progress')),
  status text not null default 'pending' check (status in ('pending','running','completed','failed','manual_review')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  result jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(journey_id,kind)
);
create index ghl_onboarding_jobs_due on public.ghl_onboarding_jobs(status,available_at);
alter table public.ghl_onboarding_journeys enable row level security;
alter table public.ghl_onboarding_events enable row level security;
alter table public.ghl_onboarding_jobs enable row level security;
-- Payload contains prices and billing identities. A separately permission-checked
-- server projection serves nonfinancial status; raw payload is super-admin only.
create policy ghl_journeys_admin_read on public.ghl_onboarding_journeys for select to authenticated
  using (public.get_my_role() = 'super_admin');
create policy ghl_events_read on public.ghl_onboarding_events for select to authenticated
  using (public.has_permission('ghl','view'));
create policy ghl_jobs_read on public.ghl_onboarding_jobs for select to authenticated
  using (public.has_permission('ghl','view'));

create function public.save_ghl_onboarding_v1(
  p_id uuid, p_revision integer, p_event_key text, p_request_hash text,
  p_event_type text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare current_row public.ghl_onboarding_journeys%rowtype;
  receipt public.ghl_onboarding_events%rowtype;
  account jsonb;
begin
  select * into current_row from public.ghl_onboarding_journeys where id=p_id for update;
  if not found then raise exception 'journey_not_found'; end if;
  select * into receipt from public.ghl_onboarding_events where journey_id=p_id and event_key=p_event_key;
  if found then
    if receipt.request_hash <> p_request_hash then raise exception 'event_payload_conflict'; end if;
    return jsonb_build_object('revision',receipt.revision,'replayed',true);
  end if;
  if current_row.revision <> p_revision then raise exception 'revision_conflict'; end if;
  if current_row.submitted_snapshot is not null then raise exception 'submitted_journey_locked'; end if;
  if p_payload->>'id' is distinct from p_id::text
    or p_payload->>'contactId' is distinct from current_row.contact_id
    or p_payload->>'opportunityId' is distinct from current_row.opportunity_id
    or p_payload->>'appointmentId' is distinct from current_row.appointment_id
    then raise exception 'identity_mismatch'; end if;
  if p_payload->>'stage' = 'submitted' and p_event_type <> 'submit' then raise exception 'invalid_submission'; end if;
  if p_event_type='bind' then
    for account in select value from jsonb_array_elements(p_payload->'accounts') loop
      if account->>'documentId' is not null then
        insert into public.ghl_onboarding_commercial_bindings(account_id,journey_id,document_id,invoice_id,payment_intent_id)
          values((account->>'id')::uuid,p_id,account->>'documentId',account->>'invoiceId',account->>'stripePaymentIntentId')
          on conflict(account_id) do nothing;
      end if;
    end loop;
  end if;
  update public.ghl_onboarding_journeys set payload=p_payload, stage=p_payload->>'stage', owner_id=p_payload->>'ownerId',
    submitted_snapshot=case when p_event_type='submit' then p_payload else null end,
    revision=revision+1,last_progress_at=now(),updated_at=now() where id=p_id;
  insert into public.ghl_onboarding_events(journey_id,event_key,request_hash,event_type,revision)
    values(p_id,p_event_key,p_request_hash,p_event_type,p_revision+1);
  if p_event_type='submit' then
    insert into public.ghl_onboarding_jobs(journey_id,kind) values(p_id,'assembly_provision') on conflict do nothing;
  end if;
  insert into public.ghl_onboarding_jobs(journey_id,kind) values(p_id,'ghl_progress')
    on conflict(journey_id,kind) do update set status='pending',available_at=now(),updated_at=now()
    where public.ghl_onboarding_jobs.status <> 'running';
  return jsonb_build_object('revision',p_revision+1,'replayed',false);
end; $$;
revoke all on function public.save_ghl_onboarding_v1(uuid,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_ghl_onboarding_v1(uuid,integer,text,text,text,jsonb) to service_role;

create function public.claim_ghl_onboarding_job(p_kind text) returns setof public.ghl_onboarding_jobs
language sql security definer set search_path=public as $$
  update public.ghl_onboarding_jobs set status='running',attempts=attempts+1,
    lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid(),updated_at=now()
  where id=(select id from public.ghl_onboarding_jobs where kind=p_kind and attempts<5
    and available_at<=now() and (status in ('pending','failed') or (status='running' and lease_until<now()))
    order by available_at for update skip locked limit 1) returning *;
$$;
revoke all on function public.claim_ghl_onboarding_job(text) from public,anon,authenticated;
grant execute on function public.claim_ghl_onboarding_job(text) to service_role;
grant all on public.ghl_onboarding_journeys,public.ghl_onboarding_commercial_bindings,public.ghl_onboarding_events,public.ghl_onboarding_jobs to service_role;
grant select on public.ghl_onboarding_journeys,public.ghl_onboarding_commercial_bindings,public.ghl_onboarding_events,public.ghl_onboarding_jobs to authenticated;
commit;

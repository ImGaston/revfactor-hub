begin;

-- Human verification evidence is append-only and separate from the accepted
-- client snapshot. Direct authenticated writes are deliberately unavailable;
-- the verification RPC below is the only team mutation path.
create table public.ghl_onboarding_task_verifications_v1 (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.onboarding_run_tasks(id) on delete restrict,
  run_id uuid not null references public.onboarding_runs(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  evidence text not null check (length(btrim(evidence)) between 1 and 2000),
  verified_at timestamptz not null default now()
);

create index ghl_onboarding_task_verifications_v1_run
  on public.ghl_onboarding_task_verifications_v1(run_id, verified_at desc);

alter table public.ghl_onboarding_task_verifications_v1 enable row level security;
create policy ghl_onboarding_task_verifications_v1_read
  on public.ghl_onboarding_task_verifications_v1
  for select to authenticated
  using (public.has_permission('onboarding', 'view'));

create function public.prevent_ghl_onboarding_verification_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'ghl_onboarding_verification_immutable';
end;
$$;

create trigger ghl_onboarding_verification_immutable_v1
before update or delete on public.ghl_onboarding_task_verifications_v1
for each row execute function public.prevent_ghl_onboarding_verification_mutation_v1();

create function public.enforce_ghl_onboarding_task_verification_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_is_v1 boolean := false;
  new_is_v1 boolean := false;
begin
  if tg_op <> 'INSERT' then
    select exists(
      select 1 from public.onboarding_runs r
      where r.id = old.run_id and r.external_key like 'ghl-v1-%'
    ) into old_is_v1;
  end if;
  if tg_op <> 'DELETE' then
    select exists(
      select 1 from public.onboarding_runs r
      where r.id = new.run_id and r.external_key like 'ghl-v1-%'
    ) into new_is_v1;
  end if;
  if not old_is_v1 and not new_is_v1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.team_status = 'verified' then raise exception 'atomic_verification_required'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.team_status = 'verified' or exists(
      select 1 from public.ghl_onboarding_task_verifications_v1 v where v.task_id = old.id
    ) then raise exception 'ghl_onboarding_verification_immutable'; end if;
    return old;
  end if;

  if new.id is distinct from old.id
    or new.run_id is distinct from old.run_id
    or new.task_key is distinct from old.task_key then
    raise exception 'ghl_onboarding_task_identity_immutable';
  end if;

  if old.team_status = 'verified' and (
    new.team_status <> 'verified'
    or new.team_verified_at is distinct from old.team_verified_at
  ) then
    raise exception 'ghl_onboarding_verification_immutable';
  end if;
  if old.team_status <> 'verified' and new.team_status = 'verified' and not exists(
    select 1 from public.ghl_onboarding_task_verifications_v1 v
    where v.task_id = new.id and v.run_id = new.run_id
  ) then
    raise exception 'atomic_verification_required';
  end if;
  return new;
end;
$$;

create trigger enforce_ghl_onboarding_task_verification_v1
before insert or update or delete on public.onboarding_run_tasks
for each row execute function public.enforce_ghl_onboarding_task_verification_v1();

-- Safe, explicit projection. The function omits the journey payload, accepted
-- snapshot, contact identifiers, commercial bindings, provider identifiers,
-- task notes, and unsafe listing URLs.
create function public.list_ghl_onboarding_team_review_v1()
returns table (
  journey_id uuid,
  run_id uuid,
  client_name text,
  property_name text,
  property_street text,
  property_unit text,
  property_city text,
  property_region text,
  property_postal_code text,
  property_country text,
  property_status text,
  listing_url text,
  target_launch_date text,
  property_goal text,
  minimum_nightly_mode text,
  minimum_nightly_value numeric,
  minimum_stay_mode text,
  minimum_stay_nights integer,
  cleaning_fee_mode text,
  cleaning_fee_value numeric,
  operating_constraints text,
  software_status text,
  pms_name text,
  portal_status text,
  run_submitted_at timestamptz,
  task_id uuid,
  task_kind text,
  task_label text,
  client_status text,
  team_status text,
  owner_profile_id uuid,
  owner_name text,
  task_updated_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  verification_evidence text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.has_permission('onboarding', 'view') is not true then
    raise exception 'onboarding_review_forbidden';
  end if;

  return query
  select
    j.id,
    r.id,
    c.name,
    l.name,
    accepted_property.data#>>'{address,street}',
    accepted_property.data#>>'{address,unit}',
    accepted_property.data#>>'{address,city}',
    accepted_property.data#>>'{address,region}',
    accepted_property.data#>>'{address,postalCode}',
    accepted_property.data#>>'{address,country}',
    accepted_property.data->>'status',
    case
      when length(accepted_property.data->>'listingUrl') <= 2048
        and accepted_property.data->>'listingUrl' ~* '^https?://[^[:space:]]+$'
      then accepted_property.data->>'listingUrl'
    end,
    accepted_property.data->>'targetLaunchDate',
    accepted_property.data#>>'{preferences,goal}',
    accepted_property.data#>>'{preferences,minimumNightly,mode}',
    case when accepted_property.data#>>'{preferences,minimumNightly,mode}' = 'specified'
      then (accepted_property.data#>>'{preferences,minimumNightly,value}')::numeric end,
    accepted_property.data#>>'{preferences,minimumStay,mode}',
    case when accepted_property.data#>>'{preferences,minimumStay,mode}' = 'specified'
      then (accepted_property.data#>>'{preferences,minimumStay,nights}')::integer end,
    accepted_property.data#>>'{preferences,cleaningFee,mode}',
    case when accepted_property.data#>>'{preferences,cleaningFee,mode}' = 'specified'
      then (accepted_property.data#>>'{preferences,cleaningFee,value}')::numeric end,
    accepted_property.data#>>'{preferences,operatingConstraints}',
    case when t.task_key in ('pms', 'airbnb', 'pricelabs')
      then j.submitted_snapshot->'software'->>t.task_key end,
    case when t.task_key = 'pms' then j.submitted_snapshot#>>'{software,pmsName}' end,
    j.stage,
    r.submitted_at,
    t.id,
    case when t.task_key like 'v1-property:%' then 'property' else 'software' end,
    case t.task_key
      when 'pms' then 'Property management system'
      when 'airbnb' then 'Airbnb access'
      when 'pricelabs' then 'PriceLabs access'
      else coalesce(l.name, 'Property review')
    end,
    t.client_status,
    t.team_status,
    t.owner_profile_id,
    coalesce(nullif(btrim(owner_profile.full_name), ''), owner_profile.email),
    t.updated_at,
    verification.verified_at,
    coalesce(nullif(btrim(actor_profile.full_name), ''), actor_profile.email),
    verification.evidence
  from public.ghl_onboarding_journeys j
  join public.onboarding_runs r on r.id = j.onboarding_run_id
  join public.clients c on c.id = r.client_id
  join public.onboarding_run_tasks t on t.run_id = r.id
  left join public.onboarding_run_listings l
    on t.task_key = 'v1-property:' || l.id::text and l.run_id = r.id
  left join lateral (
    select property.value as data
    from jsonb_array_elements(j.submitted_snapshot->'properties') property
    where property.value->>'id' = l.id::text
    limit 1
  ) accepted_property on true
  left join public.profiles owner_profile on owner_profile.id = t.owner_profile_id
  left join public.ghl_onboarding_task_verifications_v1 verification on verification.task_id = t.id
  left join public.profiles actor_profile on actor_profile.id = verification.actor_profile_id
  where j.submitted_snapshot is not null
    and j.stage in ('portal_invited', 'portal_active')
    and r.external_key = 'ghl-v1-' || j.id::text
    and r.submitted_payload->>'version' = 'rf.onboarding.v1'
    and t.team_status in ('pending', 'verified')
    and (t.task_key in ('pms', 'airbnb', 'pricelabs') or accepted_property.data is not null)
  order by r.submitted_at desc nulls last, c.name, l.sequence nulls last, t.task_key;
end;
$$;

create function public.verify_ghl_onboarding_task_v1(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_evidence text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  target_run_id uuid;
  accepted_journey public.ghl_onboarding_journeys%rowtype;
  target_task public.onboarding_run_tasks%rowtype;
  next_updated_at timestamptz;
begin
  if auth.uid() is null or public.has_permission('onboarding', 'edit') is not true then
    raise exception 'onboarding_verification_forbidden';
  end if;
  if p_expected_updated_at is null then raise exception 'task_version_required'; end if;
  if p_evidence is null or length(btrim(p_evidence)) not between 1 and 2000 then
    raise exception 'verification_evidence_required';
  end if;

  -- Establish journey -> task lock order while refusing non-V1 and unaccepted runs.
  select t.run_id into target_run_id from public.onboarding_run_tasks t where t.id = p_task_id;
  if target_run_id is null then raise exception 'onboarding_task_not_found'; end if;

  select j.* into accepted_journey
  from public.ghl_onboarding_journeys j
  join public.onboarding_runs r on r.id = j.onboarding_run_id
  where r.id = target_run_id
    and j.submitted_snapshot is not null
    and j.stage in ('portal_invited', 'portal_active')
    and r.external_key = 'ghl-v1-' || j.id::text
    and r.submitted_payload->>'version' = 'rf.onboarding.v1'
  for update of j;
  if not found then raise exception 'accepted_v1_run_required'; end if;

  select * into target_task
  from public.onboarding_run_tasks
  where id = p_task_id and run_id = target_run_id
  for update;
  if not found then raise exception 'onboarding_task_not_found'; end if;
  if target_task.updated_at is distinct from p_expected_updated_at then
    raise exception 'onboarding_task_stale';
  end if;
  if target_task.team_status <> 'pending' then raise exception 'onboarding_task_not_pending'; end if;

  next_updated_at := clock_timestamp();
  insert into public.ghl_onboarding_task_verifications_v1(
    task_id, run_id, actor_profile_id, evidence, verified_at
  ) values (
    target_task.id, target_task.run_id, auth.uid(), btrim(p_evidence), next_updated_at
  );

  update public.onboarding_run_tasks
  set team_status = 'verified', team_verified_at = next_updated_at, updated_at = next_updated_at
  where id = target_task.id;
  return next_updated_at;
end;
$$;

revoke all on table public.ghl_onboarding_task_verifications_v1 from public, anon, authenticated;
grant select on table public.ghl_onboarding_task_verifications_v1 to authenticated;
grant all on table public.ghl_onboarding_task_verifications_v1 to service_role;

revoke all on function public.list_ghl_onboarding_team_review_v1() from public, anon;
grant execute on function public.list_ghl_onboarding_team_review_v1() to authenticated, service_role;
revoke all on function public.verify_ghl_onboarding_task_v1(uuid, timestamptz, text) from public, anon;
grant execute on function public.verify_ghl_onboarding_task_v1(uuid, timestamptz, text) to authenticated, service_role;
revoke all on function public.prevent_ghl_onboarding_verification_mutation_v1() from public, anon, authenticated;
revoke all on function public.enforce_ghl_onboarding_task_verification_v1() from public, anon, authenticated;

commit;

\set ON_ERROR_STOP on

-- Local-only integration fixture for migration 20260904128000.
-- Run after the onboarding V1 migrations. Every change is rolled back.
begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then
    raise exception 'assertion_failed: %', message;
  end if;
end;
$$;

insert into public.profiles (id, email, full_name, role)
values (
  '98000000-0000-4000-8000-000000000001',
  'reviewer@example.com',
  'Review Owner',
  'admin'
)
on conflict (id) do update
set email = excluded.email, full_name = excluded.full_name, role = excluded.role;

insert into public.role_permissions (role_name, resource, action, allowed)
values
  ('admin', 'onboarding', 'view', false),
  ('admin', 'onboarding', 'edit', false),
  ('admin', 'onboarding', 'create', true)
on conflict (role_name, resource, action) do update set allowed = excluded.allowed;

insert into public.clients (id, name, email, status)
values
  ('98000000-0000-4000-8000-000000000010', 'Invited Client', 'invited@example.com', 'onboarding'),
  ('98000000-0000-4000-8000-000000000011', 'Active Client', 'active@example.com', 'onboarding'),
  ('98000000-0000-4000-8000-000000000012', 'Unaccepted Client', 'unaccepted@example.com', 'onboarding');

insert into public.onboarding_runs (
  id, client_id, external_key, status, current_step, submitted_payload, submitted_at
)
values
  (
    '98000000-0000-4000-8000-000000000020',
    '98000000-0000-4000-8000-000000000010',
    'ghl-v1-98000000-0000-4000-8000-000000000030',
    'submitted', 'review',
    '{"version":"rf.onboarding.v1","properties":[{"id":"98000000-0000-4000-8000-000000000040","name":"Invited Property","address":{"street":"1 Review Road","city":"Review City","region":"NY","postalCode":"10001","country":"US"},"status":"live","listingUrl":"https://example.com/listing","preferences":{"goal":"balanced","minimumNightly":{"mode":"specified","value":250},"minimumStay":{"mode":"specified","nights":3},"cleaningFee":{"mode":"guidance"},"operatingConstraints":"No Sunday check-ins"}}],"software":{"pms":"done","pmsName":"Host PMS","airbnb":"done","pricelabs":"need_help"}}',
    '2026-09-04T16:00:00Z'
  ),
  (
    '98000000-0000-4000-8000-000000000021',
    '98000000-0000-4000-8000-000000000011',
    'ghl-v1-98000000-0000-4000-8000-000000000031',
    'submitted', 'review',
    '{"version":"rf.onboarding.v1","properties":[],"software":{"pms":"need_help","pmsName":null,"airbnb":"done","pricelabs":"need_help"}}',
    '2026-09-04T17:00:00Z'
  ),
  (
    '98000000-0000-4000-8000-000000000022',
    '98000000-0000-4000-8000-000000000012',
    'ghl-v1-98000000-0000-4000-8000-000000000032',
    'submitted', 'review',
    '{"version":"rf.onboarding.v1"}', '2026-09-04T18:00:00Z'
  ),
  (
    '98000000-0000-4000-8000-000000000023',
    '98000000-0000-4000-8000-000000000012',
    'legacy-review-fixture',
    'submitted', 'review', '{}', '2026-09-04T18:30:00Z'
  );

insert into public.onboarding_run_listings (
  id, run_id, external_key, listing_kind, sequence, name
)
values
  (
    '98000000-0000-4000-8000-000000000040',
    '98000000-0000-4000-8000-000000000020',
    'primary-0', 'primary', 0, 'Invited Property'
  ),
  (
    '98000000-0000-4000-8000-000000000041',
    '98000000-0000-4000-8000-000000000021',
    'primary-0', 'primary', 0, 'Active Property'
  );

insert into public.ghl_onboarding_journeys (
  id, run_key, contact_id, opportunity_id, appointment_id, owner_id,
  team_profile_id, stage, payload, submitted_snapshot, context_token_hash,
  context_expires_at, hub_client_id, onboarding_run_id
)
values
  (
    '98000000-0000-4000-8000-000000000030', 'review-test-invited',
    'contact-review-1', 'opportunity-review-1', 'appointment-review-1', 'owner-review-1',
    '98000000-0000-4000-8000-000000000001', 'portal_invited',
    '{"id":"98000000-0000-4000-8000-000000000030","stage":"portal_invited"}',
    '{"version":"rf.onboarding.v1","accepted":"invited"}',
    'review-test-token-1', now() + interval '1 day',
    '98000000-0000-4000-8000-000000000010',
    '98000000-0000-4000-8000-000000000020'
  ),
  (
    '98000000-0000-4000-8000-000000000031', 'review-test-active',
    'contact-review-2', 'opportunity-review-2', 'appointment-review-2', 'owner-review-2',
    '98000000-0000-4000-8000-000000000001', 'portal_active',
    '{"id":"98000000-0000-4000-8000-000000000031","stage":"portal_active"}',
    '{"version":"rf.onboarding.v1","accepted":"active"}',
    'review-test-token-2', now() + interval '1 day',
    '98000000-0000-4000-8000-000000000011',
    '98000000-0000-4000-8000-000000000021'
  ),
  (
    '98000000-0000-4000-8000-000000000032', 'review-test-unaccepted',
    'contact-review-3', 'opportunity-review-3', 'appointment-review-3', 'owner-review-3',
    '98000000-0000-4000-8000-000000000001', 'submitted',
    '{"id":"98000000-0000-4000-8000-000000000032","stage":"submitted"}',
    '{"version":"rf.onboarding.v1","accepted":"submitted-only"}',
    'review-test-token-3', now() + interval '1 day',
    '98000000-0000-4000-8000-000000000012',
    '98000000-0000-4000-8000-000000000022'
  );

insert into public.onboarding_run_tasks (
  id, run_id, task_key, client_status, team_status, owner_profile_id, updated_at
)
values
  (
    '98000000-0000-4000-8000-000000000050',
    '98000000-0000-4000-8000-000000000020',
    'v1-property:98000000-0000-4000-8000-000000000040',
    'submitted', 'pending', '98000000-0000-4000-8000-000000000001',
    '2026-09-04T19:00:00Z'
  ),
  (
    '98000000-0000-4000-8000-000000000051',
    '98000000-0000-4000-8000-000000000021',
    'pms', 'submitted', 'pending', '98000000-0000-4000-8000-000000000001',
    '2026-09-04T19:00:00Z'
  ),
  (
    '98000000-0000-4000-8000-000000000052',
    '98000000-0000-4000-8000-000000000022',
    'pms', 'submitted', 'pending', '98000000-0000-4000-8000-000000000001',
    '2026-09-04T19:00:00Z'
  ),
  (
    '98000000-0000-4000-8000-000000000054',
    '98000000-0000-4000-8000-000000000020',
    'unknown-v1-task', 'submitted', 'pending',
    '98000000-0000-4000-8000-000000000001', '2026-09-04T19:00:00Z'
  ),
  (
    '98000000-0000-4000-8000-000000000055',
    '98000000-0000-4000-8000-000000000023',
    'legacy-task', 'submitted', 'pending',
    '98000000-0000-4000-8000-000000000001', '2026-09-04T19:00:00Z'
  );

-- Read context from the immutable journey snapshot, not the legacy run copy.
update public.ghl_onboarding_journeys j
set submitted_snapshot = r.submitted_payload || jsonb_build_object('accepted',j.submitted_snapshot->>'accepted')
from public.onboarding_runs r
where j.onboarding_run_id=r.id and j.submitted_snapshot is not null;

set local role authenticated;
set local "request.jwt.claim.sub" = '98000000-0000-4000-8000-000000000001';

do $$
begin
  begin
    perform public.list_ghl_onboarding_team_review_v1();
    raise exception 'expected onboarding_review_forbidden';
  exception when others then
    if sqlerrm <> 'onboarding_review_forbidden' then raise; end if;
  end;
  begin
    perform public.verify_ghl_onboarding_task_v1(
      '98000000-0000-4000-8000-000000000050',
      '2026-09-04T19:00:00Z', 'Checked property details.'
    );
    raise exception 'expected onboarding_verification_forbidden';
  exception when others then
    if sqlerrm <> 'onboarding_verification_forbidden' then raise; end if;
  end;
end;
$$;

reset role;
update public.role_permissions
set allowed = true
where role_name = 'admin' and resource = 'onboarding' and action in ('view', 'edit');
set local role authenticated;
set local "request.jwt.claim.sub" = '98000000-0000-4000-8000-000000000001';

select pg_temp.assert_true(
  (select count(*) = 2 from public.list_ghl_onboarding_team_review_v1()),
  'projection included an unaccepted run or omitted an accepted portal run'
);
select pg_temp.assert_true(
  (select count(distinct portal_status) = 2 from public.list_ghl_onboarding_team_review_v1()),
  'portal invited and active were not projected distinctly'
);
select pg_temp.assert_true(
  (select bool_and(owner_name = 'Review Owner') from public.list_ghl_onboarding_team_review_v1()),
  'assigned owner label was not projected'
);
select pg_temp.assert_true(
  (select property_street = '1 Review Road'
     and property_goal = 'balanced'
     and minimum_nightly_value = 250
     and minimum_stay_nights = 3
     and cleaning_fee_mode = 'guidance'
     and operating_constraints = 'No Sunday check-ins'
     and listing_url = 'https://example.com/listing'
   from public.list_ghl_onboarding_team_review_v1()
   where task_id = '98000000-0000-4000-8000-000000000050'),
  'accepted property verification context was not projected field by field'
);
select pg_temp.assert_true(
  (select software_status = 'need_help' and pms_name is null
   from public.list_ghl_onboarding_team_review_v1()
   where task_id = '98000000-0000-4000-8000-000000000051'),
  'software guidance context was not projected'
);

do $$
begin
  begin
    perform public.verify_ghl_onboarding_task_v1(
      '98000000-0000-4000-8000-000000000050',
      '2026-09-04T19:00:00Z', '   '
    );
    raise exception 'expected verification_evidence_required';
  exception when others then
    if sqlerrm <> 'verification_evidence_required' then raise; end if;
  end;
  begin
    perform public.verify_ghl_onboarding_task_v1(
      '98000000-0000-4000-8000-000000000050',
      '2026-09-04T18:59:59Z', 'Stale reviewer note.'
    );
    raise exception 'expected onboarding_task_stale';
  exception when others then
    if sqlerrm <> 'onboarding_task_stale' then raise; end if;
  end;
  begin
    insert into public.onboarding_run_tasks (
      id, run_id, task_key, client_status, team_status, owner_profile_id
    ) values (
      '98000000-0000-4000-8000-000000000053',
      '98000000-0000-4000-8000-000000000020',
      'pms', 'submitted', 'verified',
      '98000000-0000-4000-8000-000000000001'
    );
    raise exception 'expected atomic_verification_required on insert';
  exception when others then
    if sqlerrm <> 'atomic_verification_required' then raise; end if;
  end;
  begin
    update public.onboarding_run_tasks
    set run_id = '98000000-0000-4000-8000-000000000023'
    where id = '98000000-0000-4000-8000-000000000050';
    raise exception 'expected ghl_onboarding_task_identity_immutable';
  exception when others then
    if sqlerrm <> 'ghl_onboarding_task_identity_immutable' then raise; end if;
  end;
  begin
    update public.onboarding_run_tasks
    set run_id = '98000000-0000-4000-8000-000000000020'
    where id = '98000000-0000-4000-8000-000000000055';
    raise exception 'expected ghl_onboarding_task_identity_immutable';
  exception when others then
    if sqlerrm <> 'ghl_onboarding_task_identity_immutable' then raise; end if;
  end;
  begin
    update public.onboarding_run_tasks
    set team_status = 'verified', team_verified_at = now()
    where id = '98000000-0000-4000-8000-000000000050';
    raise exception 'expected atomic_verification_required';
  exception when others then
    if sqlerrm <> 'atomic_verification_required' then raise; end if;
  end;
end;
$$;

select public.verify_ghl_onboarding_task_v1(
  '98000000-0000-4000-8000-000000000050',
  '2026-09-04T19:00:00Z',
  '  Confirmed the accepted property details with the assigned owner.  '
);

select pg_temp.assert_true(
  (select team_status = 'verified' and team_verified_at is not null
   from public.onboarding_run_tasks
   where id = '98000000-0000-4000-8000-000000000050'),
  'atomic verification did not update the task'
);
select pg_temp.assert_true(
  (select actor_profile_id = '98000000-0000-4000-8000-000000000001'
     and evidence = 'Confirmed the accepted property details with the assigned owner.'
     and verified_at is not null
     and verified_at = (
       select team_verified_at from public.onboarding_run_tasks t where t.id = task_id
     )
   from public.ghl_onboarding_task_verifications_v1
   where task_id = '98000000-0000-4000-8000-000000000050'),
  'verification audit did not freeze actor, time, and trimmed evidence'
);
select pg_temp.assert_true(
  (select verification_evidence is not null and verified_by = 'Review Owner'
   from public.list_ghl_onboarding_team_review_v1()
   where task_id = '98000000-0000-4000-8000-000000000050'),
  'verified projection omitted its human evidence or actor label'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.ghl_onboarding_journeys),
  'ordinary reviewers could read raw commercial journey snapshots'
);
reset role;
select pg_temp.assert_true(
  (select submitted_snapshot->>'accepted' = 'invited'
   from public.ghl_onboarding_journeys
   where id = '98000000-0000-4000-8000-000000000030'),
  'verification mutated the accepted snapshot'
);

do $$
begin
  begin
    update public.ghl_onboarding_task_verifications_v1
    set evidence = 'Changed evidence'
    where task_id = '98000000-0000-4000-8000-000000000050';
    raise exception 'expected immutable verification audit';
  exception when others then
    if sqlerrm <> 'ghl_onboarding_verification_immutable' then raise; end if;
  end;
  begin
    delete from public.onboarding_run_tasks
    where id = '98000000-0000-4000-8000-000000000050';
    raise exception 'expected immutable verified task';
  exception when others then
    if sqlerrm <> 'ghl_onboarding_verification_immutable' then raise; end if;
  end;
end;
$$;

rollback;

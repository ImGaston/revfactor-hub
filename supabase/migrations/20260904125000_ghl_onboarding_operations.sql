-- Normalize accepted V1 identity into the existing operational queue without
-- running the legacy delete-and-reinsert questionnaire normalizer.
begin;
create function public.link_ghl_onboarding_operations(p_journey_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
 j public.ghl_onboarding_journeys%rowtype;
 client_uuid uuid; run_uuid uuid; matches integer; p jsonb; seq integer:=0;
 software_key text; software_state text; pref jsonb;
begin
 select * into j from public.ghl_onboarding_journeys where id=p_journey_id for update;
 if not found or j.submitted_snapshot is null or j.assembly_client_id is null or j.assembly_company_id is null
   or j.stage not in ('portal_invited','portal_active') then raise exception 'operations_handoff_not_ready'; end if;
 if j.onboarding_run_id is not null then return; end if;
 if j.team_profile_id is null then raise exception 'operations_owner_not_configured'; end if;
 -- Serialize journeys for one portal owner even when their billing entities differ.
 perform pg_advisory_xact_lock(hashtextextended('ghl-owner:'||j.contact_id,0));
 select count(*) into matches from public.clients where assembly_client_id=j.assembly_client_id or assembly_company_id=j.assembly_company_id;
 if matches>1 then raise exception 'ambiguous_hub_client'; end if;
 select id into client_uuid from public.clients where assembly_client_id=j.assembly_client_id or assembly_company_id=j.assembly_company_id;
 if client_uuid is null then
   -- An email collision without provider identity must be reconciled, never guessed.
   if exists(select 1 from public.clients where lower(email)=lower(j.payload->>'email')) then raise exception 'unlinked_hub_client_requires_review'; end if;
   insert into public.clients(name,email,status,onboarding_date,assembly_client_id,assembly_company_id)
    values(j.payload->>'name',j.payload->>'email','onboarding',current_date,j.assembly_client_id,j.assembly_company_id) returning id into client_uuid;
 else
   if exists(select 1 from public.clients where id=client_uuid and
      ((assembly_client_id is not null and assembly_client_id<>j.assembly_client_id) or
       (assembly_company_id is not null and assembly_company_id<>j.assembly_company_id))) then raise exception 'hub_client_identity_conflict'; end if;
   update public.clients set assembly_client_id=j.assembly_client_id,assembly_company_id=j.assembly_company_id where id=client_uuid;
 end if;
 insert into public.onboarding_runs(client_id,external_key,run_type,status,current_step,assembly_company_id,assembly_client_id,
    primary_listing_entitlement,child_listing_entitlement,has_pms,pms_name,has_pricelabs,draft_payload,submitted_payload,submitted_at)
 values(client_uuid,'ghl-v1:'||j.id::text,
    case when exists(select 1 from public.onboarding_runs where client_id=client_uuid) then 'additional_property' else 'initial' end,
    'submitted','review',j.assembly_company_id,j.assembly_client_id,jsonb_array_length(j.submitted_snapshot->'properties'),0,
    j.submitted_snapshot#>>'{software,pms}'<>'not_applicable',j.submitted_snapshot#>>'{software,pmsName}',
    case when j.submitted_snapshot#>>'{software,pricelabs}'='done' then true else null end,
    '{}'::jsonb,
    -- Commercial fields are excluded: operational readers need property and software answers.
    jsonb_build_object('version','rf.onboarding.v1','journeyId',j.id,'properties',
      (select jsonb_agg(value-'billingAccountId'-'ghlRecordId') from jsonb_array_elements(j.submitted_snapshot->'properties')),
      'software',j.submitted_snapshot->'software','expectationsAcknowledged',true),
    (j.submitted_snapshot->>'submittedAt')::timestamptz)
 returning id into run_uuid;
 for p in select value from jsonb_array_elements(j.submitted_snapshot->'properties') loop
   pref:=p->'preferences';
   insert into public.onboarding_run_listings(id,run_id,external_key,listing_kind,sequence,name,listing_url,is_live,target_launch_month,target_launch_year,
      minimum_nightly_price,cleaning_cost,min_stay_midweek,min_stay_weekend)
   values((p->>'id')::uuid,run_uuid,'primary-'||seq::text,'primary',seq,p->>'name',p->>'listingUrl',p->>'status'='live',
      extract(month from (p->>'targetLaunchDate')::date),extract(year from (p->>'targetLaunchDate')::date),
      case when pref#>>'{minimumNightly,mode}'='specified' then (pref#>>'{minimumNightly,value}')::numeric else null end,
      case when pref#>>'{cleaningFee,mode}'='specified' then (pref#>>'{cleaningFee,value}')::numeric else null end,
      case when pref#>>'{minimumStay,mode}'='specified' and (pref#>>'{minimumStay,nights}')::integer<=7 then (pref#>>'{minimumStay,nights}')::integer else null end,
      case when pref#>>'{minimumStay,mode}'='specified' and (pref#>>'{minimumStay,nights}')::integer<=7 then (pref#>>'{minimumStay,nights}')::integer else null end);
   -- Preserve all guidance/longer-stay/operating constraints in the frozen V1 snapshot.
   insert into public.onboarding_run_tasks(run_id,task_key,client_status,team_status,owner_profile_id,client_note)
    values(run_uuid,'v1-property:'||(p->>'id'),'submitted','pending',j.team_profile_id,jsonb_build_object('address',p->'address','preferences',pref)::text);
   seq:=seq+1;
 end loop;
 foreach software_key in array array['pms','airbnb','pricelabs'] loop
   software_state:=j.submitted_snapshot->'software'->>software_key;
   insert into public.onboarding_run_tasks(run_id,task_key,client_status,team_status,owner_profile_id,client_note)
   values(run_uuid,software_key,case when software_state='done' then 'submitted' else 'not_started' end,'pending',j.team_profile_id,
      case software_state when 'need_help' then 'Client requested setup guidance.' when 'not_applicable' then 'Client reports not applicable; team to confirm.' else 'Client reports complete; team to verify access.' end);
 end loop;
 update public.ghl_onboarding_journeys set hub_client_id=client_uuid,onboarding_run_id=run_uuid where id=j.id;
end; $$;
revoke all on function public.link_ghl_onboarding_operations(uuid) from public,anon,authenticated;
grant execute on function public.link_ghl_onboarding_operations(uuid) to service_role;
commit;

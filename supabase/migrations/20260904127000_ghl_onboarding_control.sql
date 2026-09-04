begin;
create function public.control_ghl_onboarding_v1(p_id uuid,p_revision integer,p_action text,p_reason text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.ghl_onboarding_journeys%rowtype;
begin
 select * into j from public.ghl_onboarding_journeys where id=p_id for update;
 if not found then raise exception 'journey_not_found'; end if;
 if j.revision<>p_revision then raise exception 'revision_conflict'; end if;
 if p_action='pause' then
   if p_reason is null or p_reason not in ('human_takeover','opt_out','cancelled','scope_correction') then raise exception 'invalid_reason'; end if;
   update public.ghl_onboarding_journeys set payload=jsonb_set(payload,'{manualTakeover}','true'),exception_code=p_reason,
     revision=revision+1,context_expires_at=now(),updated_at=now() where id=p_id;
   update public.ghl_onboarding_jobs set status='manual_review',error_code=p_reason,lease_token=null,lease_until=null,updated_at=now()
     where journey_id=p_id and status<>'completed';
   -- Revoke the old projection lease, then repair CRM state after any in-flight
   -- 15-second request has had a drain window. This worker sends no messages.
   insert into public.ghl_onboarding_jobs(journey_id,kind,available_at)
     values(p_id,'ghl_progress',now()+interval '30 seconds')
     on conflict(journey_id,kind) do update set status='pending',failure_count=0,
       available_at=now()+interval '30 seconds',lease_token=null,lease_until=null,error_code=null,updated_at=now();
 elsif p_action='renew_link' then
   if j.stage<>'onboarding' or (j.payload->>'manualTakeover')::boolean or p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$' then raise exception 'link_not_available'; end if;
   update public.ghl_onboarding_journeys set context_token_hash=p_token_hash,context_expires_at=now()+interval '14 days',revision=revision+1,updated_at=now() where id=p_id;
 else raise exception 'invalid_action'; end if;
 insert into public.ghl_onboarding_events(journey_id,event_key,request_hash,event_type,revision)
 values(p_id,'control:'||p_action||':'||p_revision::text,md5(coalesce(p_reason,p_token_hash)),p_action,p_revision+1);
 return jsonb_build_object('journeyId',p_id,'revision',p_revision+1);
end; $$;
revoke all on function public.control_ghl_onboarding_v1(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.control_ghl_onboarding_v1(uuid,integer,text,text,text) to service_role;
commit;

begin;
create function public.finish_ghl_progress_v1(
 p_job_id uuid,p_lease_token uuid,p_revision integer,p_outcome text default 'projected',p_code text default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.ghl_onboarding_jobs%rowtype; j public.ghl_onboarding_journeys%rowtype;
 failures integer; terminal_code text;
begin
 select * into job from public.ghl_onboarding_jobs where id=p_job_id;
 if not found then return false; end if;
 -- Save/control lock journey before jobs; use the same order here.
 select * into j from public.ghl_onboarding_journeys where id=job.journey_id for update;
 select * into job from public.ghl_onboarding_jobs where id=p_job_id for update;
 if not found or job.journey_id is distinct from j.id or job.kind<>'ghl_progress' or job.status<>'running' or job.lease_token is distinct from p_lease_token
   or job.lease_until<=now() then return false; end if;
 if p_outcome is null or p_outcome not in ('projected','superseded','failed','manual_review')
   or (p_code is not null and p_code!~'^[a-z0-9_]{1,100}$') then raise exception 'progress_result_invalid'; end if;
 if p_outcome='superseded' then
   if not exists(select 1 from public.ghl_onboarding_journeys where contact_id=j.contact_id and (created_at,id)>(j.created_at,j.id))
     then raise exception 'progress_not_superseded'; end if;
   update public.ghl_onboarding_jobs set status='completed',failure_count=0,lease_token=null,lease_until=null,error_code=null,
     result=jsonb_build_object('superseded',true),updated_at=now() where id=job.id;
 elsif p_outcome='projected' then
   if p_revision is null then raise exception 'progress_revision_required'; end if;
   update public.ghl_onboarding_jobs set status=case when j.revision=p_revision then 'completed' else 'pending' end,
     available_at=now(),failure_count=0,lease_token=null,lease_until=null,error_code=null,result=jsonb_build_object('revision',p_revision),updated_at=now()
     where id=job.id;
   update public.ghl_onboarding_exceptions set resolved_at=now(),updated_at=now() where job_id=job.id and resolved_at is null;
 else
   failures=job.failure_count+case when p_outcome='failed' then 1 else 0 end;
   terminal_code=case when p_outcome='manual_review' or failures>=5 then coalesce(p_code,'progress_projection_failed') else null end;
   update public.ghl_onboarding_jobs set status=case when terminal_code is null then 'failed' else 'manual_review' end,
     failure_count=failures,available_at=now()+interval '5 minutes',lease_token=null,lease_until=null,
     error_code=coalesce(p_code,'progress_projection_failed'),updated_at=now() where id=job.id;
   if terminal_code is not null then
     insert into public.ghl_onboarding_exceptions(journey_id,job_id,owner_id,code)
       values(j.id,job.id,j.owner_id,terminal_code)
       on conflict(job_id,code) do update set updated_at=now(),resolved_at=null;
   end if;
 end if;
 return true;
end; $$;
revoke all on function public.finish_ghl_progress_v1(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.finish_ghl_progress_v1(uuid,uuid,integer,text,text) to service_role;
commit;

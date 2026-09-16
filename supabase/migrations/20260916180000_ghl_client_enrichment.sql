-- Native paid GHL handoff: operational profile, separate legal identity and
-- atomic Stripe association. Does not create billing or a second onboarding run.
begin;
alter table public.clients
  add column if not exists business_name text,
  add column if not exists phone text,
  add column if not exists ghl_contact_id text,
  add column if not exists ghl_onboarding jsonb,
  add column if not exists ghl_synced_at timestamptz,
  add column if not exists ghl_sync_attempted_at timestamptz,
  add column if not exists ghl_sync_error text;
create unique index if not exists clients_ghl_contact_unique
  on public.clients(ghl_contact_id) where ghl_contact_id is not null;
create index if not exists clients_ghl_refresh_queue
  on public.clients(ghl_sync_attempted_at nulls first, id)
  where ghl_contact_id is not null and status = 'onboarding';

create or replace function public.apply_ghl_client_enrichment(
  p_client_id uuid, p_contact_id text, p_email text,
  p_assembly_client_id text, p_profile jsonb, p_billing jsonb default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare c public.clients%rowtype; owner_id uuid; customer text;
begin
  select * into strict c from public.clients where id = p_client_id for update;
  if lower(c.email) is distinct from lower(p_email)
     or c.assembly_client_id is distinct from p_assembly_client_id
     or (c.ghl_contact_id is not null and c.ghl_contact_id <> p_contact_id)
     or nullif(p_contact_id, '') is null
     or nullif(p_profile->>'name', '') is null
     or nullif(p_profile->>'business_name', '') is null then
    raise exception 'hub_identity_conflict';
  end if;
  if p_billing is not null then
    customer := p_billing->>'customer_id';
    if customer is null or customer !~ '^cus_[a-zA-Z0-9]+$'
       or coalesce(p_billing->>'subscription_id', '') !~ '^sub_[a-zA-Z0-9]+$'
       or jsonb_typeof(p_billing->'autopayment') is distinct from 'boolean'
       or (c.stripe_customer_id is not null and c.stripe_customer_id <> customer) then
      raise exception 'hub_stripe_identity_conflict';
    end if;
    -- Unique customer key serializes concurrent assignments; never steal a link.
    insert into public.client_stripe_customers(client_id, stripe_customer_id)
      values (p_client_id, customer) on conflict (stripe_customer_id) do nothing;
    select client_id into owner_id from public.client_stripe_customers where stripe_customer_id = customer;
    if owner_id is distinct from p_client_id then raise exception 'hub_stripe_owner_conflict'; end if;
    if exists(select 1 from public.stripe_subscriptions
      where id = p_billing->>'subscription_id' and customer_id <> customer) then
      raise exception 'hub_subscription_identity_conflict';
    end if;
    -- Seed a missing mirror immediately. Existing Stripe sync remains authoritative
    -- and owns subsequent refreshes; no raw provider/card payload is copied here.
    insert into public.stripe_subscriptions(id,customer_id,status,amount,currency,interval,
      item_count,current_period_start,current_period_end,cancel_at_period_end,created,synced_at)
    values(p_billing->>'subscription_id',customer,p_billing->>'status',
      (p_billing->>'amount')::numeric,'usd','month',(p_billing->>'quantity')::int,
      (p_billing->>'period_start')::timestamptz,(p_billing->>'period_end')::timestamptz,
      (p_billing->>'cancel_at_period_end')::boolean,(p_billing->>'created')::timestamptz,now())
    on conflict (id) do nothing;
  end if;
  update public.clients set
    name = p_profile->>'name', business_name = p_profile->>'business_name',
    phone = coalesce(nullif(p_profile->>'phone',''),phone),
    ghl_contact_id = p_contact_id,
    pms_name = case when p_profile ? 'pms_name' then p_profile->>'pms_name' else pms_name end,
    has_vrbo = case when p_profile ? 'has_vrbo' then (p_profile->>'has_vrbo')::boolean else has_vrbo end,
    ghl_onboarding = p_profile->'onboarding',
    stripe_customer_id = coalesce(customer,stripe_customer_id),
    autopayment_set_up = case when p_billing is not null then (p_billing->>'autopayment')::boolean else autopayment_set_up end,
    ghl_synced_at = now(), ghl_sync_attempted_at = now(), ghl_sync_error = null,
    updated_at = now()
  where id = p_client_id;
  return p_client_id;
end; $$;
revoke all on function public.apply_ghl_client_enrichment(uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_ghl_client_enrichment(uuid,text,text,text,jsonb,jsonb) to service_role;
comment on column public.clients.ghl_onboarding is 'Allowlisted GHL preparation answers and current booking. Client-reported readiness is not verified access. No credentials or payment payloads.';
notify pgrst, 'reload schema';
commit;

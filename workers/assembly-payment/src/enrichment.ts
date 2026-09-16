import { object, str, type Job, type Json } from './core.ts';
import { STRIPE_ACCOUNT } from './subscription.ts';

export const ONBOARDING_CALENDAR = 's2jDCEAg86oW89dfOPup';
export const FIELDS = {
  vrbo:'2EucGs4SAH2ggI8t0AXf', pricelabs:'6EoDuBSQ3RN6IDWeC6Ro',
  airbnbReady:'EqzdKhFohX2uwtAQ7Amt', usesPms:'JsSaZVzfzOUJUFoVtXjP',
  pms:'PLe2dp2eGsGZp0BUWUk0', otherPms:'FlHFFaIjl7YGvqKxakAw',
  readiness:'NzNGHZ9ZW0aQ0bt2wRit', audit:'yK8HqaoICDM2LRZs7KyX',
  listing:'qgvNIhtCI1AlvTA6Dbj7'
};
export function publicListingUrl(value: unknown): string | null {
  try {const u=new URL(str(value));
    if(u.protocol!=='https:' || u.username || u.password || !/(^|\.)airbnb\.(com|co\.uk|ca|com\.au)$/.test(u.hostname) || !/^\/rooms\/\d+\/?$/.test(u.pathname)) return null;
    return u.origin+u.pathname; // Strip tracking and any private query parameters.
  } catch {return null;}
}
export function contactProfile(job: Job, contact: Json, locationId: string, appointment: Json|null, host: string|null): Json {
  if(contact.id!==job.contactId || contact.locationId!==locationId || str(contact.email).toLowerCase()!==job.email) throw new Error('enrichment_contact_identity_conflict');
  const fields=Array.isArray(contact.customFields)?contact.customFields.map(object):[];
  const value=(id:string)=>fields.find(f=>f.id===id)?.value;
  const answer=(id:string)=>str(value(id)).slice(0,500)||null;
  const pms=answer(FIELDS.usesPms), vrbo=answer(FIELDS.vrbo);
  const tags=Array.isArray(contact.tags)?contact.tags.map(str):[];
  const readiness=value(FIELDS.readiness);
  const onboarding: Json={
    source:'ghl_native', purchased_listings:job.listings,
    agreement_evidence:tags.filter(t=>/^rf-subscription-agreement-q[1-5]-signed$/.test(t)),
    uses_pms:pms, vrbo, uses_pricelabs:answer(FIELDS.pricelabs),
    airbnb_ready:answer(FIELDS.airbnbReady), audit_requested:answer(FIELDS.audit),
    readiness:Array.isArray(readiness)?readiness.map(str).filter(Boolean).slice(0,20).map(s=>s.slice(0,500)):[],
    airbnb_listing_url:publicListingUrl(value(FIELDS.listing))??publicListingUrl(contact.website),
    access_verified:false,
    appointment:null
  };
  if(appointment) {
    if(appointment.contactId!==job.contactId || appointment.locationId!==locationId || appointment.calendarId!==ONBOARDING_CALENDAR || !str(appointment.id)) throw new Error('enrichment_appointment_identity_conflict');
    // Contact appointment lists return ambiguous local dates; use detail endpoint
    // with an explicit offset, never reinterpret those strings as UTC.
    const start=str(appointment.startTime),end=str(appointment.endTime);
    if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(start) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) throw new Error('invalid_appointment_time');
    onboarding.appointment={id:appointment.id,start,end,status:str(appointment.appointmentStatus),host_id:str(appointment.assignedUserId),host_name:host};
  }
  const profile:Json={name:`${job.givenName} ${job.familyName}`,business_name:job.legalName,phone:str(contact.phone)||null,onboarding};
  if(pms?.toLowerCase()==='no') profile.pms_name=null;
  if(pms?.toLowerCase()==='yes') {
    const provider=answer(FIELDS.pms), other=answer(FIELDS.otherPms);
    if(provider) profile.pms_name=provider.toLowerCase()==='other'?(other??'Other'):provider;
  }
  if(vrbo?.toLowerCase()==='yes') profile.has_vrbo=true;
  if(vrbo?.toLowerCase()==='no') profile.has_vrbo=false;
  return profile;
}
export function subscriptionBilling(job: Job, subscription: Json, locationId: string): Json {
  const stripe=object(subscription.subscriptionSnapshot), provider=object(subscription.paymentProvider),account=object(provider.connectedAccount);
  if(!job.subscriptionPayment || subscription._id!==job.subscriptionPayment.subscriptionId || subscription.entityId!==job.subscriptionPayment.orderId || subscription.contactId!==job.contactId || subscription.altId!==locationId || subscription.altType!=='location' || subscription.liveMode!==true || provider.type!=='stripe' || account.accountId!==STRIPE_ACCOUNT || account.liveMode!==true || stripe.livemode!==true || stripe.id!==subscription.subscriptionId || !/^cus_[a-zA-Z0-9]+$/.test(str(stripe.customer)) || !/^sub_[a-zA-Z0-9]+$/.test(str(stripe.id))) throw new Error('enrichment_billing_identity_conflict');
  const items=object(stripe.items);
  if(items.has_more || !Array.isArray(items.data) || items.data.length!==1) throw new Error('enrichment_billing_requires_review');
  const item=object(items.data[0]),price=object(item.price),recurring=object(price.recurring);
  if(item.quantity!==job.listings || price.unit_amount!==35000 || price.currency!=='usd' || recurring.interval!=='month' || recurring.interval_count!==1) throw new Error('enrichment_billing_requires_review');
  const iso=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0) throw new Error('invalid_subscription_time');return new Date(v*1000).toISOString();};
  return {customer_id:stripe.customer,subscription_id:stripe.id,status:str(stripe.status),
    autopayment:stripe.collection_method==='charge_automatically' && !!str(stripe.default_payment_method) && ['active','trialing','past_due'].includes(str(stripe.status)) && !stripe.pause_collection,
    amount:350*job.listings,quantity:job.listings,created:iso(stripe.created),
    period_start:iso(item.current_period_start??stripe.current_period_start),period_end:iso(item.current_period_end??stripe.current_period_end),cancel_at_period_end:stripe.cancel_at_period_end===true};
}

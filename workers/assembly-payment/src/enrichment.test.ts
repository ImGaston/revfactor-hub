import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contactProfile,subscriptionBilling,publicListingUrl,FIELDS,ONBOARDING_CALENDAR} from './enrichment.ts';
import type {Job,Json} from './core.ts';
const job:Job={invoiceId:'in_test',contactId:'contact000001',email:'qa@example.com',givenName:'QA',familyName:'Example',legalName:'QA Business',listings:2,subscriptionPayment:{transactionId:'txn',orderId:'order',subscriptionId:'ghlSub'}};
const location='location000001';
function contact(values:Record<string,unknown>={}):Json {return {id:job.contactId,locationId:location,email:job.email,phone:'+10000000000',website:'https://www.airbnb.com/rooms/123456?private=remove',tags:['rf-subscription-agreement-q2-signed'],customFields:Object.entries(values).map(([key,value])=>({id:FIELDS[key as keyof typeof FIELDS],value}))};}
test('separates personal/legal identity, uses explicit preparation answers and strips URL query data',()=>{
  const p=contactProfile(job,contact({usesPms:'Yes',pms:'Other',otherPms:'Hospitable',vrbo:'Yes',audit:'Yes',readiness:['Invite pending']}),location,null,null);
  assert.equal(p.name,'QA Example');assert.equal(p.business_name,'QA Business');assert.equal(p.pms_name,'Hospitable');assert.equal(p.has_vrbo,true);
  assert.equal((p.onboarding as Json).airbnb_listing_url,'https://www.airbnb.com/rooms/123456');assert.equal((p.onboarding as Json).access_verified,false);
});
test('unknown/in-progress answers never become a verified No',()=>{
  for(const vrbo of ['','In progress']) {const p=contactProfile(job,contact({vrbo}),location,null,null);assert.equal('has_vrbo' in p,false);assert.equal('pms_name' in p,false);}
  const p=contactProfile(job,contact({usesPms:'No',vrbo:'No'}),location,null,null);assert.equal(p.has_vrbo,false);assert.equal(p.pms_name,null);
});
test('foreign contact/calendar and timezone-free appointment timestamps fail closed',()=>{
  assert.throws(()=>contactProfile(job,{...contact(),email:'other@example.com'},location,null,null),/conflict/);
  const appt={id:'appointment0001',contactId:job.contactId,locationId:location,calendarId:ONBOARDING_CALENDAR,startTime:'2026-09-22T16:00:00-04:00',endTime:'2026-09-22T16:30:00-04:00',appointmentStatus:'confirmed',assignedUserId:'new-host'};
  const p=contactProfile(job,contact(),location,appt,'Future Host');assert.equal(((p.onboarding as Json).appointment as Json).host_name,'Future Host');
  assert.throws(()=>contactProfile(job,contact(),location,{...appt,startTime:'2026-09-22 16:00:00'},null),/time/);
  assert.throws(()=>contactProfile(job,contact(),location,{...appt,contactId:'someone-else'},null),/conflict/);
  for(const url of ['javascript:alert(1)','https://airbnb.com.attacker.example/rooms/123','https://user:secret@airbnb.com/rooms/123']) assert.equal(publicListingUrl(url),null);
});
test('only the existing Live Stripe identity can link, with automatic collection independently verified',()=>{
  const f=JSON.parse(readFileSync(new URL('./subscription-test-fixture.json',import.meta.url),'utf8'));
  const s=f.subscription;s._id='ghlSub';s.entityId='order';s.contactId=job.contactId;s.altId=location;s.liveMode=true;s.paymentProvider.connectedAccount.liveMode=true;
  const stripe=s.subscriptionSnapshot;stripe.livemode=true;stripe.created=1789405200;stripe.current_period_start=1789405200;stripe.current_period_end=1791997200;
  const b=subscriptionBilling(job,s,location);assert.equal(b.amount,700);assert.equal(b.autopayment,true);assert.ok(b.customer_id);assert.ok(b.subscription_id);assert.equal('raw_json' in b,false);
  stripe.collection_method='send_invoice';assert.equal(subscriptionBilling(job,s,location).autopayment,false);
  stripe.collection_method='charge_automatically';stripe.default_payment_method=null;assert.equal(subscriptionBilling(job,s,location).autopayment,false);
  s.liveMode=false;assert.throws(()=>subscriptionBilling(job,s,location),/conflict/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedSubscriptionJob } from './subscription.ts';
import { object, type Json } from './core.ts';

const evidence = JSON.parse(readFileSync(new URL('./subscription-test-fixture.json', import.meta.url), 'utf8')) as {transaction: Json; order: Json; subscription: Json};
const policy = { locationId: 'ErABPRqWbMyIicvzvCFt', activatedAt: '2026-09-14T00:00:00Z', links: {'6a9a8142a7f78e147447edc2': 2} };
const contact: Json = {id:'GB28UJiYYCxOMRMlZqD9',locationId:policy.locationId,email:'rf-qa-subscription-20260914@example.com',firstName:'RFQA',lastName:'Subscription',tags:['rf-subscription-agreement-q2-signed'],customFields:[{id:'SQ0wwhLhD8qZVymkHslW',value:'Synthetic QA Company'}]};
function liveFixture() {
  // Simulates Live flags on a minimal real Test response. Never used for API calls.
  const f = structuredClone(evidence);
  for (const r of [f.transaction,f.order,f.subscription]) r.liveMode=true;
  object(f.transaction.chargeSnapshot).livemode=true;
  object(object(f.transaction.chargeSnapshot).payment_method).livemode=true;
  object(object(f.subscription.paymentProvider).connectedAccount).liveMode=true;
  object(f.subscription.subscriptionSnapshot).livemode=true;
  return f;
}
function check(f=liveFixture(), c=contact) {return verifiedSubscriptionJob(f.transaction,f.order,f.subscription,c,policy);}
test('actual Stripe Test payment is rejected for production provisioning',()=>assert.equal(check(evidence),null));
test('verified initial auto-paid subscription yields replayable references',()=>{
  const job=check();assert.equal(job?.listings,2);assert.equal(job?.invoiceId,'in_1UFdVAAN8lUrk5rxPDPfUfAy');
  assert.deepEqual(job?.subscriptionPayment,{transactionId:'6aa82c15797b7ad9ff03ac57',orderId:'6aa82c108b94b18959e756e1',subscriptionId:'6aa82c15797b7ad9ff03ac53'});
});
test('failed, partial, refunded, historical, other-source and other-account payments cannot provision',()=>{
  for(const patch of [{status:'failed'},{amount:150},{amountRefunded:1},{createdAt:'2026-09-13T00:00:00Z'},{entitySourceId:'unrelated'},{paymentProviderConnectedAccount:'acct_other'},{liveMode:false},{currency:'eur'},{subscriptionId:'sub_other'}]) {
    const f=liveFixture();Object.assign(f.transaction,patch);assert.equal(check(f),null,JSON.stringify(patch));
  }
});
test('requires exact signed agreement quantity and captured client identity',()=>{
  for(const patch of [{tags:[]},{tags:['rf-subscription-agreement-q1-signed']},{tags:['rf-subscription-agreement-q2-signed','rf-subscription-agreement-q1-signed']},{email:'other@example.com'},{customFields:[]}])assert.throws(()=>check(liveFixture(),{...contact,...patch}));
});
test('rejects invoice-based manual payment, trials, canceled subscription and wrong saved card',()=>{
  for(const patch of [{collection_method:'send_invoice'},{status:'past_due'},{trial_end:9999999999},{cancel_at_period_end:true},{pause_collection:{behavior:'void'}},{default_payment_method:'pm_other'},{customer:'cus_other'}]) {
    const f=liveFixture();Object.assign(object(f.subscription.subscriptionSnapshot),patch);assert.equal(check(f),null,JSON.stringify(patch));
  }
});
test('renewals, changed line items and wrong totals never qualify as initial payment',()=>{
  const a=liveFixture();object(object(a.subscription.subscriptionSnapshot).latest_invoice).billing_reason='subscription_cycle';assert.equal(check(a),null);
  const b=liveFixture();object(object(b.subscription.subscriptionSnapshot).latest_invoice).amount_remaining=1;assert.equal(check(b),null);
  const c=liveFixture();object((c.order.items as unknown[])[0]).qty=2;assert.equal(check(c),null);
  const d=liveFixture();object(d.subscription.recurringProduct).qty=1;assert.equal(check(d),null);
  const e=liveFixture();object(e.order.source).id='unapproved';assert.equal(check(e),null);
});

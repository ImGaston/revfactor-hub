import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleInvoice,verifiedJob,advance,invoiceIdFromPayload,PRIMARY,SETUP,type Json,type Job,type State,type Ports} from './core.ts';
const job: Job={invoiceId:'invoice00000001',contactId:'contact00000001',email:'qa@example.com',givenName:'QA',familyName:'Example',legalName:'QA Business',listings:1};
function invoice(n=1): Json {return {_id:job.invoiceId,altId:'location',altType:'location',status:'paid',liveMode:true,currency:'USD',lastPaidAt:'2026-09-10T12:00:00Z',amountDue:0,amountPaid:n*350+150,total:n*350+150,contactDetails:{id:job.contactId,email:job.email},invoiceItems:[{productId:PRIMARY,amount:350,qty:n},{productId:SETUP,amount:150,qty:1}]};}
const contact: Json={id:job.contactId,locationId:'location',firstName:'QA',lastName:'Example',email:job.email,customFields:[{id:'SQ0wwhLhD8qZVymkHslW',value:'QA Business'}]};
const since='2026-09-10T11:00:00Z';
test('extracts native invoice URL ID without fetching the supplied URL',()=>{
 assert.equal(invoiceIdFromPayload({invoice_url:'https://links.revfactor.io/invoice/6aa1a743d4d778c622a83ebe'}),'6aa1a743d4d778c622a83ebe');
 assert.equal(invoiceIdFromPayload({invoice_url:'{{invoice.url}}'}),'');
 assert.equal(invoiceIdFromPayload({invoice_url:'https://links.revfactor.io/other/6aa1a743d4d778c622a83ebe'}),'');
});
test('accepts exactly the five initial paid plans',()=>{for(let n=1;n<=5;n++)assert.equal(eligibleInvoice(invoice(n),job.contactId,'location',since),n);});
test('rejects test, failed, partial, historic, wrong-location/currency and altered totals',()=>{
 for(const change of [{liveMode:false},{status:'sent'},{status:'void'},{amountPaid:150,amountDue:350},{amountDue:1},{lastPaidAt:'2026-09-09T12:00:00Z'},{lastPaidAt:null},{altId:'another'},{currency:'EUR'},{total:450},{amountPaid:501}])assert.equal(eligibleInvoice({...invoice(),...change},job.contactId,'location',since),null);
});
test('renewals and unrelated same-dollar invoices never qualify',()=>{
 for(const items of [[{productId:PRIMARY,amount:350,qty:1}],[{productId:'unrelated',amount:350,qty:1},{productId:SETUP,amount:150,qty:1}],[{productId:PRIMARY,amount:350,qty:1},{productId:SETUP,amount:150,qty:2}]])assert.equal(eligibleInvoice({...invoice(),invoiceItems:items},job.contactId,'location',since),null);
});
test('requires matching invoice/contact/email and captured legal identity',()=>{
 assert.deepEqual(verifiedJob(invoice(),contact,job.invoiceId,'location',since),job);
 for(const altered of [{...contact,email:'other@example.com'},{...contact,customFields:[]},{...contact,lastName:''},{...contact,locationId:'another'}])assert.throws(()=>verifiedJob(invoice(),altered,job.invoiceId,'location',since));
 assert.throws(()=>eligibleInvoice(invoice(),'other','location',since));
});
function fixture(stage: State['stage']='queued') {
 const s:State={job:structuredClone(job),stage,attempts:0,updatedAt:'now'};
 const calls:string[]=[];let saved:State|undefined;
 const p:Ports={save:async v=>{saved=structuredClone(v);},find:async()=>{calls.push('find');return [];},company:async()=>{calls.push('company');return {id:'company1'};},client:async()=>{calls.push('client');return {id:'client1',email:job.email};},hub:async()=>{calls.push('hub');return 'hub1';},mark:async()=>{calls.push('mark');}};
 return {s,p,calls,saved:()=>saved};
}
test('new client creates once and replay does nothing',async()=>{const f=fixture();await advance(f.s,f.p);await advance(f.s,f.p);assert.deepEqual(f.calls,['find','company','client','hub','mark']);assert.equal(f.saved()?.stage,'complete');});
test('existing client reused without creating company, client or invite',async()=>{const f=fixture();f.p.find=async()=>[{id:'existing',email:job.email}];await advance(f.s,f.p);assert.deepEqual(f.calls,['hub','mark']);assert.equal(f.s.clientId,'existing');});
test('lookup outage cannot fall through to client creation',async()=>{const f=fixture();f.p.find=async()=>{throw Error('outage');};await assert.rejects(advance(f.s,f.p));assert.deepEqual(f.calls,[]);});
test('ambiguous company create never repeats POST',async()=>{const f=fixture();f.p.company=async()=>{f.calls.push('company');throw Error('timeout');};await assert.rejects(advance(f.s,f.p));await assert.rejects(advance(f.s,f.p),/requires_review/);assert.equal(f.calls.filter(c=>c==='company').length,1);});
test('ambiguous client create reconciles existing client by exact email',async()=>{const f=fixture('client_pending');f.s.companyId='company1';f.p.find=async()=>[{id:'reconciled',email:job.email}];await advance(f.s,f.p);assert.deepEqual(f.calls,['hub','mark']);assert.equal(f.s.clientId,'reconciled');});
test('ambiguous client create with no matching record stops instead of duplicating',async()=>{const f=fixture('client_pending');await assert.rejects(advance(f.s,f.p),/requires_review/);assert.deepEqual(f.calls,['find']);});
test('GHL tagging outage retries only tagging',async()=>{const f=fixture();f.p.mark=async()=>{f.calls.push('mark');throw Error('outage');};await assert.rejects(advance(f.s,f.p));f.p.mark=async()=>{f.calls.push('mark');};await advance(f.s,f.p);assert.deepEqual(f.calls,['find','company','client','hub','mark','mark']);});
test('multiple or mismatched Assembly identities fail closed',async()=>{for(const results of [[{id:'a',email:job.email},{id:'b',email:job.email}],[{id:'a',email:'other@example.com'}]]){const f=fixture();f.p.find=async()=>results;await assert.rejects(advance(f.s,f.p),/conflict/);assert.deepEqual(f.calls,[]);}});

 test('Hub failure retries without another Assembly create',async()=>{const f=fixture();f.p.hub=async()=>{f.calls.push('hub');throw Error('hub_outage');};await assert.rejects(advance(f.s,f.p));assert.equal(f.s.clientId,'client1');f.p.hub=async()=>{f.calls.push('hub');return 'hub1';};await advance(f.s,f.p);assert.deepEqual(f.calls,['find','company','client','hub','hub','mark']);assert.equal(f.s.hubClientId,'hub1');});
 test('old Assembly-complete state gets Hub link without recreating Assembly',async()=>{const f=fixture('complete');f.s.clientId='existing';await advance(f.s,f.p);assert.deepEqual(f.calls,['hub','mark']);assert.equal(f.s.hubClientId,'hub1');});

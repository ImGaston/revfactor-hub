import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleContractCopy,selectAgreement,pdfLinkFromMessages,downloadAgreement,copySignedContract,type ContractCopy,type ContractPorts} from './contracts.ts';
import {type Job,type Json} from './core.ts';
const location='qaLocation000001',clientId='qa-client-000001',companyId='qa-company-000001',channelId='qa-channel/company';
const job={contactId:'qaContact000001',email:'qa@example.com',listings:1,subscriptionPayment:{}} as Job;
const doc:Json={_id:'qaDocument000001',documentId:'qaDocument000001',documentRevision:1,locationId:location,name:'RevFactor | Service Agreement | 1 Listing | Live payments',status:'completed',deleted:false,createdAt:'2026-09-16T14:00:00Z',recipients:[{id:job.contactId,email:job.email,role:'signer',hasCompleted:true}],fillableFields:[{type:'Signature',recipient:job.contactId,hasCompleted:true}],links:[{documentId:'qaDocument000001',recipientId:job.contactId,documentRevision:1,deleted:false,referenceId:'qa-reference-000001'}]};
const source='https://services.leadconnectorhq.com/proposals/document/public/download-pdf?p=opaque';
const target=`https://storage.googleapis.com/leadgen-proposals-estimates/location/${location}/documents/${doc._id}/agreement.pdf?signature=opaque`;
const message:Json={locationId:location,contactId:job.contactId,direction:'outbound',messageType:'TYPE_EMAIL',source:'app',dateAdded:'2026-09-16T14:01:00Z',meta:{email:{subject:`[RevFactor] ${doc.name} signed`}},body:`Download PDF [${source}] View Document [https://links.revfactor.io/documents/v1/qa-reference-000001?locale=en_US]`};
const pdf=new TextEncoder().encode('%PDF-1.7\nunchanged signed bytes and certificate');
function fixture(){
 const state:ContractCopy={status:'pending',attempts:0,paidAt:'2026-09-16T14:02:00Z'};
 let folder:Json|undefined,file:Json|undefined,stored:Uint8Array|undefined;
 const calls:string[]=[];
 const ports:ContractPorts={assemblyKey:'secret',save:async()=>{},api:async(provider,path,method='GET',body)=>{
  const u=new URL(path,'https://mock.invalid');calls.push(`${method} ${u.pathname}`);
  if(provider==='ghl'){
   if(u.pathname==='/proposals/document')return {documents:[structuredClone(doc)],total:1};
   if(u.pathname==='/conversations/search')return {conversations:[{id:'qaConversation0001',contactId:job.contactId,locationId:location}],total:1};
   if(u.pathname.endsWith('/messages'))return {messages:{messages:[structuredClone(message)],nextPage:false}};
  }
  if(u.pathname==='/channels/files')return {data:[{id:channelId,companyId,membershipType:'company',memberIds:[clientId]}]};
  if(u.pathname==='/files')return {data:u.searchParams.get('path')===''?(folder?[folder]:[]):(file?[file]:[])};
  if(u.pathname==='/files/folder'){assert.equal(body?.clientPermissions,'read_only');folder={id:'qaFolder000001',object:'folder',channelId,path:body?.path};return folder;}
  if(u.pathname==='/files/file'){file={id:'qaFile00000001',object:'file',channelId,path:body?.path,status:'pending',uploadUrl:'https://qa.s3.amazonaws.com/upload'};return file;}
  if(u.pathname==='/files/qaFile00000001')return file!;
  throw Error('unexpected '+path);
 },fetch:(async(input,init)=>{
  const u=new URL(String(input));calls.push(`${init?.method??'GET'} ${u.hostname}`);
  if(u.hostname==='services.leadconnectorhq.com'){assert.equal(init?.redirect,'manual');assert.equal(init?.headers,undefined);return new Response(null,{status:302,headers:{location:target}});}
  if(u.hostname==='storage.googleapis.com')return new Response(pdf);
  if(u.hostname==='qa.s3.amazonaws.com'){assert.equal(init?.method,'PUT');stored=new Uint8Array(init!.body as Uint8Array);file!.status='complete';return new Response(null);}
  if(u.hostname==='api.assembly.com'){assert.deepEqual(init?.headers,{'X-API-KEY':'secret'});return new Response(stored as BodyInit);}
  throw Error('unexpected fetch');
 }) as typeof fetch};
 return {state,ports,calls,getStored:()=>stored};
}
test('only new initial subscription payments at or after release qualify',()=>{
 const now=Date.parse('2026-09-16T15:00:00Z'),cutoff='2026-09-16T14:00:00Z';
 assert.equal(eligibleContractCopy(job,cutoff,cutoff,now),true);
 for(const paid of ['2026-09-16T13:59:59Z','2026-09-17T00:00:00Z','invalid',undefined])assert.equal(eligibleContractCopy(job,paid,cutoff,now),false);
 assert.equal(eligibleContractCopy({...job,subscriptionPayment:undefined},cutoff,cutoff,now),false);
 assert.equal(eligibleContractCopy(job,cutoff,'invalid',now),false);
});
test('agreement requires exact identity, quantity, completion and unambiguous revision',()=>{
 assert.equal(selectAgreement([doc],job,location),doc);
 for(const change of [{locationId:'other'},{status:'sent'},{deleted:true},{isExpired:true},{name:'Another contract'},{recipients:[{id:'other',email:job.email,role:'signer',hasCompleted:true}]},{fillableFields:[]},{fillableFields:[{type:'Signature',recipient:job.contactId,hasCompleted:false}]},{documentId:'other'}])assert.throws(()=>selectAgreement([{...doc,...change}],job,location));
 assert.throws(()=>selectAgreement([doc,doc],job,location),/conflict/);
});
test('native email must match signer, location, subject and document revision link',()=>{
 assert.equal(pdfLinkFromMessages([message],doc,job,location),source);
 for(const change of [{contactId:'other'},{locationId:'other'},{direction:'inbound'},{source:'workflow'},{meta:{}},{dateAdded:'2026-09-15T00:00:00Z'},{body:`Download [${source}] View [https://links.revfactor.io/documents/v1/wrong]`}])assert.throws(()=>pdfLinkFromMessages([{...message,...change}],doc,job,location),/not_ready/);
 assert.throws(()=>pdfLinkFromMessages([message,{...message,body:String(message.body).replace('p=opaque','p=other')}],doc,job,location),/conflict/);
});
test('PDF download rejects unrelated redirects, non-PDF bytes and oversize responses',async()=>{
 for(const header of [target.replace('qaDocument000001','anotherDoc'),target.replace('storage.googleapis.com','evil.example')])await assert.rejects(downloadAgreement(source,String(doc._id),location,async()=>new Response(null,{status:302,headers:{location:header}})),/conflict/);
 let n=0;await assert.rejects(downloadAgreement(source,String(doc._id),location,async()=>++n===1?new Response(null,{status:302,headers:{location:target}}):new Response('not a pdf')),/not_pdf/);
 n=0;await assert.rejects(downloadAgreement(source,String(doc._id),location,async()=>++n===1?new Response(null,{status:302,headers:{location:target}}):new Response(pdf,{headers:{'Content-Length':String(11*1024*1024)}})),/too_large/);
});
test('full copy preserves bytes, verifies readback, and replay creates nothing',async()=>{
 const f=fixture();await copySignedContract(job,clientId,companyId,location,f.state,f.ports);
 assert.equal(f.state.status,'complete');assert.equal(f.state.fileId,'qaFile00000001');assert.equal(f.state.uploadUrl,undefined);assert.deepEqual(f.getStored(),pdf);
 const count=f.calls.length;await copySignedContract(job,clientId,companyId,location,f.state,f.ports);assert.equal(f.calls.length,count);
 assert.equal(f.calls.filter(c=>c==='POST /files/file').length,1);assert.equal(f.calls.filter(c=>c==='POST /files/folder').length,1);
});
test('lost create response reconciles existing file without another POST',async()=>{
 const f=fixture(),api=f.ports.api;let lost=true;
 f.ports.api=async(...args)=>{const result=await api(...args);if(args[1]==='/files/file'&&lost){lost=false;throw Error('timeout');}return result;};
 await assert.rejects(copySignedContract(job,clientId,companyId,location,f.state,f.ports),/timeout/);
 await copySignedContract(job,clientId,companyId,location,f.state,f.ports);
 assert.equal(f.state.status,'complete');assert.equal(f.calls.filter(c=>c==='POST /files/file').length,1);
});
test('ambiguous absent create cannot issue a second create',async()=>{
 const f=fixture(),api=f.ports.api;f.ports.api=async(...args)=>{if(args[1]==='/files/file'){f.calls.push('POST /files/file');throw Error('timeout');}return api(...args);};
 await assert.rejects(copySignedContract(job,clientId,companyId,location,f.state,f.ports),/timeout/);
 await assert.rejects(copySignedContract(job,clientId,companyId,location,f.state,f.ports),/requires_review/);
 assert.equal(f.calls.filter(c=>c==='POST /files/file').length,1);
});
test('wrong readback bytes are never accepted or overwritten',async()=>{
 const f=fixture(),fetcher=f.ports.fetch;f.ports.fetch=(async(input,init)=>{if(String(input).startsWith('https://api.assembly.com/'))return new Response('%PDF-wrong signed agreement');return fetcher(input,init);}) as typeof fetch;
 await assert.rejects(copySignedContract(job,clientId,companyId,location,f.state,f.ports),/hash_conflict/);assert.equal(f.state.status,'pending');
 await assert.rejects(copySignedContract(job,clientId,companyId,location,f.state,f.ports),/hash_conflict/);assert.equal(f.calls.filter(c=>c==='PUT qa.s3.amazonaws.com').length,1);
});
test('wrong Assembly member cannot receive the contract',async()=>{
 const f=fixture(),api=f.ports.api;f.ports.api=async(...args)=>args[1].startsWith('/channels/files')?{data:[{id:channelId,companyId,membershipType:'company',memberIds:['other']}]}:api(...args);
 await assert.rejects(copySignedContract(job,clientId,companyId,location,f.state,f.ports),/identity_conflict/);assert.equal(f.calls.some(c=>c.startsWith('POST')),false);
});

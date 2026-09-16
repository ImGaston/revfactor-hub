import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const contractMode=process.argv.includes('--contract');
const existingMode=process.argv.includes('--existing');
const subscriptionMode=process.argv.includes('--subscription')||contractMode;
const fixture=JSON.parse(readFileSync(new URL('./src/subscription-test-fixture.json',import.meta.url),'utf8'));
for(const r of [fixture.transaction,fixture.order,fixture.subscription]) {r.liveMode=true;r.contactId='qaContact000000000001';}
fixture.transaction.contactEmail='qa@example.com';
fixture.order.contactSnapshot.email='qa@example.com';
fixture.subscription.contactSnapshot.email='qa@example.com';
fixture.transaction.chargeSnapshot.livemode=true;fixture.transaction.chargeSnapshot.payment_method.livemode=true;
fixture.subscription.paymentProvider.connectedAccount.liveMode=true;fixture.subscription.subscriptionSnapshot.livemode=true;
Object.assign(fixture.subscription.subscriptionSnapshot,{created:1789405200,current_period_start:1789405200,current_period_end:1791997200});
let includeTestPayment=false;
let bookingStatus="confirmed", hostName="Future Host", enrichmentWrites=0, lastProfile;
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const compiled=await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],external:['cloudflare:workers','node:*'],write:false});
const location='ErABPRqWbMyIicvzvCFt',contactId='qaContact000000000001',invoiceId='qaInvoice000000000001';
let clientCreates=0,companyCreates=0,tags=0,reads=0,hubCreates=0; const hubRows=[];
let fileCreates=0,folderCreates=0,storedPdf,contractFile,contractFolder;
const contractPdf=new TextEncoder().encode('%PDF-1.7\noriginal signed contract and certificate');
const contractChannel='qa-channel/qa-company';
const doc={_id:'qaDocument000000001',documentId:'qaDocument000000001',documentRevision:1,locationId:location,name:'RevFactor | Service Agreement | 2 Listings | Live payments',status:'completed',deleted:false,createdAt:'2026-09-14T00:00:00Z',recipients:[{id:contactId,email:'qa@example.com',role:'signer',hasCompleted:true}],fillableFields:[{type:'Signature',recipient:contactId,hasCompleted:true}],links:[{documentId:'qaDocument000000001',recipientId:contactId,documentRevision:1,deleted:false,referenceId:'qa-reference-000001'}]};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-10',compatibilityFlags:['nodejs_compat'],bindings:{LOCATION_ID:location,ENABLED:'true',CONTRACT_FILES_ENABLED:'true',CONTRACT_FILES_ACTIVATED_AT:contractMode?'2026-09-14T00:00:00Z':'2099-01-01T00:00:00Z',ACTIVATED_AT:'2026-09-10T00:00:00Z',SUBSCRIPTIONS_ACTIVATED_AT:'2026-09-14T00:00:00Z',SUBSCRIPTION_LINKS:JSON.stringify({'6a9a8142a7f78e147447edc2':2}),HIGHLEVEL_API_KEY:'fake-ghl',ASSEMBLY_API_KEY:'fake-assembly',WEBHOOK_SECRET:'fake-webhook',HUB_SUPABASE_URL:'https://test.supabase.co',HUB_SUPABASE_SERVICE_ROLE_KEY:'fake-hub'},durableObjects:{CLIENTS:{className:'PaidClient',useSQLite:true}},outboundService:async req=>{
 const u=new URL(req.url);reads++;
 if(u.hostname==='services.leadconnectorhq.com'){
  if(u.pathname==='/proposals/document')return Response.json({documents:[doc],total:1});
  if(u.pathname==='/conversations/search')return Response.json({conversations:[{id:'qaConversation00001',locationId:location,contactId}],total:1});
  if(u.pathname.endsWith('/messages'))return Response.json({messages:{messages:[{locationId:location,contactId,direction:'outbound',messageType:'TYPE_EMAIL',source:'app',dateAdded:fixture.transaction.createdAt,meta:{email:{subject:`[RevFactor] ${doc.name} signed`}},body:'Download [https://services.leadconnectorhq.com/proposals/document/public/download-pdf?p=opaque] View [https://links.revfactor.io/documents/v1/qa-reference-000001]'}],nextPage:false}});
  if(u.pathname==='/proposals/document/public/download-pdf')return new Response(null,{status:302,headers:{location:`https://storage.googleapis.com/leadgen-proposals-estimates/location/${location}/documents/${doc._id}/signed.pdf?token=opaque`}});
  if(u.pathname.endsWith('/appointments') && u.pathname.startsWith('/contacts/'))return Response.json({events:[{id:'qaAppointment000001',calendarId:'s2jDCEAg86oW89dfOPup',startTime:'2026-09-22 16:00:00',appointmentStatus:bookingStatus}]});
  if(u.pathname==='/calendars/events/appointments/qaAppointment000001')return Response.json({appointment:{id:'qaAppointment000001',contactId,locationId:location,calendarId:'s2jDCEAg86oW89dfOPup',startTime:'2026-09-22T16:00:00-04:00',endTime:'2026-09-22T16:30:00-04:00',appointmentStatus:bookingStatus,assignedUserId:'qaHost000000001'}});
  if(u.pathname==='/users/qaHost000000001')return Response.json({id:'qaHost000000001',name:hostName});
  if(u.pathname==='/payments/transactions') {assert.equal(u.searchParams.get('contactId'),contactId);const t=structuredClone(fixture.transaction);if(includeTestPayment)t.liveMode=false;return Response.json({data:[t],totalCount:1});}
  if(u.pathname==='/payments/subscriptions')return Response.json({data:[{_id:fixture.subscription._id,subscriptionId:fixture.subscription.subscriptionId,entityId:fixture.order._id,liveMode:true}],totalCount:1});
  if(u.pathname.startsWith('/payments/orders/')){assert.equal(u.searchParams.get('altType'),'location');return Response.json(fixture.order);}
  if(u.pathname.startsWith('/payments/subscriptions/'))return Response.json(fixture.subscription);
  if(u.pathname.startsWith('/invoices/'))return Response.json({_id:u.pathname.split('/').pop(),altId:location,altType:'location',liveMode:!u.pathname.includes('testInvoice'),status:'paid',currency:'USD',lastPaidAt:'2026-09-10T12:00:00Z',total:500,amountPaid:500,amountDue:0,contactDetails:{id:contactId,email:'qa@example.com'},invoiceItems:[{productId:'6a82cc5ee5be4fc0e73657ae',amount:350,qty:1},{productId:'6a88b142ccdd6adc6f5035c0',amount:150,qty:1}]});
  if(u.pathname.endsWith('/tags')){const body=await req.json();assert.deepEqual(body.tags,['rf-assembly-created','rf-hub-created',...(subscriptionMode?['rf-subscription-initial-paid']:[])]);tags++;return Response.json({tags:body.tags});}
  return Response.json({contact:{id:contactId,locationId:location,firstName:'QA',lastName:'Example',email:'qa@example.com',tags:['rf-subscription-agreement-q2-signed'],customFields:[{id:'SQ0wwhLhD8qZVymkHslW',value:'QA Example LLC'}]}});
 }
 if(u.hostname==='test.supabase.co') {
  if(u.pathname.endsWith('/rpc/apply_ghl_client_enrichment')) {const body=await req.json();const row=hubRows.find(r=>r.id===body.p_client_id);assert.ok(row);assert.equal(body.p_contact_id,contactId);assert.equal(body.p_profile.name,'QA Example');assert.equal(!!body.p_billing,subscriptionMode);enrichmentWrites++;lastProfile=body.p_profile;Object.assign(row,{ghl_contact_id:body.p_contact_id});return Response.json(row.id);}
  if(req.method==='POST'){const row=await req.json();hubRows.push(row);hubCreates++;return Response.json([row],{status:201});}
  const matches=row=>[...u.searchParams].every(([key,value])=>['select','limit','order'].includes(key)||(value==='not.is.null'&&row[key]!=null)||(value.startsWith('eq.')&&row[key]===value.slice(3))||(value.startsWith('ilike.')&&row[key]===value.slice(6)));
  if(req.method==='PATCH'){const patch=await req.json();hubRows.filter(matches).forEach(row=>Object.assign(row,patch));return new Response(null,{status:204});}
  return Response.json(hubRows.filter(matches));
 }
 if(u.hostname==='storage.googleapis.com')return new Response(contractPdf);
 if(u.hostname==='qa.s3.amazonaws.com'){assert.equal(req.method,'PUT');storedPdf=new Uint8Array(await req.arrayBuffer());contractFile.status='complete';return new Response(null);}
 if(u.hostname==='api.assembly.com'){
  if(u.pathname==='/v1/channels/files')return Response.json({data:[{id:contractChannel,companyId:'qa-company',membershipType:'company',memberIds:['qa-client']}]});
  if(u.pathname==='/v1/files')return Response.json({data:u.searchParams.get('path')===''?(contractFolder?[contractFolder]:[]):(contractFile?[contractFile]:[])});
  if(u.pathname==='/v1/files/folder'){const body=await req.json();folderCreates++;contractFolder={id:'qaFolder000001',object:'folder',channelId:contractChannel,path:body.path};return Response.json(contractFolder);}
  if(u.pathname==='/v1/files/file'){const body=await req.json();fileCreates++;contractFile={id:'qaFile00000001',object:'file',channelId:contractChannel,path:body.path,status:'pending',uploadUrl:'https://qa.s3.amazonaws.com/upload'};return Response.json(contractFile);}
  if(u.pathname==='/v1/files/qaFile00000001')return Response.json(contractFile);
  if(u.pathname==='/v1/files/qaFile00000001/download')return new Response(storedPdf);
  if(u.pathname==='/v1/clients'&&req.method==='GET'&&existingMode)return Response.json({data:[{id:'qa-client',email:'qa@example.com',companyId:'qa-company'}]});
  if(u.pathname==='/v1/clients/qa-client')return Response.json({id:'qa-client',email:'qa@example.com',companyId:'qa-company',companyIds:['qa-company']});
  // Real Assembly empty email searches return data:null, not necessarily [].
  if(req.method==='GET')return Response.json({data:null,nextToken:null});
  if(u.pathname==='/v1/companies'){companyCreates++;return Response.json({id:'qa-company'});}
  if(u.pathname==='/v1/clients'){assert.equal(u.searchParams.get('sendInvite'),'false');clientCreates++;return Response.json({id:'qa-client',email:'qa@example.com'});}
 }
 throw Error('Unexpected outbound request '+req.method+' '+req.url);
}}));
const auth={Authorization:'Bearer fake-webhook','Content-Type':'application/json'};
const post=(id=invoiceId)=>mf.dispatchFetch('https://test.local/ghl/'+(subscriptionMode?'subscription-paid':'initial-paid'),{method:'POST',headers:auth,body:JSON.stringify({contact_id:contactId,customData:{invoice_url:"https://links.revfactor.io/invoice/"+id}})});
try{
 const bad=await mf.dispatchFetch('https://test.local/ghl/initial-paid',{method:'POST',body:'{}'});assert.equal(bad.status,401);assert.equal(reads,0);
 includeTestPayment=true;assert.equal((await (await post('testInvoice000000001')).json()).status,subscriptionMode?'ignored_not_initial_live_subscription':'ignored_not_initial_live_payment');includeTestPayment=false;
 const requests=await Promise.all(Array.from({length:20},()=>post()));
 assert.ok(requests.every(r=>r.status===202));
 const results=await Promise.all(requests.map(r=>r.json()));assert.equal(results.filter(r=>!r.duplicate).length,1);
 let status;
 for(let i=0;i<40;i++) {status=await (await mf.dispatchFetch('https://test.local/status?contactId='+contactId,{headers:auth})).json();if(status.status==='complete'&&(!contractMode||['complete','skipped_existing'].includes(status.contractCopy?.status)))break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(status.status,'complete',JSON.stringify(status));assert.equal(clientCreates,existingMode?0:1);assert.equal(companyCreates,existingMode?0:1);assert.equal(tags,1);assert.equal(hubCreates,1);assert.equal(status.hubClientId,hubRows[0].id);assert.equal(hubRows[0].status,'onboarding');
 if(contractMode){assert.equal(status.contractCopy.status,existingMode?'skipped_existing':'complete',JSON.stringify(status));assert.equal(fileCreates,existingMode?0:1);assert.equal(folderCreates,existingMode?0:1);if(!existingMode)assert.deepEqual(storedPdf,contractPdf);}else assert.equal(status.contractCopy,undefined);
 const refresh=()=>mf.dispatchFetch('https://test.local/ghl/enrich',{method:'POST',headers:auth,body:JSON.stringify({contact_id:contactId})});
 assert.equal((await (await refresh()).json()).status,'enriched');assert.equal(lastProfile.onboarding.appointment.host_name,'Future Host');
 bookingStatus='cancelled';hostName='Reassigned Host';
 assert.equal((await (await refresh()).json()).status,'enriched');assert.equal(lastProfile.onboarding.appointment.status,'cancelled');assert.equal(lastProfile.onboarding.appointment.host_name,'Reassigned Host');assert.equal(clientCreates,existingMode?0:1);assert.equal(hubCreates,1);assert.equal(tags,1);assert.equal(enrichmentWrites,3);
 hostName='Cron Updated Host';await (await mf.getWorker()).scheduled({cron:'*/15 * * * *'});assert.equal(enrichmentWrites,4);assert.equal(lastProfile.onboarding.appointment.host_name,'Cron Updated Host');assert.ok(hubRows[0].ghl_sync_attempted_at);assert.equal(hubRows[0].ghl_sync_error,undefined);
 const replay=await (await post('qaInvoiceSecond000001')).json();assert.equal(replay.duplicate,true);assert.equal(clientCreates,existingMode?0:1);
 console.log(contractMode?(existingMode?'Contract existing-client exclusion:':'Contract transfer mode:'):subscriptionMode?'Subscription mode:':'Invoice mode:');
 if(contractMode)assert.equal(fileCreates,existingMode?0:1);
 console.log('Runtime checks passed: unauthorized rejected; test payment ignored; 20 concurrent deliveries deduplicated; new provisioning or existing-client reuse verified; alarm completed; replay deduplicated; no invite sent.');
}finally{await mf.dispose();}

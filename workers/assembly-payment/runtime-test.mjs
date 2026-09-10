import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const compiled=await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],external:['cloudflare:workers','node:*'],write:false});
const location='ErABPRqWbMyIicvzvCFt',contactId='qaContact000000000001',invoiceId='qaInvoice000000000001';
let clientCreates=0,companyCreates=0,tags=0,reads=0,hubCreates=0; const hubRows=[];
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-10',compatibilityFlags:['nodejs_compat'],bindings:{LOCATION_ID:location,ENABLED:'true',ACTIVATED_AT:'2026-09-10T00:00:00Z',HIGHLEVEL_API_KEY:'fake-ghl',ASSEMBLY_API_KEY:'fake-assembly',WEBHOOK_SECRET:'fake-webhook',HUB_SUPABASE_URL:'https://test.supabase.co',HUB_SUPABASE_SERVICE_ROLE_KEY:'fake-hub'},durableObjects:{CLIENTS:{className:'PaidClient',useSQLite:true}},outboundService:async req=>{
 const u=new URL(req.url);reads++;
 if(u.hostname==='services.leadconnectorhq.com'){
  if(u.pathname.startsWith('/invoices/'))return Response.json({_id:u.pathname.split('/').pop(),altId:location,altType:'location',liveMode:!u.pathname.includes('testInvoice'),status:'paid',currency:'USD',lastPaidAt:'2026-09-10T12:00:00Z',total:500,amountPaid:500,amountDue:0,contactDetails:{id:contactId,email:'qa@example.com'},invoiceItems:[{productId:'6a82cc5ee5be4fc0e73657ae',amount:350,qty:1},{productId:'6a88b142ccdd6adc6f5035c0',amount:150,qty:1}]});
  if(u.pathname.endsWith('/tags')){tags++;return Response.json({tags:['rf-assembly-created']});}
  return Response.json({contact:{id:contactId,locationId:location,firstName:'QA',lastName:'Example',email:'qa@example.com',customFields:[{id:'SQ0wwhLhD8qZVymkHslW',value:'QA Example LLC'}]}});
 }
 if(u.hostname==='test.supabase.co') {
  if(req.method==='POST'){const row=await req.json();hubRows.push(row);hubCreates++;return Response.json([row],{status:201});}
  return Response.json(hubRows.filter(row=>[...u.searchParams].every(([key,value])=>key==='select'||key==='limit'||(value.startsWith('eq.')&&row[key]===value.slice(3))||(value.startsWith('ilike.')&&row[key]===value.slice(6)))));
 }
 if(u.hostname==='api.assembly.com'){
  if(u.pathname==='/v1/clients/qa-client')return Response.json({id:'qa-client',email:'qa@example.com',companyId:'qa-company',companyIds:['qa-company']});
  // Real Assembly empty email searches return data:null, not necessarily [].
  if(req.method==='GET')return Response.json({data:null,nextToken:null});
  if(u.pathname==='/v1/companies'){companyCreates++;return Response.json({id:'qa-company'});}
  if(u.pathname==='/v1/clients'){assert.equal(u.searchParams.get('sendInvite'),'false');clientCreates++;return Response.json({id:'qa-client',email:'qa@example.com'});}
 }
 throw Error('Unexpected outbound request '+req.method+' '+req.url);
}}));
const auth={Authorization:'Bearer fake-webhook','Content-Type':'application/json'};
const post=(id=invoiceId)=>mf.dispatchFetch('https://test.local/ghl/initial-paid',{method:'POST',headers:auth,body:JSON.stringify({contact_id:contactId,customData:{invoice_url:"https://links.revfactor.io/invoice/"+id}})});
try{
 const bad=await mf.dispatchFetch('https://test.local/ghl/initial-paid',{method:'POST',body:'{}'});assert.equal(bad.status,401);assert.equal(reads,0);
 assert.equal((await (await post('testInvoice000000001')).json()).status,'ignored_not_initial_live_payment');
 const requests=await Promise.all(Array.from({length:20},()=>post()));
 assert.ok(requests.every(r=>r.status===202));
 const results=await Promise.all(requests.map(r=>r.json()));assert.equal(results.filter(r=>!r.duplicate).length,1);
 let status;
 for(let i=0;i<40;i++) {status=await (await mf.dispatchFetch('https://test.local/status?contactId='+contactId,{headers:auth})).json();if(status.status==='complete')break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(status.status,'complete',JSON.stringify(status));assert.equal(clientCreates,1);assert.equal(companyCreates,1);assert.equal(tags,1);assert.equal(hubCreates,1);assert.equal(status.hubClientId,hubRows[0].id);assert.equal(hubRows[0].status,'onboarding');
 const replay=await (await post('qaInvoiceSecond000001')).json();assert.equal(replay.duplicate,true);assert.equal(clientCreates,1);
 console.log('Runtime checks passed: unauthorized rejected; test payment ignored; 20 concurrent deliveries produced one company/client/Hub record; alarm completed; later paid invoice deduplicated; no invite sent.');
}finally{await mf.dispose();}

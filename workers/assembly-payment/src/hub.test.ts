import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {ensureHubClient,hubIdForAssembly} from './hub.ts';
import type {Job} from './core.ts';
const job:Job={invoiceId:'invoice000001',contactId:'contact000001',email:'qa@example.com',givenName:'QA',familyName:'Example',legalName:'QA Business',listings:2};
const assembly={clientId:'assembly-client-1',companyId:'assembly-company-1'};
type Row=Record<string,unknown>;
function fixture(initial:Row[]=[]) {
  const rows=structuredClone(initial),writes:Row[]=[];
  let failAfterInsert=false,failReads=false;
  const db=createClient('https://test.supabase.co','fake',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
    const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const method=init?.method??'GET';
    function matches(r:Row){return [...u.searchParams].every(([k,v])=>{
      if(['select','limit'].includes(k))return true;
      if(v.startsWith('eq.'))return String(r[k])===v.slice(3);
      if(v==='is.null')return r[k]==null;
      if(v.startsWith('ilike.'))return String(r[k]).toLowerCase()===v.slice(6).replace(/\\([\\%_])/g,'$1').toLowerCase();
      throw Error('unexpected filter '+k+' '+v);
    });}
    if(method==='GET'){if(failReads)return Response.json({code:'OUTAGE',message:'test outage'},{status:503});return Response.json(rows.filter(matches));}
    const body=JSON.parse(String(init?.body));writes.push({method,body});
    if(method==='POST') {
      if(rows.some(r=>r.id===body.id))return Response.json({code:'23505',message:'duplicate'},{status:409});
      rows.push(body);
      if(failAfterInsert){failAfterInsert=false;throw Error('response lost after commit');}
      return Response.json([body],{status:201});
    }
    if(method==='PATCH') {const found=rows.filter(matches);found.forEach(r=>Object.assign(r,body));return Response.json(found);}
    throw Error('unexpected method '+method);
  }}});
  return {db,rows,writes,loseNextInsert:()=>{failAfterInsert=true;},failReads:()=>{failReads=true;}};
}
test('creates linked Onboarding Hub client with deterministic key and no billing guesses',async()=>{
 const f=fixture();const id=await ensureHubClient(f.db,job,assembly);assert.equal(id,await hubIdForAssembly(assembly.clientId));assert.equal(f.rows[0].status,'onboarding');assert.equal(f.rows[0].name,'QA Business');assert.equal(f.rows[0].assembly_company_id,assembly.companyId);assert.equal(f.rows[0].billing_amount,undefined);assert.equal(f.rows[0].autopayment_set_up,undefined);assert.match(String(f.rows[0].assembly_link),/\/companies\/assembly-company-1\/messages$/);
 await ensureHubClient(f.db,job,assembly);assert.equal(f.writes.length,1);
});
test('links one existing email match while preserving status, name and financial fields',async()=>{
 const row={id:'old-hub',email:'QA@EXAMPLE.COM',name:'Keep name',status:'active',billing_amount:999,assembly_client_id:null,assembly_company_id:null,assembly_link:null};const f=fixture([row]);assert.equal(await ensureHubClient(f.db,job,assembly),'old-hub');assert.equal(f.rows.length,1);assert.equal(f.rows[0].status,'active');assert.equal(f.rows[0].name,'Keep name');assert.equal(f.rows[0].billing_amount,999);assert.equal(f.rows[0].assembly_client_id,assembly.clientId);
});
test('committed insert with lost response is reconciled on retry',async()=>{
 const f=fixture();f.loseNextInsert();await assert.rejects(ensureHubClient(f.db,job,assembly));const id=await ensureHubClient(f.db,job,assembly);assert.equal(id,f.rows[0].id);assert.equal(f.rows.length,1);assert.equal(f.writes.length,1);
});
test('simultaneous calls hit the same database primary key',async()=>{
 const f=fixture();const ids=await Promise.all(Array.from({length:8},()=>ensureHubClient(f.db,job,assembly)));assert.equal(new Set(ids).size,1);assert.equal(f.rows.length,1);
});
test('conflicting or duplicate matches never overwrite an existing identity',async()=>{
 for(const rows of [
  [{id:'a',email:job.email,assembly_client_id:'another'}],
  [{id:'a',email:job.email,assembly_company_id:'another'}],
  [{id:'a',email:'another@example.com',assembly_client_id:assembly.clientId}],
  [{id:'a',email:job.email},{id:'b',email:job.email}],
  [{id:'a',email:job.email},{id:'b',email:'other@example.com',assembly_company_id:assembly.companyId}]
 ]){const f=fixture(rows);await assert.rejects(ensureHubClient(f.db,job,assembly),/conflict/);assert.equal(f.writes.length,0);}
});
test('database read errors never fall through to insert',async()=>{const f=fixture();f.failReads();await assert.rejects(ensureHubClient(f.db,job,assembly),/hub_lookup/);assert.equal(f.writes.length,0);});

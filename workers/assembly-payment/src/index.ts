import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { advance, object, str, verifiedJob, invoiceIdFromPayload, type Json, type Job, type State } from './core.ts';
import { ensureHubClient, hubDatabase } from './hub.ts';

type Secrets = { HIGHLEVEL_API_KEY: string; ASSEMBLY_API_KEY: string; WEBHOOK_SECRET: string; HUB_SUPABASE_URL: string; HUB_SUPABASE_SERVICE_ROLE_KEY: string };
type Environment = Env & Secrets;
async function jsonResponse(r: Response): Promise<Json> {
  const reader = r.body?.getReader(); if (!reader) throw new Error('empty_response');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > 1048576) { await reader.cancel(); throw new Error('response_too_large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let i = 0; for (const c of chunks) {bytes.set(c,i); i += c.length;}
  if (!r.ok) throw new Error(`upstream_${r.status}`);
  return object(JSON.parse(new TextDecoder().decode(bytes)));
}
async function api(env: Environment, provider: 'ghl'|'assembly', path: string, method = 'GET', body?: Json): Promise<Json> {
  const headers: Record<string,string> = {'Content-Type':'application/json'};
  if (provider === 'ghl') { headers.Authorization = `Bearer ${env.HIGHLEVEL_API_KEY}`; headers.Version = 'v3'; }
  else headers['X-API-KEY'] = env.ASSEMBLY_API_KEY;
  const base = provider === 'ghl' ? 'https://services.leadconnectorhq.com' : 'https://api.assembly.com/v1';
  return jsonResponse(await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)}));
}
async function readJob(env: Environment, invoiceId: string, contactId: string): Promise<Job|null> {
  const [rawInvoice,rawContact] = await Promise.all([
    api(env,'ghl',`/invoices/${invoiceId}?altId=${env.LOCATION_ID}&altType=location`),
    api(env,'ghl',`/contacts/${contactId}`)
  ]);
  return verifiedJob(rawInvoice.invoice ? object(rawInvoice.invoice) : rawInvoice,object(rawContact.contact),invoiceId,env.LOCATION_ID,env.ACTIVATED_AT);
}
async function identity(email: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email.toLowerCase()));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export class PaidClient extends DurableObject<Environment> {
  async enqueue(job: Job) {
    return this.ctx.storage.transaction(async tx => {
      const existing = await tx.get<State>('state');
      if (existing) {
        if(existing.stage==='complete' && !existing.hubClientId) {
          existing.stage='linked';existing.attempts=0;await tx.put('state',existing);await tx.setAlarm(Date.now()+1000);
        }
        return {status:existing.stage,duplicate:true};
      }
      const state: State = {job,stage:'queued',attempts:0,updatedAt:new Date().toISOString()};
      await tx.put('state',state); await tx.setAlarm(Date.now()+1000);
      return {status:'queued',duplicate:false};
    });
  }
  async status() { const s = await this.ctx.storage.get<State>('state'); return s ? {status:s.stage,clientId:s.clientId,companyId:s.companyId,hubClientId:s.hubClientId,invoiceId:s.job.invoiceId,error:s.error,attempts:s.attempts} : {status:'not_found'}; }
  async alarm() {
    const s = await this.ctx.storage.get<State>('state'); if (!s || (s.stage === 'complete' && s.hubClientId)) return;
    const save = async (state: State) => {state.updatedAt=new Date().toISOString();await this.ctx.storage.put('state',state);};
    if (this.env.ENABLED !== 'true') {await this.ctx.storage.setAlarm(Date.now()+300000);return;}
    if (s.stage === 'review') {
      await api(this.env,'ghl',`/contacts/${s.job.contactId}/tags`,'POST',{tags:[s.clientId?'rf-hub-review':'rf-assembly-review']}); return;
    }
    try {
      s.attempts += 1; await save(s);
      // Recheck payment immediately before provisioning, rather than trusting webhook fields.
      const verified = await readJob(this.env,s.job.invoiceId,s.job.contactId);
      if (!verified || JSON.stringify(verified) !== JSON.stringify(s.job)) throw new Error('payment_or_identity_changed');
      await advance(s,{
        save,
        find: async email => {
          const d=await api(this.env,'assembly',`/clients?email=${encodeURIComponent(email)}&limit=2`);
          if (!Array.isArray(d.data) || d.nextToken) throw new Error('assembly_identity_conflict');
          return d.data.map(object);
        },
        company: name => api(this.env,'assembly','/companies','POST',{name,fallbackColor:'#184c3c'}),
        client: (job,companyId) => api(this.env,'assembly','/clients?sendInvite=false','POST',{givenName:job.givenName,familyName:job.familyName,email:job.email,companyId}),
        hub: async state => {
          const client=await api(this.env,'assembly',`/clients/${state.clientId}`);
          if(str(client.id)!==state.clientId || str(client.email).toLowerCase()!==state.job.email) throw new Error('assembly_identity_conflict');
          const companies=Array.isArray(client.companyIds)?client.companyIds.map(str).filter(Boolean):[];
          const companyId=state.companyId || (companies.length===1?companies[0]:companies.length===0?str(client.companyId)||undefined:undefined);
          if(companyId && !companies.includes(companyId) && str(client.companyId)!==companyId) throw new Error('assembly_company_conflict');
          return ensureHubClient(hubDatabase(this.env.HUB_SUPABASE_URL,this.env.HUB_SUPABASE_SERVICE_ROLE_KEY),state.job,{clientId:state.clientId!,companyId});
        },
        mark: contactId => api(this.env,'ghl',`/contacts/${contactId}/tags`,'POST',{tags:['rf-assembly-created','rf-hub-created']}).then(()=>undefined)
      });
      console.log(JSON.stringify({event:'assembly_hub_handoff_complete',invoiceId:s.job.invoiceId,clientId:s.clientId,hubClientId:s.hubClientId}));
    } catch (error) {
      s.error=error instanceof Error?error.message:'handoff_failed';
      if (s.attempts>=6 || /conflict|requires_review|changed|invalid_assembly/.test(s.error)) s.stage='review';
      await save(s);
      console.error(JSON.stringify({event:'assembly_handoff_error',invoiceId:s.job.invoiceId,status:s.stage,error:s.error}));
      await this.ctx.storage.setAlarm(Date.now()+(s.stage==='review'?1000:Math.min(60000*2**(s.attempts-1),3600000)));
    }
  }
}
export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url=new URL(request.url);
    if (request.method==='GET' && url.pathname==='/health') return Response.json({service:'revfactor-assembly-payment',enabled:env.ENABLED==='true',configured:!!(env.HIGHLEVEL_API_KEY&&env.ASSEMBLY_API_KEY&&env.WEBHOOK_SECRET),hubConfigured:!!(env.HUB_SUPABASE_URL&&env.HUB_SUPABASE_SERVICE_ROLE_KEY)});
    const supplied=request.headers.get('authorization')??''; const expected=`Bearer ${env.WEBHOOK_SECRET}`;
    if (!env.WEBHOOK_SECRET || supplied.length!==expected.length || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return Response.json({error:'unauthorized'},{status:401});
    if (request.method==='GET' && url.pathname==='/status') {
      const contactId=url.searchParams.get('contactId')??'';
      if (!/^[a-zA-Z0-9]{10,40}$/.test(contactId)) return Response.json({error:'invalid_contact'},{status:400});
      const d=object((await api(env,'ghl',`/contacts/${contactId}`)).contact);
      if (d.locationId!==env.LOCATION_ID) return Response.json({error:'wrong_location'},{status:403});
      return Response.json(await env.CLIENTS.getByName(await identity(str(d.email))).status());
    }
    if (request.method!=='POST'||url.pathname!=='/ghl/initial-paid') return Response.json({error:'not_found'},{status:404});
    if (env.ENABLED!=='true') return Response.json({error:'disabled'},{status:503});
    try {
      const body=await jsonResponse(new Response(request.body));
      const custom=body.customData?object(body.customData):body;
      const invoiceId=invoiceIdFromPayload(custom),contactId=str(custom.contact_id)||str(body.contact_id);
      if (!/^[a-zA-Z0-9]{10,40}$/.test(invoiceId)||!/^[a-zA-Z0-9]{10,40}$/.test(contactId)) return Response.json({error:'invalid_ids'},{status:422});
      const job=await readJob(env,invoiceId,contactId);
      if (!job) return Response.json({status:'ignored_not_initial_live_payment'});
      return Response.json(await env.CLIENTS.getByName(await identity(job.email)).enqueue(job),{status:202});
    } catch(error) {
      const code=error instanceof Error?error.message:'request_failed';
      console.error(JSON.stringify({event:'assembly_handoff_rejected',error:code}));
      return Response.json({error:code},{status:502});
    }
  }
} satisfies ExportedHandler<Environment>;

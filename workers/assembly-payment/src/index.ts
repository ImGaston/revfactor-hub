import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { advance, object, str, verifiedJob, invoiceIdFromPayload, type Json, type Job, type State } from './core.ts';
import { ensureHubClient, hubDatabase } from './hub.ts';
import { verifiedSubscriptionJob } from './subscription.ts';
import { contactProfile, subscriptionBilling, ONBOARDING_CALENDAR } from './enrichment.ts';

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
async function readSubscriptionJob(env: Environment, contactId: string, prior?: Job['subscriptionPayment']): Promise<Job|null> {
  const links = object(JSON.parse(env.SUBSCRIPTION_LINKS));
  const policyLinks: Record<string, number> = {};
  for (const [id, quantity] of Object.entries(links)) {
    if (!/^[a-zA-Z0-9]{10,40}$/.test(id) || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw new Error('invalid_subscription_configuration');
    policyLinks[id] = quantity;
  }
  if (!Object.keys(policyLinks).length) return null;
  const query = new URLSearchParams({altId:env.LOCATION_ID,altType:'location',contactId,limit:'100',offset:'0'});
  const [rawTransactions, rawSubscriptions, rawContact] = await Promise.all([
    api(env,'ghl',`/payments/transactions?${query}`), api(env,'ghl',`/payments/subscriptions?${query}`), api(env,'ghl',`/contacts/${contactId}`)
  ]);
  if (!Array.isArray(rawTransactions.data) || !Array.isArray(rawSubscriptions.data)) throw new Error('invalid_payment_response');
  if (Number(rawTransactions.totalCount)>100 || Number(rawSubscriptions.totalCount)>100) throw new Error('payment_history_requires_review');
  const transactions = rawTransactions.data.map(object).filter(t => t.liveMode===true && t.status==='succeeded' && policyLinks[str(t.entitySourceId)] && (!prior || t._id===prior.transactionId));
  const subscriptions = rawSubscriptions.data.map(object);
  for (const transaction of transactions) {
    const matches = subscriptions.filter(s => s.subscriptionId===transaction.subscriptionId && s.entityId===transaction.entityId && s.liveMode===true);
    if (matches.length!==1) continue;
    const subscriptionId=str(matches[0]._id), orderId=str(transaction.entityId);
    if (![subscriptionId,orderId].every(id=>/^[a-zA-Z0-9]{10,40}$/.test(id))) throw new Error('invalid_payment_ids');
    if (prior && (prior.orderId!==orderId || prior.subscriptionId!==subscriptionId)) throw new Error('payment_identity_changed');
    const scope=`altId=${env.LOCATION_ID}&altType=location`;
    const [order,subscription]=await Promise.all([api(env,'ghl',`/payments/orders/${orderId}?${scope}`),api(env,'ghl',`/payments/subscriptions/${subscriptionId}?${scope}`)]);
    const job=verifiedSubscriptionJob(transaction,order,subscription,object(rawContact.contact),{locationId:env.LOCATION_ID,activatedAt:env.SUBSCRIPTIONS_ACTIVATED_AT,links:policyLinks});
    if (job) return job;
  }
  return null;
}
async function identity(email: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email.toLowerCase()));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export class PaidClient extends DurableObject<Environment> {
  private async enrichHub(s: State, includeBooking: boolean) {
    if(!s.hubClientId || !s.clientId) throw new Error('hub_not_provisioned');
    const contact=object((await api(this.env,'ghl',`/contacts/${s.job.contactId}`)).contact);
    let appointment: Json|null=null,host:string|null=null;
    if(includeBooking) {
      const result=await api(this.env,'ghl',`/contacts/${s.job.contactId}/appointments`);
      if(!Array.isArray(result.events)) throw new Error('invalid_appointment_response');
      const matches=result.events.map(object).filter(e=>e.calendarId===ONBOARDING_CALENDAR && e.deleted!==true);
      // Prefer current/future bookings, retain the latest past or canceled record
      // when no current booking remains. Never retain an obsolete confirmed call.
      const live=matches.filter(e=>['confirmed','new','showed'].includes(str(e.appointmentStatus)));
      const sorted=(live.length?live:matches).sort((a,b)=>str(b.startTime).localeCompare(str(a.startTime)));
      if(sorted[0]) {
        const id=str(sorted[0].id);
        if(!/^[a-zA-Z0-9]{10,40}$/.test(id)) throw new Error('invalid_appointment_id');
        appointment=object((await api(this.env,'ghl',`/calendars/events/appointments/${id}`)).appointment);
        const userId=str(appointment.assignedUserId);
        if(/^[a-zA-Z0-9]{10,40}$/.test(userId)) {
          const user=await api(this.env,'ghl',`/users/${userId}`);
          if(user.id!==userId) throw new Error('host_identity_conflict');
          host=str(user.name)||[str(user.firstName),str(user.lastName)].filter(Boolean).join(' ')||null;
        }
      }
    }
    const billing=s.job.subscriptionPayment?subscriptionBilling(s.job,await api(this.env,'ghl',`/payments/subscriptions/${s.job.subscriptionPayment.subscriptionId}?altId=${this.env.LOCATION_ID}&altType=location`),this.env.LOCATION_ID):null;
    const db=hubDatabase(this.env.HUB_SUPABASE_URL,this.env.HUB_SUPABASE_SERVICE_ROLE_KEY);
    const result=await db.rpc('apply_ghl_client_enrichment',{
      p_client_id:s.hubClientId,p_contact_id:s.job.contactId,p_email:s.job.email,
      p_assembly_client_id:s.clientId,p_profile:contactProfile(s.job,contact,this.env.LOCATION_ID,appointment,host),p_billing:billing
    });
    if(result.error) throw new Error('hub_enrichment_'+result.error.code+'_'+(/conflict/.test(result.error.message)?'conflict':'failed'));
    if(result.data!==s.hubClientId) throw new Error('hub_enrichment_identity_conflict');
  }
  async refresh() {
    const s=await this.ctx.storage.get<State>('state');
    if(!s || s.stage!=='complete' || !s.hubClientId) throw new Error('hub_not_provisioned');
    await this.enrichHub(s,true);
    return {status:'enriched',hubClientId:s.hubClientId};
  }
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
      const verified = s.job.subscriptionPayment ? await readSubscriptionJob(this.env,s.job.contactId,s.job.subscriptionPayment) : await readJob(this.env,s.job.invoiceId,s.job.contactId);
      if (!verified || JSON.stringify(verified) !== JSON.stringify(s.job)) throw new Error('payment_or_identity_changed');
      await advance(s,{
        save,
        find: async email => {
          const d=await api(this.env,'assembly',`/clients?email=${encodeURIComponent(email)}&limit=2`);
          if (d.nextToken || (d.data !== null && !Array.isArray(d.data))) throw new Error('assembly_identity_conflict');
          return (d.data ?? []).map(object);
        },
        company: name => api(this.env,'assembly','/companies','POST',{name,fallbackColor:'#184c3c'}),
        client: (job,companyId) => api(this.env,'assembly','/clients?sendInvite=false','POST',{givenName:job.givenName,familyName:job.familyName,email:job.email,companyId}),
        hub: async state => {
          const client=await api(this.env,'assembly',`/clients/${state.clientId}`);
          if(str(client.id)!==state.clientId || str(client.email).toLowerCase()!==state.job.email) throw new Error('assembly_identity_conflict');
          const companies=Array.isArray(client.companyIds)?client.companyIds.map(str).filter(Boolean):[];
          const companyId=state.companyId || (companies.length===1?companies[0]:companies.length===0?str(client.companyId)||undefined:undefined);
          if(companyId && !companies.includes(companyId) && str(client.companyId)!==companyId) throw new Error('assembly_company_conflict');
          const hubClientId=await ensureHubClient(hubDatabase(this.env.HUB_SUPABASE_URL,this.env.HUB_SUPABASE_SERVICE_ROLE_KEY),state.job,{clientId:state.clientId!,companyId});
          await this.enrichHub({...state,hubClientId},false);
          return hubClientId;
        },
        mark: contactId => api(this.env,'ghl',`/contacts/${contactId}/tags`,'POST',{tags:['rf-assembly-created','rf-hub-created',...(s.job.subscriptionPayment?['rf-subscription-initial-paid']:[])]}).then(()=>undefined)
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
  async scheduled(_event: ScheduledController, env: Environment) {
    if(env.ENABLED!=='true') return;
    const db=hubDatabase(env.HUB_SUPABASE_URL,env.HUB_SUPABASE_SERVICE_ROLE_KEY);
    const {data,error}=await db.from('clients').select('id,email,ghl_contact_id')
      .eq('status','onboarding').not('ghl_contact_id','is',null)
      .order('ghl_sync_attempted_at',{ascending:true,nullsFirst:true}).order('id').limit(10);
    if(error) throw new Error('enrichment_queue_'+error.code);
    for(const row of data??[]) {
      // Rotate attempted rows even after a provider outage so one bad identity
      // cannot starve later clients. Only previously provisioned DOs can enrich.
      const attempt=await db.from('clients').update({ghl_sync_attempted_at:new Date().toISOString()}).eq('id',row.id);
      if(attempt.error) throw new Error('enrichment_attempt_'+attempt.error.code);
      try {await env.CLIENTS.getByName(await identity(str(row.email))).refresh();}
      catch(error) {
        const code=error instanceof Error?error.message:'enrichment_failed';
        const saved=await db.from('clients').update({ghl_sync_error:code.slice(0,160)}).eq('id',row.id);
        console.error(JSON.stringify({event:'hub_enrichment_error',clientId:row.id,error:code,saved:!saved.error}));
      }
    }
  },
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
    if(request.method==='POST' && url.pathname==='/ghl/enrich') {
      if(env.ENABLED!=='true') return Response.json({error:'disabled'},{status:503});
      try {
        const body=await jsonResponse(new Response(request.body)),contactId=str(body.contact_id);
        if(!/^[a-zA-Z0-9]{10,40}$/.test(contactId)) return Response.json({error:'invalid_contact'},{status:422});
        const contact=object((await api(env,'ghl',`/contacts/${contactId}`)).contact);
        if(contact.locationId!==env.LOCATION_ID || contact.id!==contactId) return Response.json({error:'wrong_contact'},{status:403});
        return Response.json(await env.CLIENTS.getByName(await identity(str(contact.email))).refresh());
      } catch(error) {return Response.json({error:error instanceof Error?error.message:'enrichment_failed'},{status:502});}
    }
    if (request.method!=='POST'||!['/ghl/initial-paid','/ghl/subscription-paid'].includes(url.pathname)) return Response.json({error:'not_found'},{status:404});
    if (env.ENABLED!=='true') return Response.json({error:'disabled'},{status:503});
    try {
      const body=await jsonResponse(new Response(request.body));
      const custom=body.customData?object(body.customData):body;
      if (url.pathname==='/ghl/subscription-paid') {
        const contactId=str(custom.contact_id)||str(body.contact_id);
        if (!/^[a-zA-Z0-9]{10,40}$/.test(contactId)) return Response.json({error:'invalid_contact'},{status:422});
        const job=await readSubscriptionJob(env,contactId);
        if (!job) return Response.json({status:'ignored_not_initial_live_subscription'});
        return Response.json(await env.CLIENTS.getByName(await identity(job.email)).enqueue(job),{status:202});
      }
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

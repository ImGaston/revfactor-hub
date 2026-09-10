import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { str, type Job } from './core.ts';

export type HubIdentity = { clientId: string; companyId?: string };
type HubRow = { id: string; email: string|null; assembly_client_id: string|null; assembly_company_id: string|null; assembly_link: string|null };
const columns = 'id,email,assembly_client_id,assembly_company_id,assembly_link';
export function hubDatabase(url: string, key: string) {
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
}
export async function hubIdForAssembly(clientId: string): Promise<string> {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('revfactor:ghl-paid:assembly:'+clientId))).slice(0,16);
  bytes[6]=(bytes[6]&15)|128; bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function validExisting(row: HubRow, job: Job, assembly: HubIdentity) {
  if (str(row.email).toLowerCase()!==job.email || (row.assembly_client_id && row.assembly_client_id!==assembly.clientId) || (row.assembly_company_id && assembly.companyId && row.assembly_company_id!==assembly.companyId)) throw new Error('hub_identity_conflict');
}
export async function ensureHubClient(db: SupabaseClient, job: Job, assembly: HubIdentity): Promise<string> {
  if (!assembly.clientId) throw new Error('missing_assembly_identity');
  const id=await hubIdForAssembly(assembly.clientId);
  const emailPattern=job.email.replace(/[\\%_]/g,'\\$&');
  async function find(): Promise<HubRow|null> {
    const queries=[
      db.from('clients').select(columns).eq('id',id).limit(2).returns<HubRow[]>(),
      db.from('clients').select(columns).eq('assembly_client_id',assembly.clientId).limit(2).returns<HubRow[]>(),
      db.from('clients').select(columns).ilike('email',emailPattern).limit(2).returns<HubRow[]>()
    ];
    if (assembly.companyId) queries.push(db.from('clients').select(columns).eq('assembly_company_id',assembly.companyId).limit(2).returns<HubRow[]>());
    const results=await Promise.all(queries);
    for(const result of results) if(result.error) throw new Error('hub_lookup_'+result.error.code);
    const rows=Array.from(new Map(results.flatMap(r=>r.data??[]).map(row=>[row.id,row])).values());
    if(rows.length>1) throw new Error('hub_identity_conflict');
    if(rows[0]) validExisting(rows[0],job,assembly);
    return rows[0]??null;
  }
  let existing=await find();
  const link=assembly.companyId?`https://dashboard.assembly.com/companies/${assembly.companyId}/messages`:`https://dashboard.assembly.com/clients/users/details/${assembly.clientId}/messages`;
  if(!existing) {
    const result=await db.from('clients').insert({id,name:job.legalName,email:job.email,status:'onboarding',onboarding_date:new Date().toISOString().slice(0,10),assembly_client_id:assembly.clientId,assembly_company_id:assembly.companyId??null,assembly_link:link}).select(columns).returns<HubRow[]>();
    if(!result.error && result.data?.length===1) {validExisting(result.data[0],job,assembly);return result.data[0].id;}
    // A lost response is safe to retry: the deterministic primary key prevents
    // another insert even if the previous write committed before the timeout.
    if(result.error?.code!=='23505') throw new Error('hub_insert_'+(result.error?.code??'missing_result'));
    existing=await find();
    if(!existing) throw new Error('hub_insert_conflict');
  }
  if(existing.assembly_client_id===assembly.clientId && (!assembly.companyId || existing.assembly_company_id===assembly.companyId) && existing.assembly_link) return existing.id;
  const patch: Record<string,string>={assembly_client_id:assembly.clientId};
  if(assembly.companyId) patch.assembly_company_id=assembly.companyId;
  if(!existing.assembly_link) patch.assembly_link=link;
  let update=db.from('clients').update(patch).eq('id',existing.id).eq('email',existing.email!);
  update=existing.assembly_client_id?update.eq('assembly_client_id',existing.assembly_client_id):update.is('assembly_client_id',null);
  update=existing.assembly_company_id?update.eq('assembly_company_id',existing.assembly_company_id):update.is('assembly_company_id',null);
  const result=await update.select(columns).returns<HubRow[]>();
  if(result.error) throw new Error('hub_link_'+result.error.code);
  if(result.data?.length!==1) throw new Error('hub_concurrent_identity_conflict');
  validExisting(result.data[0],job,assembly);
  return result.data[0].id;
}

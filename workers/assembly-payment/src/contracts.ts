import {object,str,type Json,type Job} from './core.ts';

export type ContractCopy = {
  status:'pending'|'complete'|'review'|'skipped_existing'; attempts:number; paidAt:string;
  documentId?:string; revision?:number; channelId?:string; fileId?:string;
  folderPending?:boolean; filePending?:boolean; uploadUrl?:string;
  sha256?:string; bytes?:number; completedAt?:string; error?:string; reviewTagged?:boolean;
};
export type ContractApi=(provider:'ghl'|'assembly',path:string,method?:string,body?:Json)=>Promise<Json>;
export type ContractPorts={api:ContractApi; fetch:typeof fetch; assemblyKey:string; save():Promise<void>};
const MAX_PDF=10*1024*1024;
const FOLDER='Signed Contracts';
const idPattern=/^[a-zA-Z0-9-]{10,60}$/;
const rows=(v:unknown):Json[]=>{if(v===null)return [];if(!Array.isArray(v))throw new Error('contract_invalid_list');return v.map(object);};
export function eligibleContractCopy(job:Job,paidAt:string|undefined,activatedAt:string,now:number):boolean {
  const cutoff=Date.parse(activatedAt),paid=Date.parse(paidAt??'');
  return !!job.subscriptionPayment && Number.isFinite(cutoff) && Number.isFinite(paid) && cutoff<=now && paid>=cutoff && paid<=now+60000;
}
export function selectAgreement(documents:Json[],job:Job,locationId:string):Json {
  const name=`RevFactor | Service Agreement | ${job.listings} Listing${job.listings===1?'':'s'} | Live payments`;
  const matches=documents.filter(d=>d.locationId===locationId && d.name===name && d.status==='completed' && d.deleted===false && d.isExpired!==true && rows(d.recipients).some(r=>r.id===job.contactId && str(r.email).toLowerCase()===job.email && r.role==='signer' && r.hasCompleted===true));
  if(matches.length!==1)throw new Error(matches.length?'contract_document_conflict':'contract_document_not_ready');
  const d=matches[0];
  if(!idPattern.test(str(d._id)) || d.documentId!==d._id || !Number.isInteger(d.documentRevision))throw new Error('contract_document_identity_conflict');
  const fields=rows(d.fillableFields);
  if(!fields.some(f=>f.type==='Signature' && f.recipient===job.contactId && f.hasCompleted===true) || fields.some(f=>f.isRequired===true && f.hasCompleted!==true) || rows(d.recipients).some(r=>r.role==='signer' && r.hasCompleted!==true))throw new Error('contract_signature_not_complete');
  return d;
}
export function pdfLinkFromMessages(messages:Json[],doc:Json,job:Job,locationId:string):string {
  const references=rows(doc.links).filter(l=>l.documentId===doc._id && l.recipientId===job.contactId && l.documentRevision===doc.documentRevision && l.deleted===false).map(l=>str(l.referenceId));
  if(!references.length)throw new Error('contract_recipient_link_missing');
  const candidates=new Set<string>();
  for(const m of messages) {
    if(m.locationId!==locationId || m.contactId!==job.contactId || m.direction!=='outbound' || m.messageType!=='TYPE_EMAIL' || m.source!=='app')continue;
    const meta=m.meta?object(m.meta):{};
    const subject=str(meta.email && object(meta.email).subject);
    if(!subject.endsWith(`${str(doc.name)} signed`) || Date.parse(str(m.dateAdded))<Date.parse(str(doc.createdAt)))continue;
    const urls=[...str(m.body).matchAll(/https:\/\/[^\s\]<>"']+/g)].map(m=>m[0].replace(/&amp;/g,'&')).map(u=>{try{return new URL(u);}catch{return null;}}).filter((u):u is URL=>!!u);
    if(!urls.some(u=>u.hostname==='links.revfactor.io' && references.some(ref=>u.pathname===`/documents/v1/${ref}`)))continue;
    for(const u of urls)if(u.origin==='https://services.leadconnectorhq.com' && u.pathname==='/proposals/document/public/download-pdf' && u.searchParams.has('p') && !u.username && !u.password)candidates.add(u.href);
  }
  if(candidates.size!==1)throw new Error(candidates.size?'contract_pdf_link_conflict':'contract_pdf_link_not_ready');
  return [...candidates][0];
}
async function bytes(response:Response):Promise<Uint8Array> {
  if(!response.ok)throw new Error('contract_file_http_'+response.status);
  if(Number(response.headers.get('content-length'))>MAX_PDF)throw new Error('contract_pdf_too_large');
  const reader=response.body?.getReader();if(!reader)throw new Error('contract_pdf_empty');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>MAX_PDF){await reader.cancel();throw new Error('contract_pdf_too_large');}chunks.push(r.value);}
  const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}
  if(new TextDecoder().decode(out.slice(0,5))!=='%PDF-')throw new Error('contract_not_pdf');
  return out;
}
export async function downloadAgreement(url:string,documentId:string,locationId:string,fetcher:typeof fetch):Promise<Uint8Array> {
  const source=new URL(url);
  if(source.origin!=='https://services.leadconnectorhq.com' || source.pathname!=='/proposals/document/public/download-pdf')throw new Error('contract_pdf_source_conflict');
  const r=await fetcher(source,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  // Native completion emails redirect to this document-scoped signed GCS object.
  // Bind the redirect to the verified document, never follow arbitrary email URLs.
  if(![301,302,303,307,308].includes(r.status))throw new Error('contract_pdf_redirect_required');
  const target=new URL(r.headers.get('location')??'');
  if(target.origin!=='https://storage.googleapis.com' || !target.pathname.startsWith(`/leadgen-proposals-estimates/location/${locationId}/documents/${documentId}/`) || target.username || target.password)throw new Error('contract_pdf_document_conflict');
  return bytes(await fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(20000)}));
}
const hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('');
function fileValue(file:Json,key:string):unknown{return file[key]??(file.fields?object(file.fields)[key]:undefined);}
function sameFile(file:Json,channelId:string,path:string) {
  if(file.channelId!==channelId || file.object!=='file' || fileValue(file,'path')!==path || !idPattern.test(str(file.id)))throw new Error('contract_file_identity_conflict');
}
async function verifyContents(fileId:string,expected:string,ports:ContractPorts) {
  let r=await ports.fetch(`https://api.assembly.com/v1/files/${fileId}/download`,{headers:{'X-API-KEY':ports.assemblyKey},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(r.status)) {
    const u=new URL(r.headers.get('location')??'');
    if(u.protocol!=='https:' || !u.hostname.endsWith('.amazonaws.com') || u.username || u.password)throw new Error('contract_download_host_conflict');
    r=await ports.fetch(u,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  }
  if(await hash(await bytes(r))!==expected)throw new Error('contract_copy_hash_conflict');
}
// Archive the original provider PDF byte-for-byte. This function cannot send a
// message, create a client, request a signature or mutate Stripe billing.
export async function copySignedContract(job:Job,clientId:string,companyId:string|undefined,locationId:string,state:ContractCopy,ports:ContractPorts):Promise<void> {
  if(state.status==='complete'||state.status==='review'||state.status==='skipped_existing')return;
  const docs:Json[]=[];let total:number|undefined;
  for(let skip=0;skip<200;skip+=20) {
    const paidAt=Date.parse(state.paidAt);if(!Number.isFinite(paidAt))throw new Error('contract_payment_date_conflict');
    const query=new URLSearchParams({locationId,query:`RevFactor | Service Agreement | ${job.listings} Listing`,limit:'20',skip:String(skip),dateFrom:new Date(paidAt-30*86400000).toISOString(),dateTo:new Date(paidAt+86400000).toISOString()});
    const result=await ports.api('ghl',`/proposals/document?${query}`),page=rows(result.documents);
    if(!Number.isSafeInteger(result.total) || Number(result.total)>200 || (total!==undefined&&total!==result.total))throw new Error('contract_inventory_requires_review');
    total=Number(result.total);docs.push(...page);
    if(docs.length===total)break;if(page.length!==20)throw new Error('contract_inventory_incomplete');
  }
  if(docs.length!==total || new Set(docs.map(d=>str(d._id))).size!==docs.length)throw new Error('contract_inventory_incomplete');
  const doc=selectAgreement(docs,job,locationId),documentId=str(doc._id);
  if(state.documentId && (state.documentId!==documentId || state.revision!==doc.documentRevision))throw new Error('contract_revision_conflict');
  state.documentId=documentId;state.revision=Number(doc.documentRevision);await ports.save();
  const conv=await ports.api('ghl','/conversations/search?'+new URLSearchParams({locationId,contactId:job.contactId,status:'all',limit:'10'}));
  const conversations=rows(conv.conversations);
  if(conv.total!==conversations.length || conversations.length!==1 || conversations[0].contactId!==job.contactId || conversations[0].locationId!==locationId)throw new Error('contract_conversation_conflict');
  const conversationId=str(conversations[0].id);if(!idPattern.test(conversationId))throw new Error('contract_conversation_conflict');
  const allMessages:Json[]=[];let cursor='';const seen=new Set<string>();
  for(let i=0;i<5;i++) {
    const q=new URLSearchParams({limit:'100'});if(cursor)q.set('lastMessageId',cursor);
    const result=object((await ports.api('ghl',`/conversations/${conversationId}/messages?${q}`)).messages);
    allMessages.push(...rows(result.messages));
    if(!result.nextPage)break;
    cursor=str(result.lastMessageId);if(!cursor||seen.has(cursor)||i===4)throw new Error('contract_messages_require_review');seen.add(cursor);
  }
  const pdf=await downloadAgreement(pdfLinkFromMessages(allMessages,doc,job,locationId),documentId,locationId,ports.fetch),digest=await hash(pdf);
  if(state.sha256 && state.sha256!==digest)throw new Error('contract_source_changed_conflict');
  state.sha256=digest;state.bytes=pdf.length;await ports.save();
  const query=new URLSearchParams({...companyId?{companyId}:{clientId},limit:'10'});
  const channelResult=await ports.api('assembly',`/channels/files?${query}`),channels=rows(channelResult.data);
  if(channelResult.nextToken||channels.length>1)throw new Error('contract_channel_conflict');
  if(!channels.length)throw new Error('contract_channel_not_ready');
  const channel=channels[0],channelId=str(channel.id);
  if(!channelId || (companyId?(channel.companyId!==companyId||channel.membershipType!=='company'):(channel.clientId!==clientId||channel.membershipType!=='individual')) || !Array.isArray(channel.memberIds) || !channel.memberIds.includes(clientId) || (state.channelId && state.channelId!==channelId))throw new Error('contract_channel_identity_conflict');
  state.channelId=channelId;await ports.save();
  const list=async(path:string)=>{
    const r=await ports.api('assembly','/files?'+new URLSearchParams({channelId,path,limit:'100'}));
    if(r.nextToken)throw new Error('contract_files_require_review');return rows(r.data);
  };
  const roots=await list(''),folders=roots.filter(f=>fileValue(f,'path')===FOLDER);
  if(folders.length>1 || (folders[0] && (folders[0].object!=='folder'||folders[0].channelId!==channelId)))throw new Error('contract_folder_conflict');
  if(!folders.length) {
    if(state.folderPending)throw new Error('contract_folder_create_requires_review');
    state.folderPending=true;await ports.save();
    const folder=await ports.api('assembly','/files/folder','POST',{channelID:channelId,type:'folder',path:FOLDER,clientPermissions:'read_only'});
    if(folder.object!=='folder'||folder.channelId!==channelId||fileValue(folder,'path')!==FOLDER)throw new Error('contract_folder_conflict');
  }
  delete state.folderPending;await ports.save();
  const path=`${FOLDER}/RevFactor Service Agreement - ${documentId}.pdf`;
  const matches=(await list(FOLDER)).filter(f=>fileValue(f,'path')===path);
  if(matches.length>1)throw new Error('contract_duplicate_file_conflict');
  let file=matches[0];
  if(!file) {
    if(state.filePending||state.fileId)throw new Error('contract_file_create_requires_review');
    state.filePending=true;await ports.save();
    file=await ports.api('assembly','/files/file','POST',{channelID:channelId,type:'file',path});
    sameFile(file,channelId,path);state.fileId=str(file.id);state.uploadUrl=str(file.uploadUrl);await ports.save();
  } else {sameFile(file,channelId,path);if(state.fileId&&state.fileId!==file.id)throw new Error('contract_file_identity_conflict');state.fileId=str(file.id);await ports.save();}
  if(!['complete','completed'].includes(str(fileValue(file,'status')))) {
    const uploadValue=state.uploadUrl||str(file.uploadUrl);
    if(!uploadValue)throw new Error('contract_upload_url_requires_review');
    const upload=new URL(uploadValue);
    if(upload.protocol!=='https:'||!upload.hostname.endsWith('.amazonaws.com')||upload.username||upload.password)throw new Error('contract_upload_host_conflict');
    const response=await ports.fetch(upload,{method:'PUT',body:pdf as BodyInit,headers:{'Content-Type':'application/pdf'},redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('contract_upload_http_'+response.status);
    file=await ports.api('assembly',`/files/${state.fileId}`);sameFile(file,channelId,path);
    if(!['complete','completed'].includes(str(fileValue(file,'status'))))throw new Error('contract_upload_not_ready');
  }
  await verifyContents(state.fileId!,digest,ports);
  state.status='complete';state.completedAt=new Date().toISOString();delete state.error;delete state.uploadUrl;delete state.filePending;await ports.save();
}

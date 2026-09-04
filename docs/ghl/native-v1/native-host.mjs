import {FIELDS,propertyValues,normalizePreferences} from './native-property-adapter.mjs';
import {ACCOUNT_FIELDS,accountValues,accountCommand,finalCommand} from './native-account-adapter.mjs';

export const NATIVE_HOST_VERSION='rf.native.host.1';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAV='.ghl-submit-btn,.ghl-footer-next,.ghl-footer-back';
export function validateHostConfig(config){
 if(!['property','account'].includes(config.kind))throw Error('Unknown native survey');
 const api=new URL(config.apiOrigin),native=new URL(config.nativeOrigin);
 if(api.protocol!=='https:'||api.origin!==config.apiOrigin||native.protocol!=='https:'||native.origin!==config.nativeOrigin)throw Error('Exact HTTPS origins required');
 if(!config.allowedApiOrigins.includes(api.origin)||native.origin!=='https://links.revfactor.io')throw Error('Unreviewed endpoint origin');
 if(!/^[A-Za-z0-9]{20}$/.test(config.propertySurveyId)||!/^[A-Za-z0-9]{20}$/.test(config.accountSurveyId))throw Error('Invalid survey IDs');
 return config;
}
export function validateClientContext(context){
 if(context?.version!=='rf.onboarding.v1'||!UUID.test(context.journeyId)||!Number.isInteger(context.revision)||context.revision<1||!Array.isArray(context.properties)||context.properties.length<1||context.properties.length>5||!Array.isArray(context.missing))throw Error('Invalid onboarding context');
 const ids=context.properties.map(p=>p.id);if(ids.some(id=>!UUID.test(id))||new Set(ids).size!==ids.length)throw Error('Invalid property scope');
 return context;
}
export function preferenceValues(preferences){
 if(!preferences)return {goal:'',restrictionMode:'',minimumNightly:'',minimumStay:'',cleaningFeeMode:'',cleaningFee:'',operatingConstraints:''};
 const p=preferences,modes=[p.minimumNightly.mode,p.minimumStay.mode];
 if(modes.includes('guidance')&&modes.some(m=>m!=='guidance'))throw Error('Your saved preferences need a team review before editing');
 const mode=modes.includes('specified')?'I have firm restrictions':modes.includes('guidance')?'I need guidance':'No firm restrictions';
 return {goal:{revenue:'Increase revenue',occupancy:'Improve occupancy',balanced:'Balance revenue and occupancy',guidance:'I need guidance'}[p.goal],restrictionMode:mode,minimumNightly:p.minimumNightly.mode==='specified'?String(p.minimumNightly.value):'',minimumStay:p.minimumStay.mode==='specified'?String(p.minimumStay.nights):'',cleaningFeeMode:p.cleaningFee.mode==='specified'?'I know the cleaning fee':'I need guidance',cleaningFee:p.cleaningFee.mode==='specified'?String(p.cleaningFee.value):'',operatingConstraints:p.operatingConstraints||''};
}
export function propertyCommand(context,propertyId,values,eventId){
 propertyValues(context,propertyId);
 const status={Live:'live','Not live yet':'pre_launch'}[values.status];
 if(!status)throw Error('Choose whether this property is live');
 if(!['These property details are correct','A contracted detail needs correction'].includes(values.confirmation))throw Error('Confirm the property details before continuing');
 const patch={identityConfirmed:values.confirmation==='These property details are correct',status};
 if(status==='live'){
  if(!values.listingUrl)throw Error('Add the public listing URL');
  let url;try{url=new URL(values.listingUrl);}catch{throw Error('Enter a valid listing URL');}
  if(!['https:','http:'].includes(url.protocol))throw Error('Enter a valid listing URL');
  patch.listingUrl=url.href;patch.targetLaunchDate=null;
 }else{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(values.targetLaunchDate||'')||Number.isNaN(Date.parse(values.targetLaunchDate+'T00:00:00Z'))||new Date(values.targetLaunchDate+'T00:00:00Z').toISOString().slice(0,10)!==values.targetLaunchDate)throw Error('Enter a target launch date as YYYY-MM-DD');
  patch.targetLaunchDate=values.targetLaunchDate;patch.listingUrl=null;
 }
 // Contract identity is carried forward from the server, never from hidden inputs.
 return {action:'property',journeyId:context.journeyId,eventId,expectedRevision:context.revision,propertyId,patch};
}
export function createSession(config,token,fetcher){
 validateHostConfig(config);if(!TOKEN.test(token||''))throw Error('Open your original onboarding link to resume');
 let context=null,pending=null;
 const request=async(path,body)=>{
  const response=await fetcher(config.apiOrigin+'/api/public/highlevel/onboarding-v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  if(!response.ok){
   if(response.status===409){pending=null;throw Error('This onboarding changed in another window. Reopen your original link before saving.');}
   if(response.status===401||response.status===403)throw Error('This link cannot be used here. Reopen the latest onboarding link.');
   if(response.status===400){pending=null;throw Error('This step could not be accepted. Review your answers or contact your RevFactor team.');}
   if(response.status===503)throw Error('Onboarding is not open yet. Your team will confirm when it is ready.');
   throw Error('We could not save this step. Try again; your answers are still on this page.');
  }
  return response.json();
 };
 return {
  get context(){return context;},
  get hasPending(){return pending!==null;},
  async refresh(){const fresh=validateClientContext(await request('context'));if(context&&fresh.journeyId!==context.journeyId)throw Error('Onboarding scope changed');context=fresh;return context;},
  async save(build){
   if(!context)throw Error('Wait for your onboarding details to load');
   // Keep an uncertain request verbatim, including eventId/revision. Never replay
   // a changed payload under an old event or silently replace a concurrent edit.
   if(!pending)pending=build(context);
   if(!['property','preferences','account','submit'].includes(pending.action)||pending.journeyId!==context.journeyId)throw Error('Invalid onboarding action');
   await request('save',pending);
   const fresh=await this.refresh();pending=null;return fresh;
  },
  nativeUrl(kind,propertyId){
   if(!context||propertyId&&!context.properties.some(p=>p.id===propertyId))throw Error('Property does not belong to this onboarding');
   const id=kind==='property'?config.propertySurveyId:config.accountSurveyId;
   const fragment=new URLSearchParams({token,...(propertyId?{propertyId}:{})});
   return config.nativeOrigin+'/widget/survey/'+id+'#'+fragment;
  }
 };
}
export function installNativeGuard(win,root,{onNext,onSubmit,isReady,onBlocked}){
 let replay=null;
 const block=e=>{e.preventDefault();e.stopImmediatePropagation();onBlocked?.(e.type);};
 const click=e=>{
  const target=e.target?.closest?.(NAV);if(!target||!root.contains(target))return;
  if(replay===target){replay=null;return;}
  if(target.matches('.ghl-footer-back')){if(!isReady())block(e);return;}
  block(e);if(!isReady())return;
  if(target.matches('.ghl-submit-btn'))void onSubmit();
  else void onNext(()=>{win.queueMicrotask(()=>{replay=target;target.click();replay=null;});});
 };
 const key=e=>{
  if(!root.contains(e.target))return;
  if(e.key==='Enter'||e.key===' '){
   const target=e.target?.closest?.(NAV);
   if(target){block(e);if(isReady()){if(target.matches('.ghl-submit-btn'))void onSubmit();else if(target.matches('.ghl-footer-next'))void onNext(()=>{win.queueMicrotask(()=>{replay=target;target.click();replay=null;});});else {replay=target;target.click();replay=null;}}}
   else if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA')block(e);
  }
 };
 const submit=e=>{if(e.target===root||root.contains(e.target))block(e);};
 win.addEventListener('click',click,true);win.addEventListener('keydown',key,true);win.addEventListener('submit',submit,true);
 return ()=>{win.removeEventListener('click',click,true);win.removeEventListener('keydown',key,true);win.removeEventListener('submit',submit,true);};
}
export function installProviderWriteGuard(win,config){
 const blockedOrigins=new Set([config.nativeOrigin,'https://backend.leadconnectorhq.com','https://services.leadconnectorhq.com','https://api.leadconnectorhq.com']);
 const isBlocked=(url,method)=>{try{return !['GET','HEAD','OPTIONS'].includes(String(method||'GET').toUpperCase())&&blockedOrigins.has(new URL(String(url),win.location.href).origin);}catch{return true;}};
 const deny=()=>{const root=win.document.documentElement;root.dataset.rfNativeBlockedTransports=String(Number(root.dataset.rfNativeBlockedTransports||0)+1);return Error('Native provider writes are disabled; onboarding saves through the verified Hub only.');};
 if(win.fetch){const original=win.fetch.bind(win);win.fetch=(input,options={})=>{const url=typeof input==='string'||input instanceof win.URL?input:input.url;const method=options.method||input?.method||'GET';if(isBlocked(url,method))return Promise.reject(deny());return original(input,options);};}
 const xhr=win.XMLHttpRequest?.prototype;if(xhr){const open=xhr.open,send=xhr.send,requests=new WeakMap();xhr.open=function(method,url,...rest){requests.set(this,{method,url});return open.call(this,method,url,...rest);};xhr.send=function(...args){const request=requests.get(this);if(request&&isBlocked(request.url,request.method))throw deny();return send.apply(this,args);};}
 if(win.navigator.sendBeacon){const beacon=win.navigator.sendBeacon.bind(win.navigator);win.navigator.sendBeacon=(url,data)=>{if(isBlocked(url,'POST')){deny();return false;}return beacon(url,data);};}
 return {blockDirectFormSubmit(form){form.submit=()=>{deny();};}};
}
export function mountNativeHost(config,win=window,fetcher=win.fetch.bind(win)){
 validateHostConfig(config);
 const doc=win.document,expected=config.kind==='property'?config.propertySurveyId:config.accountSurveyId;
 // Builder preview and wrong-origin embeds cannot acquire capabilities or save.
 if(win.location.pathname!=='/widget/survey/'+expected)return null;
 if(doc.documentElement.dataset.rfNativeHost)return null;
 doc.documentElement.dataset.rfNativeHost=NATIVE_HOST_VERSION;
 const providerGuard=installProviderWriteGuard(win,config);
 const params=new URLSearchParams(win.location.hash.slice(1));let token=params.get('token'),propertyId=params.get('propertyId');
 win.history.replaceState(null,'',win.location.pathname+win.location.search);
 const panel=doc.getElementById('rf-native-status')||doc.createElement('section');panel.id='rf-native-status';panel.setAttribute('aria-live','polite');panel.style.cssText='max-width:760px;margin:20px auto;padding:16px;background:#f4f7fb;border-radius:12px;color:#17233b;font:16px/1.5 system-ui';
 const title=doc.createElement('strong'),message=doc.createElement('p'),nav=doc.createElement('nav');panel.replaceChildren(title,message,nav);
 let form,session,ready=false,busy=false,dirty=false,hydrating=false,hydrated=new WeakSet(),observer;
 let activeWork=null;let formValues={};const ids=config.kind==='property'?FIELDS:ACCOUNT_FIELDS;
 const uuid=()=>win.crypto.randomUUID();
 const say=(text)=>{message.textContent=text;};
 const capture=()=>{
  for(const [key,id]of Object.entries(ids)){
   const plain=doc.getElementById(id);if(plain)formValues[key]=plain.value;
   const radios=Array.from(doc.querySelectorAll('input[type="radio"]')).filter(el=>el.id.includes('_'+id+'_'));
   if(radios.length)formValues[key]=radios.find(el=>el.checked)?.value||'';
  }
  return {...formValues};
 };
 const setControls=()=>{
  if(!session?.context||hydrating)return;hydrating=true;
  try{
   for(const [key,id]of Object.entries(ids)){
    const value=formValues[key]??'',plain=doc.getElementById(id);
    const radios=Array.from(doc.querySelectorAll('input[type="radio"]')).filter(el=>el.id.includes('_'+id+'_'));
    for(const el of plain?[plain]:radios){
     if(hydrated.has(el))continue;hydrated.add(el);
     if(el.type==='radio'){el.checked=value!==''&&el.value===value;if(el.checked)el.dispatchEvent(new win.Event('change',{bubbles:true}));}
     else {const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set;if(setter)setter.call(el,value);else el.value=value;el.dispatchEvent(new win.Event('input',{bubbles:true}));el.dispatchEvent(new win.Event('change',{bubbles:true}));}
     if(['name','street','unit','city','region','postalCode','country','email','journeyId','propertyId','revision','eventId'].includes(key))el.readOnly=true;
     if(key==='minimumStay'){el.min='1';el.max='365';el.step='1';}
    }
   }
  }finally{hydrating=false;}
 };
 const navigate=(url)=>{const target=new URL(url);if(target.pathname===win.location.pathname){win.location.replace(url);win.location.reload();}else win.location.assign(url);};
 const renderNavigation=()=>{
  nav.replaceChildren();if(!session?.context)return;
  for(const [index,p] of session.context.properties.entries()){
   const button=doc.createElement('button');button.type='button';button.textContent='Review property '+(index+1)+': '+p.name+(p.address.unit?' — unit '+p.address.unit:'');button.style.margin='4px';button.disabled=busy;
   button.addEventListener('click',()=>{if(busy||dirty||session.hasPending){say('Save this step before switching properties.');return;}navigate(session.nativeUrl('property',p.id));});nav.append(button);
  }
  if(config.kind==='property'){
   const button=doc.createElement('button');button.type='button';button.textContent='Continue to software and final review';button.style.margin='4px';button.disabled=busy;
   button.addEventListener('click',()=>{if(busy||dirty||session.hasPending){say('Save this step before continuing.');return;}navigate(session.nativeUrl('account'));});nav.append(button);
  }
 };
 const run=async(steps)=>{
  if(busy||!ready)return;busy=true;activeWork ||= {steps,index:0};lock();renderNavigation();say('Saving your answers…');
  try{while(activeWork.index<activeWork.steps.length){await activeWork.steps[activeWork.index]();activeWork.index++;}activeWork=null;dirty=false;}
  catch(error){if(!session.hasPending)activeWork=null;say(error instanceof Error?error.message:'We could not save this step.');}
  finally{busy=false;lock();renderNavigation();}
 };
 const saveProperty=()=>session.save(c=>propertyCommand(c,propertyId,capture(),uuid()));
 const saveAccount=()=>session.save(c=>accountCommand(c,capture(),uuid()));
 const next=advance=>run([
  async()=>{if(config.kind==='property')await saveProperty();else await saveAccount();},
  async()=>{if(config.kind==='property'&&!session.context.properties.find(p=>p.id===propertyId)?.identityConfirmed)throw Error('We saved that the contracted details need review. Contact your RevFactor team before continuing.');say('Saved. Continue with this next step.');advance();}
 ]);
 const submit=()=>{
  if(config.kind==='property')return run([
   async()=>{await saveProperty();},
   async()=>{
    if(!session.context.properties.find(p=>p.id===propertyId)?.identityConfirmed)throw Error('Your contracted details need a team review before you continue.');
    const preferences=normalizePreferences(capture());
    await session.save(c=>({action:'preferences',journeyId:c.journeyId,eventId:uuid(),expectedRevision:c.revision,propertyIds:[propertyId],preferences}));
   },
   async()=>{say('Property saved. Review another property or continue to software and final review.');}
  ]);
  const review=capture().finalReview;
  return run([
   async()=>{if(review!=='I reviewed all properties and want to submit onboarding')throw Error('Review every property and choose the final confirmation before submitting.');await saveAccount();},
   async()=>{await session.save(c=>finalCommand(c,review,uuid()));},
   async()=>{ready=false;say('Your onboarding has been submitted. The team will verify setup and confirm your portal access.');}
  ]);
 };
 const lock=()=>{if(!form)return;form.querySelectorAll('input,textarea,select').forEach(el=>{el.disabled=!ready||busy||!!session?.hasPending;});};
 const boot=async()=>{
  form=doc.getElementById('_builder-form');if(!form)return false;
  providerGuard.blockDirectFormSubmit(form);
  form.before(panel);title.textContent=config.kind==='property'?'Review your property':'Software and final review';say('Loading your saved onboarding details…');
  installNativeGuard(win,form.parentElement,{onNext:next,onSubmit:submit,isReady:()=>ready&&!busy,onBlocked:()=>{doc.documentElement.dataset.rfNativeGuardBlocks=String(Number(doc.documentElement.dataset.rfNativeGuardBlocks||0)+1);}});
  doc.documentElement.dataset.rfNativeGuard='installed';
  form.addEventListener('input',()=>{if(!hydrating){dirty=true;capture();}});form.addEventListener('change',()=>{if(!hydrating){dirty=true;capture();}});
  observer=new win.MutationObserver(()=>{setControls();});observer.observe(form,{childList:true,subtree:true});
  lock();
  try{
   if(win.location.origin!==config.nativeOrigin)throw Error('Use the original RevFactor onboarding link.');
   session=createSession(config,token,fetcher);token=null;const context=await session.refresh();
   if(config.kind==='property'){
    if(!propertyId)propertyId=context.properties[0].id;
    const property=context.properties.find(p=>p.id===propertyId);if(!property)throw Error('This property is not part of your onboarding');
    formValues={...propertyValues(context,propertyId),...preferenceValues(property.preferences)};
    // Prior confirmation is displayed on resume, never fabricated for a new property.
    formValues.confirmation=property.identityConfirmed?'These property details are correct':'';
    title.textContent=property.name+' — '+Object.values(property.address).filter(Boolean).join(', ');
   }else {formValues=accountValues(context);title.textContent='Software and final review — '+context.email;}
   ready=context.stage==='onboarding';setControls();
   if(config.kind==='account'){const email=doc.getElementById('email');if(email){email.value=context.email||'';const wrapper=email.closest('[id^="el_"]');if(wrapper)wrapper.hidden=true;}}
   lock();renderNavigation();dirty=false;
   say(ready?'Your saved details are filled in. Review this step and save to continue. Reopen your original link any time to resume saved steps.':context.stage==='submitted'?'Your onboarding is already submitted.':'This onboarding is not accepting changes yet. Your team will confirm the next step.');
  }catch(error){ready=false;lock();say(error instanceof Error?error.message:'Onboarding could not load.');}
  return true;
 };
 // Native HTML executes after GHL mounts the survey. Guard is installed before
 // fetching any context. Late/replaced controls are hydrated through the observer.
 if(doc.getElementById('_builder-form'))void boot();else{
  const mountObserver=new win.MutationObserver(()=>{if(doc.getElementById('_builder-form')){mountObserver.disconnect();void boot();}});mountObserver.observe(doc.documentElement,{childList:true,subtree:true});
 }
 return {version:NATIVE_HOST_VERSION};
}

// Temporary native-preview QA only. This is NEVER part of either production host.
// All writes are in memory; all actual fetch/XHR/beacon writes are rejected.
function createNativeBrowserFixture(){
 const d=document.documentElement;
 const j='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
 let calls=[],events=new Map(),attempts=0,bubbles=0,writePaths=[];
 const preferences={goal:'balanced',minimumNightly:{mode:'none'},minimumStay:{mode:'none'},cleaningFee:{mode:'guidance'},operatingConstraints:''};
 const state={version:'rf.onboarding.v1',journeyId:j,email:'synthetic@example.invalid',name:'Synthetic fixture',stage:'onboarding',revision:1,properties:[a,b].map((id,i)=>({id,name:'Synthetic same-name property',address:{street:'100 Example St',unit:i?'B':'A',city:'Example',region:'TX',postalCode:'00000',country:'US'},listingUrl:'https://example.invalid/listing',status:'live',targetLaunchDate:null,identityConfirmed:true,preferences:structuredClone(preferences)})),software:{pmsName:'Synthetic PMS',pms:'done',airbnb:'done',pricelabs:'need_help'},expectationsAcknowledged:false,missing:['expectations']};
 const metrics=()=>{d.dataset.rfFixture=JSON.stringify({calls:calls.map(c=>({action:c.action,propertyId:c.propertyId,propertyIds:c.propertyIds,revision:c.expectedRevision})),stage:state.stage,revision:state.revision,nativeWriteAttempts:attempts,nativeBubbleHandlers:bubbles,writePaths,units:state.properties.map(p=>p.address.unit)});};metrics();
 const deny=(url)=>{attempts++;try{const u=new URL(String(url),location.href);writePaths.push(u.origin+u.pathname);}catch{writePaths.push('unknown');}metrics();throw Error('Fixture forbids provider writes');};
 const originalFetch=window.fetch.bind(window);window.fetch=(url,options={})=>{if((options.method||'GET').toUpperCase()!=='GET')return Promise.reject((()=>{try{deny(url);}catch(e){return e;}})());return originalFetch(url,options);};
 const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.open=function(method,...args){this.rfFixtureMethod=String(method).toUpperCase();this.rfFixtureUrl=args[0];return originalOpen.call(this,method,...args);};
 XMLHttpRequest.prototype.send=function(...args){if(this.rfFixtureMethod!=='GET')return deny(this.rfFixtureUrl);return originalSend.apply(this,args);};
 navigator.sendBeacon=()=>{attempts++;metrics();return false;};
 const fetcher=async(url,opt)=>{
  if(!/^https:\/\/hub\.revfactor\.io\/api\/public\/highlevel\/onboarding-v1\/(context|save)$/.test(url))throw Error('Unexpected fixture URL');
  if(opt.headers.Authorization!=='Bearer '+'a'.repeat(43))return {ok:false,status:401};
  if(url.endsWith('/context'))return {ok:true,status:200,json:async()=>structuredClone(state)};
  const cmd=JSON.parse(opt.body);if(events.has(cmd.eventId))return {ok:true,status:200,json:async()=>({revision:state.revision,replayed:true})};
  if(cmd.expectedRevision!==state.revision||cmd.journeyId!==j)return {ok:false,status:409};
  if(cmd.action==='property')Object.assign(state.properties.find(p=>p.id===cmd.propertyId),cmd.patch);
  if(cmd.action==='preferences')state.properties.filter(p=>cmd.propertyIds.includes(p.id)).forEach(p=>p.preferences=cmd.preferences);
  if(cmd.action==='account'){state.software=cmd.software;state.expectationsAcknowledged=cmd.expectationsAcknowledged;state.missing=cmd.expectationsAcknowledged?[]:['expectations'];}
  if(cmd.action==='submit'){if(state.missing.length)return {ok:false,status:400};state.stage='submitted';}
  calls.push(cmd);events.set(cmd.eventId,cmd);state.revision++;metrics();return {ok:true,status:200,json:async()=>({revision:state.revision})};
 };
 const watch=()=>{
  const form=document.getElementById('_builder-form');if(!form)return;
  form.addEventListener('submit',()=>{bubbles++;metrics();});
  form.parentElement.addEventListener('click',e=>{if(e.target.closest('.ghl-submit-btn')){bubbles++;metrics();}});
  // Test the native requestSubmit path after hydration, without a provider write.
  const observer=new MutationObserver(()=>{
   if(document.querySelector('#rf-native-status')?.textContent.includes('Your saved details are filled in')){
    observer.disconnect();form.requestSubmit();d.dataset.rfFixtureRequestSubmit='blocked';metrics();
   }
  });observer.observe(document.documentElement,{childList:true,subtree:true});
 };
 return {fetcher,watch};
}

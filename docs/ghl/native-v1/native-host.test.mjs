import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {validateHostConfig,validateClientContext,createSession,propertyCommand,preferenceValues,installNativeGuard,installProviderWriteGuard,mountNativeHost} from './native-host.mjs';
import {FIELDS} from './native-property-adapter.mjs';
import {ACCOUNT_FIELDS} from './native-account-adapter.mjs';
const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.RF_NATIVE_JSDOM_MODULE||'/tmp/rf-native-host-tests/node_modules/jsdom');
const token='a'.repeat(43),j='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
const config={kind:'property',apiOrigin:'https://hub.revfactor.io',allowedApiOrigins:['https://hub.revfactor.io'],nativeOrigin:'https://links.revfactor.io',propertySurveyId:'VvcWqrwmq7wESZSfFBme',accountSurveyId:'CfTInIn60HazWmPD1Zf9'};
const prefs={goal:'balanced',minimumNightly:{mode:'none'},minimumStay:{mode:'none'},cleaningFee:{mode:'guidance'},operatingConstraints:''};
const context=()=>({version:'rf.onboarding.v1',journeyId:j,email:'synthetic@example.invalid',name:'Synthetic fixture',stage:'onboarding',revision:1,properties:[a,b].map((id,i)=>({id,name:'Same property name',address:{street:'100 Example St',unit:i?'B':'A',city:'Example',region:'TX',postalCode:'00000',country:'US'},listingUrl:'https://example.invalid/listing',status:'live',targetLaunchDate:null,identityConfirmed:true,preferences:structuredClone(prefs)})),software:{pmsName:'Synthetic PMS',pms:'done',airbnb:'done',pricelabs:'need_help'},expectationsAcknowledged:false,missing:['expectations']});
const ok=value=>({ok:true,status:200,json:async()=>structuredClone(value)});
const tick=()=>new Promise(r=>setTimeout(r,0));
function backend(initial=context()){
 let current=initial;const calls=[],events=new Map();
 const fetcher=async(url,opt)=>{
  assert.equal(new URL(url).origin,config.apiOrigin);assert.equal(opt.redirect,'error');assert.equal(opt.credentials,'omit');assert.equal(opt.headers.Authorization,'Bearer '+token);
  if(url.endsWith('/context'))return ok(current);
  const cmd=JSON.parse(opt.body);calls.push(cmd);
  if(events.has(cmd.eventId)){assert.deepEqual(cmd,events.get(cmd.eventId));return ok({revision:current.revision,replayed:true});}
  assert.equal(cmd.expectedRevision,current.revision);assert.equal(cmd.journeyId,j);
  if(cmd.action==='property')Object.assign(current.properties.find(p=>p.id===cmd.propertyId),cmd.patch);
  if(cmd.action==='preferences')current.properties.filter(p=>cmd.propertyIds.includes(p.id)).forEach(p=>p.preferences=cmd.preferences);
  if(cmd.action==='account'){current.software=cmd.software;current.expectationsAcknowledged=cmd.expectationsAcknowledged;current.missing=cmd.expectationsAcknowledged?[]:['expectations'];}
  if(cmd.action==='submit'){assert.equal(current.missing.length,0);current.stage='submitted';}
  events.set(cmd.eventId,cmd);current.revision++;return ok({revision:current.revision});
 };return {fetcher,calls,get current(){return current;}};
}
function dom(kind='property',hash='#token='+token+'&propertyId='+a){
 const fields=kind==='property'?FIELDS:ACCOUNT_FIELDS;
 const values=kind==='property'?{status:['Live','Not live yet'],confirmation:['These property details are correct','A contracted detail needs correction'],goal:['Increase revenue','Improve occupancy','Balance revenue and occupancy','I need guidance'],restrictionMode:['No firm restrictions','I have firm restrictions','I need guidance'],cleaningFeeMode:['I know the cleaning fee','I need guidance']}:{pms:['Done','Need help','Not applicable'],airbnb:['Done','Need help'],pricelabs:['Done','Need help'],expectations:['I understand and confirm','I need help before submitting'],finalReview:['I reviewed all properties and want to submit onboarding','I still need to review my properties']};
 const html='<section id="rf-native-status"></section><div class="ghl-form-wrap"><form id="_builder-form">'+Object.entries(fields).map(([key,id])=>values[key]?values[key].map((v,i)=>`<input type="radio" name="${id}" id="${v}_${id}_${i}_fixture" value="${v}">`).join(''):`<input id="${id}" ${key==='email'?'type="email"':''}>`).join('')+'</form><div class="ghl-footer-next" role="button" tabindex="0">Next</div><div class="ghl-submit-btn" role="button" tabindex="0">Submit</div></div>';
 return new JSDOM(html,{url:config.nativeOrigin+'/widget/survey/'+(kind==='property'?config.propertySurveyId:config.accountSurveyId)+hash});
}
test('reviewed origins and context scope fail closed',()=>{
 assert.throws(()=>validateHostConfig({...config,apiOrigin:'https://attacker.invalid'}),/Unreviewed/);
 assert.throws(()=>validateHostConfig({...config,apiOrigin:'https://hub.revfactor.io/path'}),/Exact/);
 assert.throws(()=>validateClientContext({...context(),properties:[context().properties[0],context().properties[0]]}),/scope/);
 assert.throws(()=>createSession(config,'corrupt',()=>{}),/original/);
});
test('signed property identity never comes from browser fields',()=>{
 const cmd=propertyCommand(context(),a,{status:'Live',listingUrl:'https://example.invalid/x',confirmation:'These property details are correct',name:'Tampered',street:'Changed',propertyId:b},'e');
 assert.equal(cmd.propertyId,a);assert.equal(cmd.patch.address,undefined);assert.equal(cmd.patch.name,undefined);
 assert.throws(()=>propertyCommand(context(),'44444444-4444-4444-8444-444444444444',{status:'Live'},'e'),/match/);
});
test('ambiguous preferences cannot be silently changed',()=>{
 assert.throws(()=>preferenceValues({...prefs,minimumNightly:{mode:'guidance'}}),/team review/);
 assert.equal(preferenceValues({...prefs,minimumStay:{mode:'specified',nights:5}}).minimumStay,'5');
});
test('uncertain response reuses same event and payload; subsequent resume sees accepted state',async()=>{
 const be=backend(),s=createSession(config,token,be.fetcher);await s.refresh();
 let once=true;const flaky=createSession(config,token,async(url,opt)=>{const res=await be.fetcher(url,opt);if(url.endsWith('/save')&&once){once=false;throw Error('network interrupted');}return res;});await flaky.refresh();
 const build=c=>({action:'preferences',journeyId:j,eventId:'same-event',expectedRevision:c.revision,propertyIds:[a],preferences:{...prefs,goal:'revenue'}});
 await assert.rejects(flaky.save(build),/interrupted/);assert.equal(flaky.hasPending,true);await flaky.save(()=>{throw Error('must reuse pending');});
 assert.deepEqual(be.calls[0],be.calls[1]);assert.equal(be.current.revision,2);assert.equal(be.current.properties[1].preferences.goal,'balanced');
 await s.refresh();assert.equal(s.context.properties[0].preferences.goal,'revenue');assert.equal(s.context.properties[0].address.unit,'A');assert.equal(s.context.properties[1].address.unit,'B');
 assert.throws(()=>s.nativeUrl('property','bad'),/belong/);assert.equal(new URL(s.nativeUrl('account')).search,'');
});
test('revision conflict and explicit invalid command do not keep a retriable pending write',async()=>{
 for(const status of [400,409]){const s=createSession(config,token,async url=>url.endsWith('/context')?ok(context()):({ok:false,status}));await s.refresh();await assert.rejects(s.save(c=>({action:'submit',journeyId:j,eventId:'x',expectedRevision:c.revision})));assert.equal(s.hasPending,false);}
});
test('real DOM capture blocks final click, keyboard, dispatch submit and requestSubmit before provider listeners',()=>{
 const d=dom(),w=d.window,form=w.document.querySelector('form'),button=w.document.querySelector('.ghl-submit-btn');let native=0,submits=0;
 installNativeGuard(w,form.parentElement,{isReady:()=>true,onNext:()=>{},onSubmit:()=>{submits++;}});
 button.addEventListener('click',()=>native++);form.addEventListener('submit',()=>native++);
 button.click();button.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));form.requestSubmit();
 assert.equal(native,0);assert.equal(submits,2);w.close();
});
test('native Next is replayed once only after accepted save',async()=>{
 const d=dom(),w=d.window,form=w.document.querySelector('form'),button=w.document.querySelector('.ghl-footer-next');let advanced=0,saved=0;
 button.addEventListener('click',()=>advanced++);installNativeGuard(w,form.parentElement,{isReady:()=>true,onNext:advance=>{saved++;advance();},onSubmit:()=>{}});button.click();await tick();assert.equal(saved,1);assert.equal(advanced,1);w.close();
});
test('invalid capability clears fragment, disables native fields and never contacts any endpoint',async()=>{
 const d=dom('property','#token=bad&propertyId='+a),w=d.window;let calls=0;
 mountNativeHost(config,w,async()=>{calls++;});await tick();assert.equal(w.location.hash,'');assert.equal(calls,0);assert.equal(w.document.querySelector('input').disabled,true);assert.match(w.document.querySelector('#rf-native-status').textContent,/original/);w.close();
});
test('property hydration preserves unit identity and guarded save affects only the bound property',async()=>{
 const d=dom(),w=d.window,be=backend();let native=0;w.document.querySelector('.ghl-submit-btn').addEventListener('click',()=>native++);
 mountNativeHost(config,w,be.fetcher);await tick();assert.equal(w.document.getElementById(FIELDS.unit).value,'A');assert.equal(w.document.getElementById(FIELDS.unit).readOnly,true);assert.equal(w.document.querySelector('input[value="Live"]').checked,true);
 const radio=w.document.querySelector('input[value="Increase revenue"]');radio.checked=true;radio.dispatchEvent(new w.Event('change',{bubbles:true}));
 w.document.querySelector('.ghl-submit-btn').click();await tick();await tick();assert.equal(native,0);assert.equal(be.current.properties[0].preferences.goal,'revenue');assert.equal(be.current.properties[1].preferences.goal,'balanced');assert.match(w.document.querySelector('#rf-native-status').textContent,/Property saved/);w.close();
});
test('account final acceptance saves account then submits using fresh revision',async()=>{
 const d=dom('account','#token='+token),w=d.window,be=backend();mountNativeHost({...config,kind:'account'},w,be.fetcher);await tick();
 assert.equal(w.document.getElementById('email').value,'synthetic@example.invalid');assert.equal(w.document.getElementById('email').readOnly,true);
 for(const value of ['I understand and confirm','I reviewed all properties and want to submit onboarding']){const radio=w.document.querySelector(`input[value="${value}"]`);radio.checked=true;radio.dispatchEvent(new w.Event('change',{bubbles:true}));}
 w.document.querySelector('.ghl-submit-btn').click();await tick();await tick();assert.deepEqual(be.calls.map(c=>c.action),['account','submit']);assert.equal(be.current.stage,'submitted');assert.match(w.document.querySelector('#rf-native-status').textContent,/has been submitted/);w.close();
});

test('native telemetry and direct provider write paths cannot reach a transport',async()=>{
 const d=dom(),w=d.window;let calls=0;w.fetch=async()=>{calls++;return {};};
 const guard=installProviderWriteGuard(w,config);
 await assert.rejects(w.fetch('https://backend.leadconnectorhq.com/forms/form-survey-event',{method:'POST'}),/disabled/);
 await assert.rejects(w.fetch('https://services.leadconnectorhq.com/contacts',{method:'POST'}),/disabled/);
 await w.fetch('https://hub.revfactor.io/api/public/highlevel/onboarding-v1/save',{method:'POST'});assert.equal(calls,1);
 const xhr=new w.XMLHttpRequest();xhr.open('POST','https://backend.leadconnectorhq.com/forms/submit');assert.throws(()=>xhr.send(''),/disabled/);
 const form=w.document.querySelector('form');guard.blockDirectFormSubmit(form);form.submit();assert.equal(w.document.documentElement.dataset.rfNativeBlockedTransports,'4');w.close();
});

import { saveCommand } from './native-property-adapter.mjs';
export const ACCOUNT_FIELDS=Object.freeze({email:'email',pmsName:'OpPuXQ2VNvurWTvVVWmd',pms:'NHMjbW45XlxYskaNPg9d',airbnb:'c4E5XFx2lqPI9UK6iKyb',pricelabs:'QOSdb67f7oqo9HE40nfG',expectations:'mbhZi7wTgwuVNxUeQFCA',finalReview:'vPRNpHwEQhBRYdB52eX2',journeyId:'vkey7G3F8jD7Qb4eAz7u',revision:'vrMb2MQ4uAWvJaT2cZof'});
const STATUS={'Done':'done','Need help':'need_help','Not applicable':'not_applicable'};
export function accountCommand(context,values,eventId){
 const pms=STATUS[values.pms],airbnb=STATUS[values.airbnb],pricelabs=STATUS[values.pricelabs];
 if(!pms||!['done','need_help'].includes(airbnb)||!['done','need_help'].includes(pricelabs))throw Error('Complete the setup status for each tool');
 const pmsName=String(values.pmsName||'').trim()||null;
 if(pms==='done'&&!pmsName)throw Error('Name your PMS or choose Need help or Not applicable');
 return {action:'account',journeyId:context.journeyId,eventId,expectedRevision:context.revision,software:{pmsName:pms==='not_applicable'?null:pmsName,pms,airbnb,pricelabs},expectationsAcknowledged:values.expectations==='I understand and confirm'};
}
export function finalCommand(context,review,eventId){
 if(review!=='I reviewed all properties and want to submit onboarding')throw Error('Review all properties before final submission');
 if(context.stage!=='onboarding'||!context.expectationsAcknowledged||!Array.isArray(context.missing)||context.missing.length)throw Error('Finish the remaining onboarding steps first');
 if(!context.properties?.length||context.properties.some(p=>!p.identityConfirmed||!p.preferences))throw Error('Review every property before final submission');
 return {action:'submit',journeyId:context.journeyId,eventId,expectedRevision:context.revision};
}
export async function saveAccount(token,context,values,eventId,fetcher){return saveCommand(token,accountCommand(context,values,eventId),fetcher);}
// Account-save and final-submit are intentionally distinct user actions. Re-fetch
// accepted context/revision after save; never submit from stale partial form data.

export function accountValues(context){
 const software=context.software||{};
 const labels={done:'Done',need_help:'Need help',not_applicable:'Not applicable'};
 const saved=Object.keys(software).length>0;
 if(saved&&(!labels[software.pms]||!['done','need_help'].includes(software.airbnb)||!['done','need_help'].includes(software.pricelabs)))throw Error('Saved software setup is invalid');
 const pmsName=String(software.pmsName||'').trim();
 if(saved&&software.pms==='done'&&!pmsName)throw Error('Saved software setup is invalid');
 return {email:context.email||'',journeyId:context.journeyId,revision:String(context.revision),pmsName:software.pms==='not_applicable'?'':pmsName,pms:labels[software.pms]||'',airbnb:labels[software.airbnb]||'',pricelabs:labels[software.pricelabs]||'',expectations:'',finalReview:''};
}
export function hydrateAccountControls(document,context){
 const values=accountValues(context);
 for(const [key,value] of Object.entries(values)){
  const id=ACCOUNT_FIELDS[key];
  if(['pms','airbnb','pricelabs','expectations','finalReview'].includes(key)){
   const controls=Array.from(document.querySelectorAll('input[type="radio"]')).filter(el=>el.id.includes('_'+id+'_'));
   if(!controls.length)throw Error('Native account control missing: '+key);
   for(const el of controls){el.checked=value!==''&&el.value===value;el.dispatchEvent(new Event('change',{bubbles:true}));}
  }else{
   const el=document.getElementById(id);if(!el)throw Error('Native account control missing: '+key);
   const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set;
   if(setter)setter.call(el,value);else el.value=value;
   el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
   if(key==='email')el.readOnly=true;
  }
 }
 return values;
}
export function takeAccountFragmentContext(location,history){
 const token=new URLSearchParams(location.hash.slice(1)).get('token');
 history.replaceState(null,'',location.pathname+location.search);
 if(!token)throw Error('Open the onboarding link sent to you');
 return {token};
}

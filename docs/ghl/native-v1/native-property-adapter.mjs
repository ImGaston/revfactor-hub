/** Native GHL control adapter. No custom form, contact mutation or provider submission.
 * Install only in a reviewed GHL draft host after context/CORS and submit interception QA.
 */
export const FIELDS = Object.freeze({
  name:'BTVvr4WB4I1LqmgF8sRg',journeyId:'BvxmARSSjpjbp48NaUch',propertyId:'nnUO16lIpNcxhYHrSqRI',
  revision:'MHGXM4RFYDNp6iUjm1Ta',eventId:'gUycOvauH6FXYeEdlgNo',
  street:'OGyYSQCYbuI6vxg0ieni',unit:'bppbuXQoq6O5zO4CYOZN',city:'QoQJUpAsHG9C5Mzkb5YF',
  region:'d9UHvDeWnVGoc8us7mb7',postalCode:'K170RCtELoIyu3IbZOkh',country:'ZJ5AI9LCqQ9hsVT8DCNG',
  listingUrl:'YzlkO3UNX194zAJmnIUy',targetLaunchDate:'Gkrs3oj9BnRakjH2se4x',status:'2m0q8g8MbQWxmqqQPZub',
  confirmation:'ZDKDI27ADG9KA0iWrnNv',goal:'FxWTKaMZcYt2lXAV3BEz',
  restrictionMode:'4yKWa3nqO5pK3ZTMemqS',operatingConstraints:'L3o5PbaX78PhvzVKMCi4',
  minimumNightly:'bfmZWZPlbFYGoo0GoPG1',cleaningFee:'VssKHPZxoXcxafVRS6c5',cleaningFeeMode:'5KiZrzDmWy2nOumJ2rIl',
  minimumStay:'BiJOXBKZzLWgWtJ05iLb'
});
export const CONTEXT_URL='https://hub.revfactor.io/api/public/highlevel/onboarding-v1/context';
const GOAL_LABELS={revenue:'Increase revenue',occupancy:'Improve occupancy',balanced:'Balance revenue and occupancy',guidance:'I need guidance'};
const RESTRICTION_LABELS={none:'No firm restrictions',specified:'I have firm restrictions',guidance:'I need guidance'};
const RADIO_FIELDS=new Set(['status','confirmation','goal','restrictionMode','cleaningFeeMode']);
function savedPreferenceValues(preferences){
  if(!preferences)return {goal:'',restrictionMode:'',operatingConstraints:'',minimumNightly:'',minimumStay:'',cleaningFeeMode:'',cleaningFee:''};
  const goal=GOAL_LABELS[preferences.goal];
  const nightly=preferences.minimumNightly,stay=preferences.minimumStay,cleaning=preferences.cleaningFee;
  if(!goal||!nightly||!stay||!cleaning)throw Error('Saved property preferences are invalid');
  const modes=[nightly.mode,stay.mode];
  let restrictionMode;
  if(modes[0]===modes[1])restrictionMode=RESTRICTION_LABELS[modes[0]];
  else if(modes.every(mode=>mode==='specified'||mode==='none'))restrictionMode=RESTRICTION_LABELS.specified;
  else throw Error('Saved pricing preferences require explicit review');
  if(!restrictionMode)throw Error('Saved property preferences are invalid');
  const minimumNightly=nightly.mode==='specified'?String(nightly.value):'';
  const minimumStay=stay.mode==='specified'?String(stay.nights):'';
  let cleaningFeeMode='',cleaningFee='';
  if(cleaning.mode==='guidance')cleaningFeeMode='I need guidance';
  else if(cleaning.mode==='specified'){cleaningFeeMode='I know the cleaning fee';cleaningFee=String(cleaning.value);}
  else throw Error('Saved property preferences are invalid');
  if((nightly.mode==='specified'&&(!Number.isFinite(nightly.value)||nightly.value<0||nightly.value>1000000))||(stay.mode==='specified'&&(!Number.isInteger(stay.nights)||stay.nights<1||stay.nights>365))||(cleaning.mode==='specified'&&(!Number.isFinite(cleaning.value)||cleaning.value<0||cleaning.value>1000000)))throw Error('Saved property preferences are invalid');
  return {goal,restrictionMode,operatingConstraints:String(preferences.operatingConstraints||''),minimumNightly,minimumStay,cleaningFeeMode,cleaningFee};
}
export function propertyValues(context, propertyId) {
  if (!context || !Number.isInteger(context.revision) || !Array.isArray(context.properties)) throw Error('Invalid onboarding context');
  const matches=context.properties.filter(p=>p.id===propertyId);
  if(matches.length!==1) throw Error('Property does not match this journey');
  const p=matches[0], a=p.address||{}, preferences=savedPreferenceValues(p.preferences);
  return {journeyId:context.journeyId,propertyId:p.id,revision:String(context.revision),name:p.name||'',
    street:a.street||'',unit:a.unit||'',city:a.city||'',region:a.region||'',postalCode:a.postalCode||'',country:a.country||'',
    listingUrl:p.listingUrl||'',targetLaunchDate:p.targetLaunchDate||'',
    status:p.status==='live'?'Live':p.status==='pre_launch'?'Not live yet':'',
    ...preferences,
    // Confirmation is never pre-checked: the client must explicitly review.
    confirmation:''};
}
export function hydrateNativeControls(document, context, propertyId) {
  const values=propertyValues(context,propertyId);
  for(const [key,value] of Object.entries(values)) {
    const id=FIELDS[key];
    if(RADIO_FIELDS.has(key)){
      const radios=Array.from(document.querySelectorAll('input[type="radio"]')).filter(el=>el.id.includes('_'+id+'_'));
      if(!radios.length)throw Error('Native control missing: '+key);
      for(const el of radios){el.checked=value!==''&&el.value===value;if(el.checked)el.dispatchEvent(new Event('change',{bubbles:true}));}
    }else{
      const el=document.getElementById(id);
      if(!el) throw Error('Native control missing: '+key);
      const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set;
      if(setter)setter.call(el,value);else el.value=value;
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  return values;
}
export async function fetchContext(token,fetcher=fetch){
  if(typeof token!=='string'||token.length<20)throw Error('Missing onboarding capability');
  const result=await fetcher(CONTEXT_URL,{method:'POST',headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
  if(!result.ok)throw Error('Onboarding context unavailable');
  return result.json();
}
// Intentionally no auto-submit, interception, native object write, or installed script.
// Bind only after genuine draft testing proves event persistence and host submit behavior.

export const SAVE_URL='https://hub.revfactor.io/api/public/highlevel/onboarding-v1/save';
const GOALS={'Increase revenue':'revenue','Improve occupancy':'occupancy','Balance revenue and occupancy':'balanced','I need guidance':'guidance'};
export function normalizePreferences(values){
  const goal=GOALS[values.goal];if(!goal)throw Error('Choose a property goal');
  const mode={'No firm restrictions':'none','I have firm restrictions':'specified','I need guidance':'guidance'}[values.restrictionMode];
  if(!mode)throw Error('Choose restrictions or guidance');
  const money=(value,label)=>{if(value===''||value==null)throw Error(label+' is missing');const n=Number(value);if(!Number.isFinite(n)||n<0||n>1000000)throw Error(label+' is invalid');return n;};
  const nonblank=(v)=>v!==''&&v!==null&&v!==undefined;
  let minimumNightly={mode},minimumStay={mode};
  if(mode==='specified'){
    minimumNightly=nonblank(values.minimumNightly)?{mode:'specified',value:money(values.minimumNightly,'Minimum nightly price')}:{mode:'none'};
    if(nonblank(values.minimumStay)){
      const nights=Number(values.minimumStay);if(!Number.isInteger(nights)||nights<1||nights>365)throw Error('Minimum stay is invalid');
      minimumStay={mode:'specified',nights};
    }else minimumStay={mode:'none'};
  }else if([values.minimumNightly,values.minimumStay].some(nonblank)){
    throw Error('Confirm firm restrictions before saving the entered limits');
  }
  let cleaningFee;
  if(values.cleaningFeeMode==='I need guidance'){
    if(nonblank(values.cleaningFee))throw Error('Choose known cleaning fee to retain the entered amount');
    cleaningFee={mode:'guidance'};
  }else if(values.cleaningFeeMode==='I know the cleaning fee')cleaningFee={mode:'specified',value:money(values.cleaningFee,'Cleaning fee')};
  else throw Error('Choose a cleaning fee or guidance');
  return {goal,minimumNightly,minimumStay,cleaningFee,operatingConstraints:String(values.operatingConstraints||'').trim()};
}
export function preferencesCommand(context,propertyIds,values,eventId){
  if(!propertyIds.length||new Set(propertyIds).size!==propertyIds.length)throw Error('Choose distinct properties');
  for(const id of propertyIds)propertyValues(context,id);
  return {action:'preferences',journeyId:context.journeyId,eventId,expectedRevision:context.revision,propertyIds,preferences:normalizePreferences(values)};
}
export async function saveCommand(token,command,fetcher=fetch){
  if(typeof token!=='string'||token.length<20)throw Error('Missing onboarding capability');
  if(!['property','preferences','account','submit'].includes(command.action)||!Number.isInteger(command.expectedRevision)||!command.eventId)throw Error('Invalid save action');
  const result=await fetcher(SAVE_URL,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
  if(result.status===409)throw Error('This onboarding changed elsewhere. Reload before saving again.');
  if(!result.ok)throw Error('Could not save onboarding. Your entered answers remain on this page.');
  return result.json();
}
export function takeFragmentContext(location,history){
  const params=new URLSearchParams(location.hash.slice(1));
  const token=params.get('token'),propertyId=params.get('propertyId');
  // Erase the fragment once loaded; retain token in memory only, never localStorage/logs.
  history.replaceState(null,'',location.pathname+location.search);
  if(!token||!propertyId)throw Error('Open the onboarding link sent to you');
  return {token,propertyId};
}

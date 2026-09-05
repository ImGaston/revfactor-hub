// Presentation only. Accepted server context owns progress; this module never saves.
export const PRESENTATION_VERSION='rf.native.design.1';
export function onboardingProgress(context,kind,finalSlide=false){
 const stage=context?.stage;
 const admitted=['onboarding','submitted','portal_invited','portal_active'].includes(stage);
 const submitted=['submitted','portal_invited','portal_active'].includes(stage);
 const propertyDone=admitted&&context.properties?.length>0&&!context.missing.some(key=>key.startsWith('property:'));
 const current=submitted?4:kind==='account'?(finalSlide?3:2):1;
 return [
  {label:'Agreement & payment',detail:'Your service, confirmed',state:admitted?'complete':'pending'},
  {label:'Your properties',detail:'Review the details we know',state:admitted&&current===1?'current':propertyDone?'complete':'pending'},
  {label:'Connect your tools',detail:'Tell us where you need help',state:admitted&&current===2?'current':admitted&&context.software?'complete':'pending'},
  {label:'Final review',detail:'Check everything, then submit',state:submitted?'complete':admitted&&current===3?'current':'pending'},
  {label:'Your portal',detail:stage==='portal_active'?'Your workspace is ready':'Your next stop is Assembly',state:stage==='portal_active'?'complete':submitted?'current':'pending'}
 ];
}
export function mountOnboardingPresentation(win,root,config,panel){
 const doc=win.document;
 root.classList.add('rf-onboarding-shell');
 doc.documentElement.classList.add('rf-onboarding-page');
 root.dataset.rfPresentation=PRESENTATION_VERSION;
 const aside=doc.createElement('aside');aside.className='rf-onboarding-sidebar';aside.setAttribute('aria-label','Your onboarding progress');
 aside.innerHTML='<div class="rf-sidebar-content"><div class="rf-brand"><span class="rf-brand-mark" aria-hidden="true">R<span>F</span></span><span>RevFactor<span class="rf-brand-caption">CLIENT ONBOARDING</span></span></div><div class="rf-sidebar-intro"><span class="rf-eyebrow">LET’S GET YOU SET UP</span><h2>A clear path<br>to your next chapter.</h2><p>Your properties. Your goals.<br>We’ll take it from here, together.</p></div><p class="rf-mobile-progress"></p><ol class="rf-onboarding-steps"></ol><details class="rf-onboarding-help"><summary>Need a hand?<span aria-hidden="true">↗</span></summary><p>Choose <strong>Need help</strong> when reviewing your tools and save your answers. Your team will see it after you submit.</p><p>For a property correction or a problem that stops you, reply to your original onboarding message.</p><p class="rf-help-resume">To return later, reopen your original link. Only saved answers are restored.</p></details><p class="rf-sidebar-footer">A little setup. A stronger start.</p></div>';
 root.prepend(aside);
 const kicker=doc.createElement('p');kicker.className='rf-panel-eyebrow';kicker.textContent='YOUR REVFACTOR WORKSPACE';panel.prepend(kicker);
 const steps=aside.querySelector('ol'),mobile=aside.querySelector('.rf-mobile-progress');
 let last='';
 const sync=context=>{
  root.dataset.rfContext=context?'loaded':'missing';
  const activeSlide=root.querySelector('.ghl-question.ghl-page-current');
  const finalSlide=!!activeSlide&&!activeSlide.classList.contains('slide-no-1');
  const progress=onboardingProgress(context,config.kind,finalSlide);
  const heading=panel.querySelector('h1');
  const headingText=context?.stage==='submitted'?'Onboarding submitted':config.kind==='account'?(finalSlide?'Your final review':'Connect your tools'):'Review your property';
  if(heading&&heading.textContent!==headingText)heading.textContent=headingText;
  const key=JSON.stringify(progress);if(key===last)return;last=key;
  steps.replaceChildren();
  progress.forEach((step,index)=>{
   const li=doc.createElement('li');li.dataset.state=step.state;li.setAttribute('aria-label',step.label+' — '+{complete:'Complete',current:'In progress',pending:'Upcoming'}[step.state]);if(step.state==='current')li.setAttribute('aria-current','step');
   const number=doc.createElement('span');number.className='rf-step-number';number.setAttribute('aria-hidden','true');number.textContent=step.state==='complete'?'✓':String(index+1).padStart(2,'0');
   const copy=doc.createElement('span');copy.className='rf-step-copy';const label=doc.createElement('strong');label.textContent=step.label;const detail=doc.createElement('span');detail.textContent=step.detail;copy.append(label,detail);
   const state=doc.createElement('span');state.className='rf-step-state';state.textContent={complete:'Complete',current:'In progress',pending:'Upcoming'}[step.state];li.append(number,copy,state);steps.append(li);
  });
  const current=progress.findIndex(step=>step.state==='current');mobile.textContent=current<0?'Open your personal link to begin':`STEP ${current+1} OF 5 · ${progress[current].label}`;
 };
 sync(null);
 return {sync};
}

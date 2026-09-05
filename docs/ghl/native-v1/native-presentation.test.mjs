import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {onboardingProgress,mountOnboardingPresentation} from './native-presentation.mjs';
const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.RF_NATIVE_JSDOM_MODULE||'/tmp/rf-native-host-tests/node_modules/jsdom');
const context={stage:'onboarding',properties:[{id:'a'}],missing:['property:a:preferences'],software:null};
test('unloaded and prepayment journeys never display completed commercial steps',()=>{
 for(const value of [null,{...context,stage:'payment_pending'}])assert.ok(onboardingProgress(value,'property').every(step=>step.state==='pending'));
});
test('saved requirements govern completion; submission never asserts portal activation',()=>{
 let steps=onboardingProgress(context,'account');assert.equal(steps[0].state,'complete');assert.equal(steps[1].state,'pending');assert.equal(steps[2].state,'current');
 steps=onboardingProgress({...context,missing:[],software:{pms:'need_help'}},'account',true);assert.equal(steps[1].state,'complete');assert.equal(steps[2].state,'complete');assert.equal(steps[3].state,'current');
 steps=onboardingProgress({...context,stage:'submitted',missing:[]},'account');assert.equal(steps[3].state,'complete');assert.equal(steps[4].state,'current');
 assert.equal(onboardingProgress({...context,stage:'portal_active',missing:[]},'account')[4].state,'complete');
});
test('native slide changes update accessible progress without replacing the form or footer',()=>{
 const {window}=new JSDOM('<div class="ghl-form-wrap"><section id="rf-native-status"></section><form id="_builder-form"><section class="ghl-question ghl-page-current slide-no-1"><input name="pms"></section><section class="ghl-question slide-no-2"></section></form><div class="ghl-footer"><button class="ghl-submit-btn">Submit</button></div></div>');
 const doc=window.document,root=doc.querySelector('.ghl-form-wrap'),form=doc.querySelector('form'),footer=doc.querySelector('.ghl-footer');
 const ui=mountOnboardingPresentation(window,root,{kind:'account'},doc.querySelector('#rf-native-status'));
 ui.sync(context);assert.match(doc.querySelector('[aria-current="step"]').textContent,/Connect your tools/);
 doc.querySelector('.slide-no-1').classList.remove('ghl-page-current');doc.querySelector('.slide-no-2').classList.add('ghl-page-current');ui.sync(context);
 assert.match(doc.querySelector('[aria-current="step"]').textContent,/Final review/);assert.equal(form.parentElement,root);assert.equal(footer.parentElement,root);assert.equal(doc.querySelectorAll('input').length,1);
 const help=doc.querySelector('details');assert.ok(help.querySelector('summary'));assert.match(help.textContent,/original onboarding message/);assert.equal(help.querySelectorAll('a').length,0);
});

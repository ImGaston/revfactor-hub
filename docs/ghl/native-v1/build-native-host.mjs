import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validateHostConfig} from './native-host.mjs';
const directory=fileURLToPath(new URL('.',import.meta.url));
const apiOrigin=process.env.RF_NATIVE_REVIEWED_API_ORIGIN||'https://hub.revfactor.io';
// Deployment-time configuration only. URL/query/fragment cannot choose endpoints.
const brandMarkDataUrl='data:image/png;base64,'+(await readFile(directory+'assets/revfactor-mark-bone.png')).toString('base64');
const common={brandMarkDataUrl,apiOrigin,allowedApiOrigins:[apiOrigin],nativeOrigin:'https://links.revfactor.io',propertySurveyId:'VvcWqrwmq7wESZSfFBme',accountSurveyId:'CfTInIn60HazWmPD1Zf9'};
const files=['native-presentation.mjs','native-property-adapter.mjs','native-account-adapter.mjs','native-host.mjs'];
let source='';for(const file of files)source+=(await readFile(directory+file,'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\n';
await mkdir(directory+'dist',{recursive:true});
for(const kind of ['property','account']){
 const config=validateHostConfig({...common,kind});
 const guide=kind==='account'?'<section aria-label="Software setup guide"><h2>Connect your tools</h2><p>Use the invitation instructions provided by RevFactor, then mark each tool below. Choose <strong>Need help</strong> if you need instructions or get stuck. Our team will verify access with you.</p><p>Never enter passwords or access codes here. These account settings apply across your properties.</p></section>':'';
 const css=await readFile(directory+'native-presentation.css','utf8');
 const markup='<style>'+css+'</style>'+guide+'<section id="rf-native-status" aria-live="polite">Loading your saved onboarding details…</section>';
 const js='(function(){\n"use strict";\n'+source+'\nmountNativeHost('+JSON.stringify(config)+');\n})();';
 if(js.includes('</script'))throw Error('Unsafe script terminator in source');
 await writeFile(directory+'dist/'+kind+'-host.html',markup+'\n<script>\n'+js+'\n</script>\n');
}
console.log('Built native property and account HTML hosts for '+apiOrigin);

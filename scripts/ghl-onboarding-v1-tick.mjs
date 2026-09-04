/** External scheduler entry point. No LLM, deployment mutation or local secrets file.
 * Inject CRON_SECRET securely on the approved operations host and schedule at 5m.
 * The Hub feature flags remain authoritative; this runner cannot enable them.
 */
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('Missing CRON_SECRET');
  process.exit(1);
}
const paths=['/api/cron/ghl-onboarding-v1','/api/cron/granola-import'];
const results=await Promise.all(paths.map(async path=>{
 try {
  const response=await fetch(`https://hub.revfactor.io${path}`,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(280000),redirect:'error',cache:'no-store'});
  // Keep provider/customer state and secret values out of scheduler logs.
  return {path,status:response.status,ok:response.ok};
 }catch{return {path,status:'unreachable',ok:false};}
}));
console.log(JSON.stringify(results));
if(results.some(result=>!result.ok))process.exitCode=1;

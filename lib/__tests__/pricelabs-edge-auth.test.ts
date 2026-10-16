import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {describe,it,expect} from 'vitest';

describe('PriceLabs Edge service authorization',()=>{
 it('rejects absent, publishable and wrong keys before any provider or DB access; suppresses malformed input',async()=>{
  const source=readFileSync('supabase/functions/pricelabs_get_reservation_data/index.ts','utf8').replace(/^import .*;\s*/,'');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const secret='sb_secret_edge_test_only';
  let handle!:(request:Request)=>Promise<Response>;let calls=0;
  runInNewContext(code,{Deno:{env:{get:(name:string)=>name==='REVFACTOR_PRICELABS_SECRET_KEY'?secret:undefined},serve:(handler:typeof handle)=>{handle=handler;}},crypto:webcrypto,TextEncoder,Headers,Response,Date,URL,createClient:()=>{calls++;throw Error('Unexpected DB access');},fetch:()=>{calls++;throw Error('Unexpected provider access');}});
  for(const key of ['', 'sb_publishable_test_only','sb_secret_wrong_test_only']){
   const result=await handle(new Request('https://example.test',{headers:{apikey:key}}));expect(result.status).toBe(401);
  }
  expect((await handle(new Request('https://example.test',{headers:{apikey:secret}}))).status).toBe(405);
  const malformed=await handle(new Request('https://example.test',{method:'POST',headers:{apikey:secret},body:secret}));
  expect(malformed.status).toBe(400);expect(await malformed.text()).not.toContain(secret);expect(calls).toBe(0);
 });
});

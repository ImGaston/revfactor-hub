import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('.',import.meta.url),fixture=await readFile(new URL('native-browser-fixture.mjs',root),'utf8');
for(const kind of ['property','account']){
 let html=await readFile(new URL('dist/'+kind+'-host.html',root),'utf8');
 html=html.replace(/mountNativeHost\((\{[^\n]+\})\);\n\}\)\(\);/,fixture+'\nconst fixture=createNativeBrowserFixture();\nmountNativeHost($1,window,fixture.fetcher);\nfixture.watch();\n})();');
 await writeFile(new URL('dist/'+kind+'-fixture.html',root),html);
}
console.log('Built temporary no-network native fixtures. Never ship these as production hosts.');

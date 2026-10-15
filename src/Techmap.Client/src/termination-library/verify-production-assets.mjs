// Run against the actual .NET host, not a Vite development server.
// node verify-production-assets.mjs <client-dist-directory> <http-base-url>
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const [distArg,baseArg]=process.argv.slice(2);
assert(distArg&&baseArg,'Pass the production dist directory and running .NET base URL.');
const dist=resolve(distArg),base=new URL(baseArg.endsWith('/')?baseArg:baseArg+'/');
const manifest=JSON.parse(await readFile(fileURLToPath(new URL('./symbol-assets/manifest.json',import.meta.url)),'utf8'));
const names=new Set(manifest.assets.flatMap(a=>[...Object.values(a.views),...(a.colorOptions??[]).flatMap(c=>Object.values(c.views))]));
const emitted=await readdir(join(dist,'assets'));
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const name of names){
 const stem=name.replace(/\.svg$/,''),matches=emitted.filter(n=>n.startsWith(stem+'-')&&n.endsWith('.svg'));
 assert.equal(matches.length,1,`Expected one content-hashed /assets file for ${name}`);
 const filename=matches[0],response=await fetch(new URL('assets/'+filename,base)),type=response.headers.get('content-type')??'';
 assert.equal(response.status,200,filename);
 assert.match(type,/^image\/svg\+xml\b/i,`${filename} returned ${type}; HTTP 200 alone may be SPA fallback HTML.`);
 const actual=Buffer.from(await response.arrayBuffer()),expected=await readFile(join(dist,'assets',filename));
 assert.match(actual.toString('utf8'),/<svg\b/,filename);assert.equal(sha(actual),sha(expected),filename);
}
console.log(`PASS: ${names.size} content-hashed SVG over real HTTP at ${base}; image/svg+xml and exact bytes.`);

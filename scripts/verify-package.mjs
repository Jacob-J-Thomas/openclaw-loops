import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const evidenceDirectory=process.env.LOOPS_EVIDENCE_DIR??'evidence';
mkdirSync('.dev-profile',{recursive:true});mkdirSync(evidenceDirectory,{recursive:true});
const packed=JSON.parse(execFileSync('npm',['pack','--cache','.dev-profile/npm-cache','--json'],{encoding:'utf8'}))[0];
writeFileSync(`${evidenceDirectory}/package.json`,JSON.stringify(packed,null,2)+'\n');
const directory=mkdtempSync(resolve('.dev-profile/package-test-'));
try{
  execFileSync('tar',['-xzf',packed.filename,'-C',directory]);
  const declared=JSON.parse(readFileSync('openclaw.plugin.json','utf8')).contracts.tools;
  const archived=JSON.parse(readFileSync(resolve(directory,'package/openclaw.plugin.json'),'utf8')).contracts.tools;
  assert.ok(Array.isArray(declared)&&declared.length>0,'The built manifest must declare the registered v2 tools.');
  assert.deepEqual(archived,declared,'The package must retain the built v2 tool declarations.');
  execFileSync('node_modules/.bin/vitest',['run','test/adapters.test.ts','--reporter=json',`--outputFile=${evidenceDirectory}/package-tests.json`],{stdio:'inherit',env:{...process.env,LOOPS_TEST_PLUGIN:pathToFileURL(`${directory}/package/dist/index.js`).href}});
}finally{rmSync(directory,{recursive:true,force:true});}
console.log(`Verified packaged command and tool adapters: ${packed.filename}`);

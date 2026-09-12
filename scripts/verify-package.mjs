import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const evidenceDirectory=process.env.LOOPS_EVIDENCE_DIR??'evidence';
mkdirSync('.dev-profile',{recursive:true});mkdirSync(evidenceDirectory,{recursive:true});
const packed=JSON.parse(execFileSync('npm',['pack','--cache','.dev-profile/npm-cache','--json'],{encoding:'utf8'}))[0];
writeFileSync(`${evidenceDirectory}/package.json`,JSON.stringify(packed,null,2)+'\n');
const directory=mkdtempSync(resolve('.dev-profile/package-test-'));
try{
  execFileSync('tar',['-xzf',packed.filename,'-C',directory]);
  execFileSync('node_modules/.bin/vitest',['run','test/adapters.test.ts','--reporter=json',`--outputFile=${evidenceDirectory}/package-tests.json`],{stdio:'inherit',env:{...process.env,LOOPS_TEST_PLUGIN:pathToFileURL(`${directory}/package/dist/index.js`).href}});
}finally{rmSync(directory,{recursive:true,force:true});}
console.log(`Verified packaged command and tool adapters: ${packed.filename}`);

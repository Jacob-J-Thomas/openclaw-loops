import {afterEach,describe,expect,it} from 'vitest';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {ArtifactCustody} from '../src/artifact-custody.js';

const roots:string[]=[],children:ChildProcess[]=[];
const owner={agentId:'agent',sessionKey:'session',sessionId:'generation'};
const helper=resolve('test/helpers/artifact-custody-lock-child.mjs');
afterEach(async()=>{
  for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null)await killed(child);
  for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});
});

async function compiledCore(){
  const root=mkdtempSync(join(tmpdir(),'loops-custody-process-'));roots.push(root);
  const modulePath=join(root,'artifact-custody.mjs');
  await build({entryPoints:['src/artifact-custody.ts'],outfile:modulePath,bundle:true,platform:'node',format:'esm',target:'node24'});
  const custodyRoot=join(root,'store');mkdirSync(custodyRoot);
  return {root:custodyRoot,modulePath};
}
function childResult(modulePath:string,root:string,mode:string,id=''){
  return JSON.parse(execFileSync(process.execPath,[helper,modulePath,root,mode,id],{encoding:'utf8',timeout:5000}).trim());
}
async function held(child:ChildProcess){
  await new Promise<void>((done,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('Child did not acquire custody lease.')),5000);
    child.stdout?.on('data',(chunk:Buffer)=>{output+=chunk.toString();if(output.includes('HELD\n')){clearTimeout(timer);done();}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Custody owner exited before hold.'));});
  });
}
async function killed(child:ChildProcess){
  await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(Error('SIGKILL did not stop custody owner.')),5000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill('SIGKILL');});
}

describe('artifact custody cross-process lease recovery',()=>{
  it('excludes a competitor while held, releases after SIGKILL, and lets a fresh process inspect exact evidence',async()=>{
    const {root,modulePath}=await compiledCore(),store=new ArtifactCustody(root);
    const ref=store.put(owner,{runId:'run',nodeId:'artifact'},Uint8Array.from([1,2,3]),'application/octet-stream');
    const holder=spawn(process.execPath,[helper,modulePath,root,'hold'],{stdio:['ignore','pipe','pipe']});children.push(holder);
    await held(holder);
    expect(childResult(modulePath,root,'probe')).toEqual({status:'blocked',code:'LOOPS_ARTIFACT_BUSY'});
    expect(()=>store.inspectRecovery(owner,[ref.id])).toThrow(/owned by another operation/i);
    await killed(holder);
    const recoveredHolder=spawn(process.execPath,[helper,modulePath,root,'hold'],{stdio:['ignore','pipe','pipe']});children.push(recoveredHolder);
    await held(recoveredHolder);
    expect(childResult(modulePath,root,'probe')).toEqual({status:'blocked',code:'LOOPS_ARTIFACT_BUSY'});
    await killed(recoveredHolder);
    expect(childResult(modulePath,root,'inspect',ref.id)).toEqual({status:'inspected',readback:[{id:ref.id,status:'published',reference:ref}],total:1});
    expect(childResult(modulePath,root,'probe')).toEqual({status:'free'});
  },15000);
});

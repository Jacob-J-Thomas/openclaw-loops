import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {appendFileSync,copyFileSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Engine,type Actor,type Run} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {examples} from '../src/examples.js';
import type {Definition} from '../src/graph.js';

let bundleDirectory:string;
const cleanups:Array<()=>void|Promise<void>>=[];
const actor:Actor={agentId:'main',sessionKey:'agent:main:crash-matrix',sessionId:'crash-fixture',source:'tool',human:false,check:()=>{}};
beforeAll(async()=>{
  bundleDirectory=mkdtempSync(join(tmpdir(),'loops-crash-code-'));
  await build({stdin:{contents:"export {SqliteStorage} from './src/storage.ts'; export {Engine} from './src/engine.ts';",resolveDir:resolve('.')},outfile:join(bundleDirectory,'engine.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
  copyFileSync('src/storage-worker.mjs',join(bundleDirectory,'storage-worker.mjs'));
});
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
afterAll(()=>rmSync(bundleDirectory,{recursive:true,force:true}));
function definition(scenario:string):Definition{
  const d:Definition={...structuredClone(examples[0]),schemaVersion:2,id:'crash-fixture',slug:'crash-fixture',nodes:[{id:'input',kind:'input',label:'Input'},{id:'infer',kind:'inference',label:'Infer',prompt:'{{input.text}}',output:'text'},{id:'return',kind:'return',label:'Return',value:'{{nodes.infer.text}}'}],edges:[{id:'a',source:'input',target:'infer',port:'next'},{id:'b',source:'infer',target:'return',port:'next'}]};
  if(scenario.startsWith('wait')){
    d.nodes.push({id:'wait',kind:'wait',label:'Wait',message:'Continue the synthetic fixture.'});
    d.edges[1].target='wait';d.edges.push({id:'c',source:'wait',target:'return',port:'next'});
  }else if(scenario.startsWith('review')){
    d.nodes.push({id:'review',kind:'review',label:'Review',proposal:'Review the synthetic fixture.'},{id:'reject',kind:'fail',label:'Reject',reason:'Rejected.'});
    d.edges[1].target='review';d.edges.push({id:'c',source:'review',target:'return',port:'approve'},{id:'d',source:'review',target:'reject',port:'reject'});
  }
  return d;
}
const cases=[
  {scenario:'admission',state:'interrupted',uncertain:false,effects:0,recovery:'checkpoint'},
  {scenario:'before-inference',state:'interrupted',uncertain:false,effects:0,recovery:'checkpoint'},
  {scenario:'inference-start',state:'interrupted',uncertain:true,effects:0,recovery:'retry-node'},
  {scenario:'host-completed',state:'interrupted',uncertain:true,effects:1,recovery:'retry-node'},
  {scenario:'inference-committed',state:'interrupted',uncertain:false,effects:1,recovery:'checkpoint'},
  {scenario:'completed',state:'completed',uncertain:false,effects:1,recovery:'none'},
  {scenario:'waiting',state:'waiting',uncertain:false,effects:1,recovery:'resume'},
  {scenario:'wait-resumed',state:'interrupted',uncertain:false,effects:1,recovery:'checkpoint'},
  {scenario:'review',state:'review',uncertain:false,effects:1,recovery:'review'},
  {scenario:'review-approved',state:'interrupted',uncertain:false,effects:1,recovery:'checkpoint'},
  {scenario:'queued',state:'interrupted',uncertain:false,effects:1,recovery:'checkpoint'},
  {scenario:'cancelled-settling',state:'cancelled',uncertain:true,effects:1,recovery:'retry-node'},
] as const;

describe('SIGKILL at committed execution checkpoints',()=>{
  it.each(cases)('$scenario preserves admission and does not replay effects on restart',async test=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-crash-state-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
    const file=join(directory,'loops.sqlite'),ready=join(directory,'ready.json'),effects=join(directory,'effects.txt'),definitionFile=join(directory,'definition.json');
    const d=definition(test.scenario);writeFileSync(definitionFile,JSON.stringify(d));
    const child=spawn(process.execPath,[resolve('test/helpers/engine-crash.mjs'),file,join(bundleDirectory,'engine.mjs'),test.scenario,ready,effects,definitionFile],{stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-3000);});
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
    await vi.waitFor(()=>{expect(child.exitCode,stderr).toBeNull();expect(existsSync(ready),stderr).toBe(true);},{timeout:5000});
    const checkpoint=JSON.parse(readFileSync(ready,'utf8')) as {id:string;run:Run};
    child.kill('SIGKILL');await exited;
    const effectCount=()=>existsSync(effects)?readFileSync(effects,'utf8').trim().split('\n').filter(Boolean).length:0;
    expect(effectCount()).toBe(test.effects);
    const store=new SqliteStorage(file);cleanups.push(()=>store.close());
    const host={check:()=>{},modelInfo:async()=>({}),complete:vi.fn(async()=>{appendFileSync(effects,'explicit recovery inference\n');return {text:'explicit recovery result'};})};
    const engine=new Engine(store,host);cleanups.push(()=>engine.close());
    const restored=engine.status(actor,checkpoint.id);
    expect(restored.state).toBe(test.state);expect(Boolean(restored.uncertainty)).toBe(test.uncertain);
    expect(restored.cleanupPending).not.toBe(true);
    expect(host.complete).not.toHaveBeenCalled();expect(effectCount()).toBe(test.effects);
    const input={text:test.scenario==='queued'?'queued input':'synthetic input'},request=test.scenario==='queued'?'queued-request':'crash-request';
    expect(await engine.test(actor,d,input,request)).toEqual(restored);
    expect(host.complete).not.toHaveBeenCalled();
    let completed:Run=restored;
    if(test.recovery==='checkpoint'||test.recovery==='retry-node'){
      if(test.uncertain)await expect(engine.retry(actor,restored.id,'checkpoint','refuse-uncertain-replay')).rejects.toThrow(/not a committed checkpoint/);
      completed=await engine.retry(actor,restored.id,test.recovery,'explicit-recovery');expect(completed.parentRunId).toBe(restored.id);
    }else if(test.recovery==='resume')completed=await engine.resume(actor,restored.id);
    else if(test.recovery==='review'){
      await expect(engine.resume(actor,restored.id)).rejects.toThrow(/human review/);
      await expect(engine.review(actor,restored.id,'approve')).rejects.toThrow(/authenticated human/);
      completed=await engine.review({...actor,source:'session-action',human:true,requester:'fixture-human'},restored.id,'approve');
    }
    expect(completed.state).toBe('completed');
    const needsInference=['admission','before-inference','inference-start','host-completed','queued','cancelled-settling'].includes(test.scenario);
    expect(host.complete).toHaveBeenCalledTimes(needsInference?1:0);expect(effectCount()).toBe(test.effects+(needsInference?1:0));
    expect(completed.result).toBe(needsInference?'explicit recovery result':'original committed result');
    if(test.scenario.startsWith('review'))expect(completed.review).toMatchObject({decision:'approve',requester:'fixture-human'});
    expect(store.integrity()).toEqual([{integrity_check:'ok'}]);
  },10000);
});

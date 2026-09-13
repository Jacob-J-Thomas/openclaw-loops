import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {copyFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import type {EngineService} from '../src/engine-service.js';
import type {Actor,HostCapabilities,Run} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {requestError} from '../src/errors.js';

const buildDir=mkdtempSync(join(tmpdir(),'loops-service-build-'));
let Service:typeof EngineService;
beforeAll(async()=>{
  await build({entryPoints:['src/engine-service.ts'],outfile:join(buildDir,'src/engine-service.mjs'),bundle:true,platform:'node',format:'esm'});
  await build({entryPoints:['src/engine-service-worker.ts'],outfile:join(buildDir,'dist/engine-service-worker.js'),bundle:true,platform:'node',format:'esm'});
  copyFileSync('src/storage-worker.mjs',join(buildDir,'dist/storage-worker.mjs'));
  Service=(await import(/* @vite-ignore */ pathToFileURL(join(buildDir,'src/engine-service.mjs')).href)).EngineService;
},30_000);
afterAll(()=>rmSync(buildDir,{recursive:true,force:true}));
const services:EngineService[]=[],dirs:string[]=[],workers:Worker[]=[];
afterEach(async()=>{
  await Promise.allSettled(services.splice(0).map(service=>service.close()));
  await Promise.allSettled(workers.splice(0).map(worker=>worker.terminate()));
  for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});
});
const actor=(extra:Partial<Actor>={}):Actor=>({agentId:'main',sessionKey:'agent:main:service-test',sessionId:'service-session',source:'tool',human:false,model:'fixture/original',check:()=>{},...extra});
function setup(options:ConstructorParameters<typeof EngineService>[0]|undefined=undefined,hostOverrides:Partial<HostCapabilities>={}){
  const root=mkdtempSync(join(tmpdir(),'loops-service-'));dirs.push(root);
  const file=options?.file??join(root,'loops.sqlite');
  const complete=vi.fn<HostCapabilities['complete']>(async a=>({text:'Synthetic host response.',model:a.model??'unspecified'}));
  const host:HostCapabilities={check:a=>a.check(),complete,modelInfo:async a=>({provider:'fixture',model:a.model??'unspecified'}),...hostOverrides};
  const service=new Service({file,...options},host);services.push(service);
  return {service,file,complete,host};
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function status(service:EngineService,id:string,state:Run['state']){
  await vi.waitFor(async()=>expect((await service.invoke('status',actor(),id)).state).toBe(state),{timeout:5000,interval:20});
  return service.invoke('status',actor(),id);
}
async function blockWriter(file:string,duration=350){
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.file);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');setTimeout(()=>{db.exec('COMMIT');db.close();},workerData.duration);`,{eval:true,execArgv:[],workerData:{file,duration}});workers.push(worker);
  await new Promise<void>((resolve,reject)=>{worker.once('message',()=>resolve());worker.once('error',reject);});return worker;
}
const references=(service:EngineService)=>(service as unknown as {actors:Map<string,unknown>}).actors.size;

describe('asynchronous committed-state service (real SQLite, synthetic host)',()=>{
  it('keeps the Gateway thread responsive during a blocked commit and serializes competing edits and reads',async()=>{
    const {service,file}=setup();await service.ready;await blockWriter(file);
    let ticks=0,acknowledged=false;const timer=setInterval(()=>ticks++,10),started=performance.now();
    try{
      const first=service.invoke('edit',actor(),'summarize-text',1,{name:'Committed edit'}).then(result=>{acknowledged=true;return result;});
      const competing=service.invoke('edit',actor(),'summarize-text',1,{name:'Conflicting edit'});
      const results=Promise.allSettled([first,competing]);
      const read=service.invoke('load',actor(),'summarize-text');
      await sleep(50);expect(ticks).toBeGreaterThan(1);expect(acknowledged).toBe(false);
      const [saved,conflict]=await results;
      expect(performance.now()-started).toBeGreaterThan(250);expect(ticks).toBeGreaterThan(10);
      expect(saved).toMatchObject({status:'fulfilled',value:{record:{definition:{revision:2,name:'Committed edit'}}}});
      expect(conflict).toMatchObject({status:'rejected',reason:{detail:{code:'LOOPS_REVISION_CONFLICT'}}});
      expect((await read).definition).toMatchObject({revision:2,name:'Committed edit'});
    }finally{clearInterval(timer);}
  });
  it('returns the last committed revision after a rejected write and accepts an explicit retry',async()=>{
    const {service,file}=setup();await service.ready;const db=new DatabaseSync(file);
    try{
      db.exec("CREATE TRIGGER reject_edit BEFORE INSERT ON metadata BEGIN SELECT RAISE(ABORT,'Synthetic rejected commit'); END;");
      const failed=service.invoke('edit',actor(),'summarize-text',1,{name:'Uncommitted'});
      const read=service.invoke('load',actor(),'summarize-text');
      await expect(failed).rejects.toMatchObject({detail:{code:'LOOPS_STORAGE_CONFLICT'},cause:{message:'Synthetic rejected commit'}});
      expect((await read).definition).toMatchObject({revision:1,name:examples[0].name});
      db.exec('DROP TRIGGER reject_edit');
      expect(await service.invoke('edit',actor(),'summarize-text',1,{name:'Retry'})).toMatchObject({record:{definition:{revision:2}}});
    }finally{db.close();}
  });
  it('dispatches host inference only after its attempt is committed and forwards structured host errors',async()=>{
    const {service,file,complete}=setup();await service.ready;
    await service.invoke('enable',actor(),'summarize-text',1,true);
    const db=new DatabaseSync(file);
    try{
      db.exec("CREATE TRIGGER reject_attempt BEFORE INSERT ON attempts WHEN NEW.node_id='summary' BEGIN SELECT RAISE(ABORT,'Synthetic attempt failure'); END;");
      expect(await service.invoke('run',actor(),'summarize-text',{text:'Failed commit'},'failed-attempt')).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_STORAGE_CONFLICT'}});
      expect(complete).not.toHaveBeenCalled();db.exec('DROP TRIGGER reject_attempt');
      complete.mockImplementation(async()=>{
        expect(db.prepare("SELECT state FROM attempts WHERE node_id='summary'").all()).toEqual([{state:'running'}]);
        throw Object.assign(new Error('Secret provider response must not reach history.'),{status:429,code:'rate_limit_exceeded'});
      });
      const run=await service.invoke('run',actor(),'summarize-text',{text:'Committed attempt'},'committed-attempt');
      expect(run).toMatchObject({state:'failed',errorDetail:{code:'HOST_RATE_LIMITED',nodeId:'summary',model:'fixture/original',retryable:true}});
      expect(JSON.stringify(run)).not.toContain('Secret provider response');expect(complete).toHaveBeenCalledOnce();
    }finally{db.close();}
  });
  it('keeps distinct invocation settings and bound host functions isolated across concurrent runs',async()=>{
    const seen:Actor[]=[],root=mkdtempSync(join(tmpdir(),'loops-service-models-'));dirs.push(root);
    const {service}=setup({file:join(root,'loops.sqlite'),concurrency:2},{complete:async(a,_p,_s,_t,settings)=>{seen.push(a);await sleep(50);return {text:a.model??'',settings:settings?.advanced??{}};}});
    await service.ready;
    const a=actor({model:'fixture/one',reasoning:'low',authProfileId:'profile-one',complete:vi.fn()}),b=actor({model:'fixture/two',reasoning:'high',authProfileId:'profile-two',complete:vi.fn()});
    const first=structuredClone(examples[0]),second=structuredClone(examples[0]);first.revision=second.revision=1;
    const node=first.nodes.find(n=>n.kind==='inference');if(node?.kind==='inference')node.advanced={temperature:0};
    const [one,two]=await Promise.all([service.invoke('test',a,first,{text:'One'},'one'),service.invoke('test',b,second,{text:'Two'},'two')]);
    expect(one.result).toBe('fixture/one');expect(two.result).toBe('fixture/two');
    expect(seen.map(a=>[a.model,a.reasoning,a.authProfileId,a.complete])).toEqual([[a.model,a.reasoning,a.authProfileId,a.complete],[b.model,b.reasoning,b.authProfileId,b.complete]]);
    expect(one.outputs.summary).toMatchObject({settings:{temperature:0}});expect(two.outputs.summary).toMatchObject({settings:{}});
    await vi.waitFor(()=>expect(references(service)).toBe(0));
  });
  it('retains queued authority until dispatch, observes permission revocation, and releases finished invocations',async()=>{
    let finish!:()=>void,permitted=true;
    const complete=vi.fn<HostCapabilities['complete']>(async()=>{await new Promise<void>(resolve=>{finish=resolve;});return {text:'First completion'};});
    const {service}=setup(undefined,{complete});
    await service.ready;await service.invoke('enable',actor(),'summarize-text',1,true);
    const first=service.invoke('run',actor(),'summarize-text',{text:'First'},'first');
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const revoked=actor({check:()=>{if(!permitted)throw requestError('Synthetic revoked invocation.','HOST_POLICY_DENIED');}});
    const queued=await service.invoke('run',revoked,'summarize-text',{text:'Queued'},'queued');expect(queued.state).toBe('queued');
    permitted=false;finish();await first;
    expect(await status(service,queued.id,'failed')).toMatchObject({errorDetail:{code:'HOST_POLICY_DENIED'}});
    expect(complete).toHaveBeenCalledOnce();await vi.waitFor(()=>expect(references(service)).toBe(0));
  });
  it('forwards cancellation while retaining physical capacity until the original host promise settles',async()=>{
    let finish!:()=>void,hostSignal:AbortSignal|undefined;
    const {service}=setup(undefined,{complete:async(_a,_p,signal)=>{hostSignal=signal;await new Promise<void>(resolve=>{finish=resolve;});return {text:'Late response'};}});
    await service.ready;await service.invoke('enable',actor(),'summarize-text',1,true);
    const running=service.invoke('run',actor(),'summarize-text',{text:'Cancel'},'cancel');
    await vi.waitFor(()=>expect(hostSignal).toBeDefined());
    const id=(await service.invoke('runs',actor()))[0].id;
    expect(await service.invoke('cancel',actor(),id)).toMatchObject({state:'cancelled',cleanupPending:true});
    await vi.waitFor(()=>expect(hostSignal!.aborted).toBe(true));await running;
    const queued=await service.invoke('run',actor(),'summarize-text',{text:'Queued'},'after-cancel');expect(queued.state).toBe('queued');
    await service.invoke('cancel',actor(),queued.id);
    expect(references(service)).toBeGreaterThan(0);finish();
    await vi.waitFor(async()=>{expect((await service.invoke('status',actor(),id)).cleanupPending).not.toBe(true);expect(references(service)).toBe(0);});
  });
  it('propagates the originating request signal after returning a running handle',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-service-abort-'));dirs.push(root);
    let hostSignal:AbortSignal|undefined;
    const {service}=setup({file:join(root,'loops.sqlite'),replyTimeoutMs:1},{complete:async(_a,_p,signal)=>{hostSignal=signal;await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {text:'unreachable'};}});
    await service.ready;await service.invoke('enable',actor(),'summarize-text',1,true);
    const controller=new AbortController();const run=await service.invoke('run',actor({signal:controller.signal}),'summarize-text',{text:'Source signal'},'signal');
    expect(run.state).toBe('running');await vi.waitFor(()=>expect(hostSignal).toBeDefined());controller.abort(new Error('Original host request cancelled.'));
    await vi.waitFor(()=>expect(hostSignal!.aborted).toBe(true));await status(service,run.id,'failed');
    await vi.waitFor(()=>expect(references(service)).toBe(0));
  });
  it('reopens pinned waits and outputs and excludes duplicate storage owners',async()=>{
    const {service,file}=setup();await service.ready;await service.invoke('enable',actor(),'read-pause-continue',1,true);
    const waiting=await service.invoke('run',actor(),'read-pause-continue',{text:'Persist'},'wait');expect(waiting.state).toBe('waiting');
    await service.invoke('edit',actor(),'read-pause-continue',1,{name:'New publication'});
    const competitor=setup({file}).service;await expect(competitor.ready).rejects.toThrow('already open');await expect(competitor.close()).rejects.toThrow('already open');
    expect(await service.invoke('status',actor(),waiting.id)).toMatchObject({state:'waiting',definition:{revision:1},outputs:waiting.outputs});
    await service.close();expect(existsSync(file+'.lock')).toBe(false);
    const reopened=setup({file}).service;await reopened.ready;
    expect(await reopened.invoke('resume',actor(),waiting.id)).toMatchObject({state:'completed',definition:{revision:1},result:'Synthetic host response.'});
    await reopened.close();const final=setup({file}).service;await final.ready;
    expect(await final.invoke('output',actor(),waiting.id)).toMatchObject({text:'Synthetic host response.',nextOffset:null});
    expect((await final.invoke('load',actor(),'read-pause-continue')).definition.revision).toBe(2);
  });
  it('joins the entire worker tree after a failed close and permits a new owner',async()=>{
    const {service,file}=setup();await service.ready;
    const post=Worker.prototype.postMessage;
    const spy=vi.spyOn(Worker.prototype,'postMessage').mockImplementation(function(this:Worker,message,transfers){return post.call(this,message.operation==='close'?{...message,operation:'injected-close-failure'}:message,transfers);});
    try{await expect(service.close()).rejects.toThrow('Unknown service operation.');}finally{spy.mockRestore();}
    const reopened=setup({file}).service;await reopened.ready;
    expect((await reopened.invoke('library',actor())).length).toBe(3);await reopened.close();expect(existsSync(file+'.lock')).toBe(false);
  });
  it('rejects startup on an inaccessible path without retaining Gateway requests or an owner',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-service-startup-'));dirs.push(root);mkdirSync(join(root,'database'));
    const {service}=setup({file:join(root,'database')});await expect(service.ready).rejects.toBeDefined();
    await expect(service.close()).rejects.toBeDefined();expect(references(service)).toBe(0);
  });
});

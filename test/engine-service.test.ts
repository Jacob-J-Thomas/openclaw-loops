import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {copyFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {DocumentReference} from '../src/wire-contract.js';
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
  it.each([1,2,3])('bounds a mixed FIFO queue at configured capacity %i through cancellation and settlement races',async capacity=>{
    const root=mkdtempSync(join(tmpdir(),'loops-mixed-queue-'));dirs.push(root);
    type Call={prompt:string;signal:AbortSignal;finish:(reject?:boolean)=>void;settled:boolean};
    const calls:Call[]=[];let physical=0,maximum=0,permitted=true;
    const {service,file}=setup({file:join(root,'loops.sqlite'),concurrency:capacity,replyTimeoutMs:1},{complete:async(_actor,prompt,signal)=>{
      physical++;maximum=Math.max(maximum,physical);expect(physical).toBeLessThanOrEqual(capacity);
      try{return await new Promise<{text:string}>((resolve,reject)=>{const call:Call={prompt,signal,settled:false,finish:(failed=false)=>{
        if(call.settled)return;call.settled=true;if(failed)reject(Object.assign(new Error('Synthetic provider rejection'),{status:429}));else resolve({text:prompt});
      }};calls.push(call);});}finally{physical--;}
    }});
    const controller=new AbortController(),runs:Run[]=[];
    try{
      await service.ready;const definition=structuredClone(examples[0]);definition.revision=1;
      const inference=definition.nodes.find(node=>node.kind==='inference')!;if(inference.kind==='inference')inference.prompt='{{input.text}}';
      await service.invoke('save',actor(),definition,1,true);
      for(let i=0;i<capacity;i++)runs.push(await service.invoke('run',actor(),'summarize-text',{text:`active-${i}`},`active-${i}`));
      await vi.waitFor(()=>expect(calls).toHaveLength(capacity));
      const labels=['cancel-queued','ready-0','abort-queued','revoke-queued',...Array.from({length:capacity+1},(_,i)=>`ready-${i+1}`)];
      for(const label of labels){
        const origin=label==='abort-queued'?actor({signal:controller.signal}):label==='revoke-queued'?actor({check:()=>{if(!permitted)throw Object.assign(new Error('Synthetic queued revocation'),{status:403});}}):actor();
        const run=await service.invoke('run',origin,'summarize-text',{text:label},label);expect(run).toMatchObject({state:'queued',executions:0,trace:[]});runs.push(run);
      }
      const queued=Object.fromEntries(runs.slice(capacity).map(run=>[run.input.text as string,run]));
      expect(await service.invoke('cancel',actor(),queued['cancel-queued'].id)).toMatchObject({state:'cancelled',executions:0,trace:[]});
      controller.abort(new Error('Queued request aborted'));permitted=false;
      expect(await service.invoke('cancel',actor(),runs[0].id)).toMatchObject({state:'cancelled',cleanupPending:true});
      await vi.waitFor(()=>expect(calls[0].signal.aborted).toBe(true));
      expect(calls).toHaveLength(capacity);expect(physical).toBe(capacity);
      expect((await service.invoke('status',actor(),queued['ready-0'].id)).state).toBe('queued');
      const initial=[...calls];initial.forEach((call,i)=>call.finish(i===1));
      const expectedReady=labels.filter(label=>label.startsWith('ready-'));
      for(const label of expectedReady){
        await vi.waitFor(()=>expect(calls.some(call=>call.prompt===label)).toBe(true));
        calls.find(call=>call.prompt===label)!.finish();
        expect(await status(service,queued[label].id,'completed')).toMatchObject({result:label});
      }
      await vi.waitFor(()=>{expect(references(service)).toBe(0);expect(physical).toBe(0);});
      expect(maximum).toBe(capacity);expect(calls.map(call=>call.prompt)).toEqual([...Array.from({length:capacity},(_,i)=>`active-${i}`),...expectedReady]);
      expect(await service.invoke('status',actor(),queued['cancel-queued'].id)).toMatchObject({state:'cancelled',executions:0,trace:[]});
      for(const [label,code] of [['abort-queued','HOST_ABORTED'],['revoke-queued','HOST_POLICY_DENIED']])expect(await service.invoke('status',actor(),queued[label].id)).toMatchObject({state:'failed',executions:0,trace:[],errorDetail:{code}});
      const cancelled=await service.invoke('status',actor(),runs[0].id);expect(cancelled).toMatchObject({state:'cancelled',cleanupPending:false});expect(cancelled.result).toBeUndefined();expect(cancelled.outputs.summary).toBeUndefined();expect(cancelled.trace.some(node=>node.nodeId==='return')).toBe(false);
      if(capacity>1)expect(await service.invoke('status',actor(),runs[1].id)).toMatchObject({state:'failed',errorDetail:{code:'HOST_RATE_LIMITED'}});
      const committed=await Promise.all(runs.map(run=>service.invoke('status',actor(),run.id)));await service.close();
      const reopened=setup({file,concurrency:capacity}).service;await reopened.ready;
      expect(await Promise.all(runs.map(run=>reopened.invoke('status',actor(),run.id)))).toEqual(committed);expect(calls).toHaveLength(capacity+expectedReady.length);
    }finally{for(const call of calls)call.finish();}
  },30000);
  it.each(['resolve','reject'] as const)('holds capacity after timeout until the host promise can %s and excludes queue time from the next budget',async settlement=>{
    const root=mkdtempSync(join(tmpdir(),'loops-timeout-queue-'));dirs.push(root);
    const calls:Array<{signal:AbortSignal;timeout:number|undefined;finish:(reject?:boolean)=>void}>=[];let physical=0,maximum=0;
    const {service}=setup({file:join(root,'loops.sqlite'),replyTimeoutMs:1},{complete:async(_actor,prompt,signal,timeout)=>{
      physical++;maximum=Math.max(maximum,physical);
      try{return await new Promise<{text:string}>((resolve,reject)=>{calls.push({signal,timeout,finish:(failed=false)=>failed?reject(new Error('Late synthetic rejection')):resolve({text:prompt})});});}finally{physical--;}
    }});
    try{
      await service.ready;const definition=structuredClone(examples[0]);definition.revision=1;definition.limits.timeoutMs=1000;
      const inference=definition.nodes.find(node=>node.kind==='inference')!;if(inference.kind==='inference')inference.prompt='{{input.text}}';
      await service.invoke('save',actor(),definition,1,true);
      const first=await service.invoke('run',actor(),'summarize-text',{text:'Timed out'},'timeout');await vi.waitFor(()=>expect(calls).toHaveLength(1));
      const queued=await service.invoke('run',actor(),'summarize-text',{text:'Fresh active budget'},'queued');expect(queued.state).toBe('queued');
      const failed=await status(service,first.id,'failed');expect(failed).toMatchObject({cleanupPending:true,errorDetail:{code:'LOOPS_TIMEOUT'}});
      await vi.waitFor(()=>expect(calls[0].signal.aborted).toBe(true));await sleep(1100);
      expect(Date.now()-Date.parse(queued.createdAt)).toBeGreaterThan(1000);expect((await service.invoke('status',actor(),queued.id))).toMatchObject({state:'queued',executions:0,activeMs:0});
      expect(calls).toHaveLength(1);expect(physical).toBe(1);calls[0].finish(settlement==='reject');
      await vi.waitFor(()=>expect(calls).toHaveLength(2));expect(calls[1].signal.aborted).toBe(false);expect(calls[1].timeout).toBeGreaterThan(0);expect(calls[1].timeout).toBeLessThanOrEqual(1000);calls[1].finish();
      expect(await status(service,queued.id,'completed')).toMatchObject({result:'Fresh active budget'});
      await vi.waitFor(()=>{expect(references(service)).toBe(0);expect(physical).toBe(0);});expect(maximum).toBe(1);
      const after=await service.invoke('status',actor(),first.id);expect(after).toMatchObject({state:'failed',cleanupPending:false,errorDetail:failed.errorDetail,trace:failed.trace,outputs:failed.outputs});expect(after.result).toBeUndefined();expect(after.trace.some(node=>node.nodeId==='return')).toBe(false);
    }finally{for(const call of calls)call.finish();}
  },30000);
  it('keeps the Gateway responsive while an actual transport file read is blocked',async()=>{
    const {service,file}=setup();await service.ready;const a=actor(),value={result:'Transport evidence '.repeat(5000)};
    const hash=(text:string)=>createHash('sha256').update(text).digest('hex'),text=JSON.stringify(value),sha256=hash(text),owner=hash(JSON.stringify([a.agentId,a.sessionKey,a.sessionId])),documentId=hash(owner+sha256);
    const directory=join(file,'..','documents');mkdirSync(directory);const fifo=join(directory,`document-${documentId}.json`);execFileSync('mkfifo',[fifo]);
    const record=JSON.stringify({owner,sha256,text}),writer=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {writeFileSync}=require('node:fs');parentPort.postMessage('ready');parentPort.on('message',()=>setTimeout(()=>{writeFileSync(workerData.file,workerData.record);parentPort.close();},350));`,{eval:true,execArgv:[],workerData:{file:fifo,record}});workers.push(writer);
    await new Promise<void>((resolve,reject)=>{writer.once('message',()=>resolve());writer.once('error',reject);});
    let ticks=0,settled=false;const timer=setInterval(()=>ticks++,10),start=performance.now();
    try{
      writer.postMessage('release after delay');const pending=service.invoke('documentWrap',a,value).then(value=>{settled=true;return value;});
      await sleep(50);expect(settled).toBe(false);expect(ticks).toBeGreaterThan(1);
      expect(await pending).toMatchObject({kind:'loops-document',documentId,sha256});expect(performance.now()-start).toBeGreaterThan(250);expect(ticks).toBeGreaterThan(10);
    }finally{clearInterval(timer);rmSync(fifo);}
    writeFileSync(fifo,record);
    expect(await service.invoke('documentRead',a,documentId,0,10)).toMatchObject({documentId,sha256,text:text.slice(0,10),nextOffset:10});
  });
  it('keeps documents and partial uploads across service restart under the original conversation authority',async()=>{
    const {service,file,complete}=setup();await service.ready;const a=actor(),value={result:'Preserved Unicode 🙂 '.repeat(4000)};
    const reference=await service.invoke('documentWrap',a,value) as DocumentReference;
    expect(reference.kind).toBe('loops-document');await service.invoke('documentUpload',a,{uploadId:'resumable',offset:0,text:'{"value":"'});await service.close();
    await expect(service.invoke('documentUpload',a,{uploadId:'after-stop',offset:0,text:'{}'})).rejects.toMatchObject({detail:{code:'LOOPS_SERVICE_UNAVAILABLE'}});
    const reopened=setup({file}).service;await reopened.ready;
    for(const other of [actor({sessionId:'other'}),actor({agentId:'other'}),actor({sessionKey:'other'})])await expect(reopened.invoke('documentRead',other,reference.documentId)).rejects.toMatchObject({detail:{code:'LOOPS_DOCUMENT_NOT_FOUND'}});
    await expect(reopened.invoke('documentRead',actor({check:()=>{throw requestError('Revoked','HOST_POLICY_DENIED');}}),reference.documentId)).rejects.toMatchObject({detail:{code:'HOST_POLICY_DENIED'}});
    let text='',offset=0;while(true){const page=await reopened.invoke('documentRead',a,reference.documentId,offset);text+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
    expect(JSON.parse(text)).toEqual(value);expect(createHash('sha256').update(text).digest('hex')).toBe(reference.sha256);
    const full='{"value":"restored"}',finish={uploadId:'resumable',offset:10,text:'restored"}',complete:true,sha256:createHash('sha256').update(full).digest('hex')};
    const result=await reopened.invoke('documentUpload',a,finish);expect(await reopened.invoke('documentUpload',a,finish)).toEqual(result);expect(await reopened.invoke('documentResolve',a,result.reference!)).toEqual({value:'restored'});
    expect(complete).not.toHaveBeenCalled();
  });
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
  it('keeps a legacy account pin through resume and surfaces its host policy failure',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-service-legacy-account-'));dirs.push(root);const seen:Actor[]=[];
    const denied=async(a:Actor)=>{seen.push(a);throw Object.assign(new Error('Legacy account is denied by host policy.'),{code:'HOST_POLICY_DENIED',status:403});};
    const {service,file}=setup({file:join(root,'loops.sqlite')},{complete:denied});await service.ready;
    const definition={...structuredClone(examples[0]),revision:1,capabilities:['llm'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'wait',kind:'wait',label:'Wait',message:'Pause'},{id:'summary',kind:'inference',label:'Summary',prompt:'{{input.text}}',output:'text'},{id:'return',kind:'return',label:'Return',value:'{{nodes.summary.text}}'}],edges:[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'summary',port:'next'},{id:'c',source:'summary',target:'return',port:'next'}]};
    await service.invoke('save',actor(),definition,1,true);
    const parked=await service.invoke('run',actor({authProfileId:'legacy-profile'}),definition.slug,{text:'legacy'},'legacy');expect(parked.state).toBe('waiting');await service.close();
    const reopened=setup({file},{complete:denied}).service;await reopened.ready;
    const resumed=await reopened.invoke('resume',actor(),parked.id);
    expect(resumed).toMatchObject({state:'failed',errorDetail:{code:'HOST_POLICY_DENIED'}});
    expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({authProfileId:'legacy-profile'});
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

import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import type {Definition} from '../src/graph.js';
import type {MemoryRemovalPlan} from '../src/memory-core.js';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const actor:Actor={agentId:'main',sessionKey:'agent:main:memory-repair',sessionId:'memory-repair-session',source:'tool',human:false,check:()=>{}};
const host:HostCapabilities={check:()=>{},complete:async()=>({text:'unused'}),modelInfo:async()=>({})};
const scope=createHash('sha256').update(JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId])).digest('hex');
function authored(operation:'write'|'retention-apply'|'reset-apply',key='notes.fact'):Definition{
  const write=operation==='write';
  return {schemaVersion:3,id:'memory-repair',slug:'memory-repair',name:'Memory repair',description:'',revision:0,
    inputSchema:write?[]:[{name:'plan',label:'Plan',type:'json',required:true}],capabilities:[],limits:{maxExecutions:5,maxOutputBytes:8192},layout:{},
    nodes:[{id:'input',kind:'input',label:'Input'},{id:'effect',kind:'memory',label:'Effect',memory:{operation,key,...write?{value:{literalJson:'{"count":0}'}}:{plan:'{{input.plan}}'}}},{id:'return',kind:'return',label:'Return',value:write?'done':'{{nodes.effect.receipts}}'}],
    edges:[{id:'a',source:'input',target:'effect',port:'next'},{id:'b',source:'effect',target:'return',port:'next'}],
    memoryPolicy:{version:1,enabled:true,nodes:{effect:{readPrefixes:['notes'],writeScopes:write?[{prefix:'notes',schemaId:'fact',schemaVersion:1,retentionDays:30}]:[],forgetPrefixes:['notes']}}},
    memorySchemas:[{id:'fact',version:1,schema:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}}]};
}
describe('reviewed Memory removal and unpublished Test recovery',()=>{
  for(const [operation,previewMode,authoredPrefix,previewPrefix] of [
    ['retention-apply','reset-preview','notes','notes'],
    ['reset-apply','retention-preview','notes','notes'],
    ['retention-apply','retention-preview','notes.other','notes'],
    ['reset-apply','reset-preview','notes.other','notes'],
  ] as const)it(`rejects ${operation} with ${previewMode} for authored ${authoredPrefix} and supplied ${previewPrefix}`,async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-plan-review-'));roots.push(root);
    const file=join(root,'loops.sqlite'),store=new SqliteStorage(file),engine=new Engine(store,host);
    const seed=authored('write');engine.save(actor,seed,0,true);
    const first=await engine.run(actor,seed.slug,{},`seed-${operation}-${previewMode}-${authoredPrefix}`);
    expect(first.state).toBe('completed');
    const before=store.get(scope,seed.id,'notes.fact');expect(before).toMatchObject({version:1,deleted:false});
    const preview=engine.memoryQuery(actor,{runId:first.id,nodeId:'effect',operation:previewMode,key:previewPrefix}).result as MemoryRemovalPlan;
    const apply=authored(operation,authoredPrefix);apply.revision=1;engine.save(actor,apply,1,true);
    const failed=await engine.run(actor,apply.slug,{plan:preview},`reject-${operation}-${previewMode}-${authoredPrefix}`);
    expect(failed).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_MEMORY_CONFLICT'}});
    expect(store.get(scope,seed.id,'notes.fact')).toEqual(before);
    const mutationId=failed.trace.find(step=>step.nodeId==='effect')?.memoryMutationId;
    expect(mutationId).toBeDefined();expect(store.mutation(scope,seed.id,mutationId!)).toBeUndefined();
    await engine.close();
    const reopenedStore=new SqliteStorage(file),reopened=new Engine(reopenedStore,host);
    expect(reopenedStore.get(scope,seed.id,'notes.fact')).toEqual(before);
    expect(reopenedStore.mutation(scope,seed.id,mutationId!)).toBeUndefined();
    await reopened.close();
  });
  for(const mode of ['reset','retention'] as const)for(const representation of ['object','id'] as const)it(`accepts a matching ${representation} ${mode} plan`,async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-plan-valid-'));roots.push(root);
    const store=new SqliteStorage(join(root,'loops.sqlite')),engine=new Engine(store,host);
    const seed=authored('write');engine.save(actor,seed,0,true);
    const first=await engine.run(actor,seed.slug,{},`valid-seed-${representation}`);
    const preview=engine.memoryQuery(actor,{runId:first.id,nodeId:'effect',operation:mode==='reset'?'reset-preview':'retention-preview',key:'notes'}).result as MemoryRemovalPlan;
    const apply=authored(mode==='reset'?'reset-apply':'retention-apply','notes');apply.revision=1;engine.save(actor,apply,1,true);
    const result=await engine.run(actor,apply.slug,{plan:representation==='object'?preview:preview.planId},`valid-apply-${representation}`);
    expect(result).toMatchObject({state:'completed'});
    expect(store.get(scope,seed.id,'notes.fact')).toMatchObject(mode==='reset'?{version:2,deleted:true,provenance:{operation:'reset'}}:{version:1,deleted:false});
    await engine.close();
  });
  it('retries a failed unpublished Memory Test without minting a persisted grant',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-test-retry-'));roots.push(root);
    const file=join(root,'loops.sqlite'),store=new SqliteStorage(file),engine=new Engine(store,host);
    const draft=authored('write');const first=await engine.test(actor,draft,{},'unpublished-memory-test');
    expect(first).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_MEMORY_DISABLED'}});
    for(const mode of ['restart','retry-node'] as const){
      const retried=await engine.retry(actor,first.id,mode,`unpublished-${mode}`);
      expect(retried).toMatchObject({state:'failed',testMode:true,errorDetail:{code:'LOOPS_MEMORY_DISABLED'}});
      expect(retried.memoryWriteGrant).toBeUndefined();
    }
    await expect(engine.retry(actor,first.id,'checkpoint','unpublished-checkpoint')).rejects.toThrow(/committed checkpoint/i);
    expect(store.page(scope,draft.id,'notes',undefined,10).items).toEqual([]);
    expect(engine.runs(actor)).toHaveLength(3);
    await engine.close();
    const reopenedStore=new SqliteStorage(file),reopened=new Engine(reopenedStore,host);
    expect(reopened.runs(actor)).toHaveLength(3);
    expect(reopenedStore.page(scope,draft.id,'notes',undefined,10).items).toEqual([]);
    await reopened.close();
  });
  it('does not cancel unrelated active work on unpublished Test retry and still grants a saved retry',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-retry-active-'));roots.push(root);
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const slowHost:HostCapabilities={...host,complete:async()=>{entered();await gate;return {text:'ready'};}};
    const engine=new Engine(new SqliteStorage(join(root,'loops.sqlite')),slowHost,{concurrency:2,replyTimeoutMs:5});
    const live=authored('write');live.id='active-memory-repair';live.slug=live.id;live.capabilities=['llm'];
    live.nodes.splice(1,0,{id:'think',kind:'inference',label:'Think',prompt:'Continue.',output:'text'});
    live.edges=[{id:'a',source:'input',target:'think',port:'next'},{id:'b',source:'think',target:'effect',port:'next'},{id:'c',source:'effect',target:'return',port:'next'}];
    engine.save(actor,live,0,true);
    const pending=engine.run(actor,live.slug,{},'active-memory-repair');
    let handle!:Awaited<typeof pending>;
    try{
      await started;handle=await pending;expect(handle.state).toBe('running');
      const draft=authored('write');const first=await engine.test(actor,draft,{},'unpublished-during-active');
      expect(first).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_MEMORY_DISABLED'}});
      for(const mode of ['restart','retry-node'] as const){
        const retried=await engine.retry(actor,first.id,mode,`unpublished-active-${mode}`);
        expect(retried).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_MEMORY_DISABLED'}});
        expect(retried.memoryWriteGrant).toBeUndefined();
      }
      expect(engine.status(actor,handle.id).state).toBe('running');
    }finally{release();}
    await vi.waitFor(()=>expect(engine.status(actor,handle.id).state).toBe('completed'));
    const invalid=authored('write');invalid.id='saved-memory-retry';invalid.slug=invalid.id;
    const effect=invalid.nodes.find(node=>node.kind==='memory');if(!effect||effect.kind!=='memory')throw Error('Missing Memory fixture node.');
    effect.memory.value={literalJson:'{"count":"invalid"}'};
    engine.save(actor,invalid,0,true);
    const failed=await engine.run(actor,invalid.slug,{},'saved-retry-initial');
    expect(failed.errorDetail?.code).toBe('LOOPS_MEMORY_SCHEMA');
    const savedRetry=await engine.retry(actor,failed.id,'restart','saved-retry-new-grant');
    expect(savedRetry.memoryWriteGrant).toMatchObject({runId:savedRetry.id,loopId:invalid.id,revision:1});
    expect(savedRetry.errorDetail?.code).toBe('LOOPS_MEMORY_SCHEMA');
    await engine.close();
  });
});

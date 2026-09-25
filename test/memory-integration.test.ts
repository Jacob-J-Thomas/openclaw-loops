import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {validateGraph,type Definition} from '../src/graph.js';
import {duplicateNode,revisionChanges} from '../src/editor-operations.js';
import type {DataSchema} from '../src/data-schema.js';
import {createHash} from 'node:crypto';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const actor:Actor={agentId:'main',sessionKey:'agent:main:memory',sessionId:'memory-session',source:'tool',human:false,check:()=>{}};
const host:HostCapabilities={check:()=>{},complete:async()=>({text:'unused'}),modelInfo:async()=>({})};
const schema:DataSchema={type:'object',properties:{count:{type:'integer'},nullable:{type:'null'},unicode:{type:'string'}},required:['count','nullable','unicode'],additionalProperties:false};
function definition(operation:'write'|'consume',revision=0):Definition{
  return {schemaVersion:3,id:'memory-two-run',slug:'memory-two-run',name:'Memory two run',description:'',revision,
    inputSchema:operation==='write'?[{name:'value',label:'Value',type:'json',required:true}]:[],capabilities:[],limits:{maxExecutions:5,maxOutputBytes:4096},layout:{},
    nodes:[{id:'input',kind:'input',label:'Input'},
      {id:'remember',kind:'memory',label:'Remember',memory:{operation,key:'notes.fact',...operation==='write'?{value:'{{input.value}}'}:{}}},
      {id:'return',kind:'return',label:'Return',value:operation==='write'?'{{nodes.remember.version}}':'{{nodes.remember.value}}'}],
    edges:[{id:'a',source:'input',target:'remember',port:'next'},{id:'b',source:'remember',target:'return',port:'next'}],
    memoryPolicy:{version:1,enabled:true,nodes:{remember:{readPrefixes:operation==='consume'?['notes']:[],writeScopes:operation==='write'?[{prefix:'notes',schemaId:'fact',schemaVersion:1,retentionDays:30}]:[],forgetPrefixes:[]}}},
    ...operation==='write'?{memorySchemas:[{id:'fact',version:1,schema}]}:{} };
}

describe('saved opt-in memory graph integration',()=>{
  it('denies a read-only session action before an authored Memory effect commits',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-read-only-'));roots.push(root);
    const engine=new Engine(new SqliteStorage(join(root,'loops.sqlite')),host),write=definition('write');
    expect(engine.save(actor,write,0,true).issues).toEqual([]);
    const readOnly:Actor={...actor,source:'session-action',canManage:false,human:false};
    const value={count:0,nullable:null,unicode:'private'};
    await expect(engine.run(readOnly,write.slug,{value},'memory-read-only-run')).rejects.toThrow(/write access|authorized agent tool/i);
    expect(engine.runs(actor)).toEqual([]);
    const authorized=await engine.run(actor,write.slug,{value},'memory-authorized-run');
    expect(authorized).toMatchObject({state:'completed',result:1});
    await engine.close();
  });
  it('binds a UI running handle to one exact plugin memory grant and rechecks revocation before its later CAS',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-background-'));roots.push(root);
    const store=new SqliteStorage(join(root,'loops.sqlite'));
    let entered!:()=>void,finish!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
    const waitingHost:HostCapabilities={...host,complete:async()=>{entered();await gate;return {text:'continued'};}};
    const engine=new Engine(store,waitingHost,{replyTimeoutMs:5});
    const write=definition('write');write.capabilities=['llm'];
    const policy=write.memoryPolicy;if(policy?.enabled)policy.nodes.remember.readPrefixes=['notes'];
    write.nodes.splice(1,0,{id:'think',kind:'inference',label:'Think',prompt:'Continue.',output:'text'});
    write.edges=[{id:'a',source:'input',target:'think',port:'next'},{id:'b',source:'think',target:'remember',port:'next'},{id:'c',source:'remember',target:'return',port:'next'}];
    expect(engine.save(actor,write,0,true).issues).toEqual([]);
    const ui:Actor={...actor,source:'session-action',human:false,canManage:true};
    const value={count:0,nullable:null,unicode:'after handle'};
    const pending=engine.run(ui,write.slug,{value},'memory-ui-background');
    let handle!:Awaited<typeof pending>;
    try{
      await started;handle=await pending;
      expect(handle.state).toBe('running');
      expect(handle.memoryWriteGrant).toMatchObject({runId:handle.id,ownerKey:JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]),
        loopId:write.id,revision:1,grantGeneration:handle.grantGeneration});
    }finally{finish();}
    await vi.waitFor(()=>expect(engine.status(ui,handle.id).state).toBe('completed'));
    expect(engine.memoryQuery(ui,{runId:handle.id,nodeId:'remember',operation:'consume',key:'notes.fact'})).toMatchObject({result:{value}});
    await engine.close();

    const secondRoot=mkdtempSync(join(tmpdir(),'loops-memory-revoked-background-'));roots.push(secondRoot);
    const secondStore=new SqliteStorage(join(secondRoot,'loops.sqlite'));
    let enteredSecond!:()=>void,finishSecond!:()=>void;
    const secondStarted=new Promise<void>(resolve=>{enteredSecond=resolve;}),secondGate=new Promise<void>(resolve=>{finishSecond=resolve;});
    const secondHost:HostCapabilities={...host,complete:async()=>{enteredSecond();await secondGate;return {text:'continued'};}};
    const second=new Engine(secondStore,secondHost,{replyTimeoutMs:5});
    expect(second.save(actor,write,0,true).issues).toEqual([]);
    const next=second.run(ui,write.slug,{value},'memory-ui-revoked');let nextHandle!:Awaited<typeof next>;
    try{await secondStarted;nextHandle=await next;second.revoke(actor,write.id);}finally{finishSecond();}
    await vi.waitFor(()=>expect(second.status(ui,nextHandle.id).state).toBe('failed'));
    const scope=createHash('sha256').update(JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId])).digest('hex');
    expect(secondStore.page(scope,write.id,'notes',undefined,10).items).toEqual([]);
    await second.close();
  });
  it('copies explicit policy with a duplicated Memory node and reports policy and catalog edits',()=>{
    const write=definition('write'),copied=duplicateNode(write,'remember',()=> 'remember-copy');
    expect(copied.memoryPolicy).toMatchObject({enabled:true,nodes:{'remember-copy':write.memoryPolicy?.enabled?write.memoryPolicy.nodes.remember:undefined}});
    expect(revisionChanges(write,copied)).toContain('memoryPolicy changed');
    const changed=structuredClone(write);changed.memorySchemas![0].version=2;
    expect(revisionChanges(write,changed)).toContain('memorySchemas changed');
  });
  it('writes once in SQLite and reads on a later authorized run, then survives restart while foreign scope fails',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-integration-'));roots.push(root);
    const database=join(root,'loops.sqlite'),store=new SqliteStorage(database),engine=new Engine(store,host);
    const write=definition('write');expect(validateGraph(write)).toEqual([]);
    expect(engine.save(actor,write,0,true).issues).toEqual([]);
    const value={count:0,nullable:null,unicode:'🦊 café'};
    const first=await engine.run(actor,write.slug,{value},'memory-write-run');
    expect(first).toMatchObject({state:'completed',result:1});
    expect(first.trace.find(item=>item.nodeId==='remember')?.memoryMutationId).toMatch(/^[a-f0-9]{64}$/);
    const read=definition('consume',1);expect(validateGraph(read)).toEqual([]);
    expect(engine.save(actor,read,1,true).issues).toEqual([]);
    const second=await engine.run(actor,read.slug,{},'memory-read-run');
    expect(second).toMatchObject({state:'completed',result:value});
    expect(second.trace.find(item=>item.nodeId==='remember')?.memoryMutationId).toBeUndefined();
    const foreign={...actor,sessionKey:'agent:main:foreign',sessionId:'foreign-session'};
    const denied=await engine.run(foreign,read.slug,{},'foreign-memory-read');
    expect(denied).toMatchObject({state:'failed'});expect(denied.errorDetail?.code).toBe('LOOPS_MEMORY_NOT_FOUND');
    await engine.close();
    const reopenedStore=new SqliteStorage(database),reopened=new Engine(reopenedStore,host);
    const third=await reopened.run(actor,read.slug,{},'memory-restart-read');
    expect(third).toMatchObject({state:'completed',result:value});
    await reopened.close();
  });
  it('never admits memory from an unpublished test or an absent policy',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-disabled-'));roots.push(root);
    const engine=new Engine(new SqliteStorage(join(root,'loops.sqlite')),host);
    const draft=definition('write');
    const test=await engine.test(actor,draft,{value:{count:0,nullable:null,unicode:'🦊'}},'memory-test');
    expect(test).toMatchObject({state:'failed'});expect(test.errorDetail?.code).toBe('LOOPS_MEMORY_DISABLED');
    const absent=definition('write');delete absent.memoryPolicy;
    expect(validateGraph(absent).map(issue=>issue.message)).toContain('Memory node requires an enabled authored node policy.');
    const malformed=definition('write');malformed.memoryPolicy={version:1,enabled:true} as Definition['memoryPolicy'];
    expect(validateGraph(malformed).map(issue=>issue.message)).toEqual(expect.arrayContaining(['Authored memory policy is invalid.','Memory node requires an enabled authored node policy.']));
    await engine.close();
  });
  it('reports a committed effect when run evidence exceeds its output budget, without replaying it',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-uncertain-'));roots.push(root);
    const engine=new Engine(new SqliteStorage(join(root,'loops.sqlite')),host);
    const write=definition('write');write.limits.maxOutputBytes=128;
    engine.save(actor,write,0,true);
    const failed=await engine.run(actor,write.slug,{value:{count:0,nullable:null,unicode:'value'}},'memory-output-limit');
    const mutationId=failed.trace.find(item=>item.nodeId==='remember')?.memoryMutationId;
    expect(failed).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_OUTPUT_LIMIT'}});
    expect(mutationId).toMatch(/^[a-f0-9]{64}$/);
    expect(failed.uncertainty).toContain(mutationId);
    expect(engine.memoryQuery(actor,{runId:failed.id,nodeId:'remember',operation:'mutation',key:mutationId!})).toMatchObject({
      result:{receipts:[{key:'notes.fact',version:1,mutationId}]},
    });
    expect(()=>engine.memoryQuery(actor,{runId:failed.id,nodeId:'remember',operation:'mutation',key:'not-a-receipt'})).not.toThrow();
    await engine.close();
  });
  it('applies an authored reset preview atomically and retains tombstone provenance after restart',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-memory-reset-'));roots.push(root);
    const database=join(root,'loops.sqlite'),engine=new Engine(new SqliteStorage(database),host);
    const write=definition('write');engine.save(actor,write,0,true);
    expect(await engine.run(actor,write.slug,{value:{count:0,nullable:null,unicode:'before reset'}},'memory-reset-seed')).toMatchObject({state:'completed'});
    const reset=definition('consume',1);
    reset.nodes=[{id:'input',kind:'input',label:'Input'},
      {id:'preview',kind:'memory',label:'Preview',memory:{operation:'reset-preview',key:'notes'}},
      {id:'apply',kind:'memory',label:'Apply',memory:{operation:'reset-apply',key:'notes',plan:'{{nodes.preview.planId}}'}},
      {id:'return',kind:'return',label:'Return',value:'{{nodes.apply.receipts}}'}];
    reset.edges=[{id:'a',source:'input',target:'preview',port:'next'},{id:'b',source:'preview',target:'apply',port:'next'},{id:'c',source:'apply',target:'return',port:'next'}];
    reset.memoryPolicy={version:1,enabled:true,nodes:{preview:{readPrefixes:[],writeScopes:[],forgetPrefixes:['notes']},apply:{readPrefixes:['notes'],writeScopes:[],forgetPrefixes:['notes']}}};
    expect(validateGraph(reset)).toEqual([]);engine.save(actor,reset,1,true);
    const result=await engine.run(actor,reset.slug,{},'memory-reset-apply');
    expect(result).toMatchObject({state:'completed',result:[{key:'notes.fact',version:2,deleted:true}]});
    expect(engine.memoryQuery(actor,{runId:result.id,nodeId:'apply',operation:'inspect',key:'notes.fact'})).toMatchObject({result:{deleted:true,version:2,provenance:{operation:'reset',runId:result.id}}});
    await engine.close();
    const reopened=new Engine(new SqliteStorage(database),host);
    expect(()=>reopened.memoryQuery(actor,{runId:result.id,nodeId:'apply',operation:'consume',key:'notes.fact'})).toThrow();
    expect(reopened.memoryQuery(actor,{runId:result.id,nodeId:'apply',operation:'inspect',key:'notes.fact'})).toMatchObject({result:{deleted:true,version:2}});
    await reopened.close();
  });
});

import {describe,it,expect,vi} from 'vitest';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {compare,parseDefinition,validateGraph,type Definition} from '../src/graph.js';
import {bindingChoices,duplicateNode,revisionChanges,mergeDefinitions} from '../src/editor-operations.js';
const actor:Actor={agentId:'main',sessionKey:'main:versions',sessionId:'s',source:'tool',human:false,model:'fake/admitted',reasoning:'high',check:()=>{}};
function setup(text='{"nested":{"rows":[{"name":"Alpha"}]}}'){
  let value:ReturnType<Storage['read']>;
  const storage:Storage={read:()=>structuredClone(value),write:s=>{value=structuredClone(s);}};
  const host:HostCapabilities={check:()=>{},complete:vi.fn(async()=>({text})),modelInfo:async()=>({provider:'fake',model:'test'})};
  return {engine:new Engine(storage,host),storage,host};
}
const literal=():Definition=>({...structuredClone(examples[0]),id:'v2',slug:'v2',schemaVersion:2,inputSchema:[],capabilities:[],limits:{maxExecutions:1000,timeoutMs:120000,maxOutputBytes:1024*1024},nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'First'}],edges:[{id:'e',source:'input',target:'return',port:'next'}]});
describe('versioned publication and execution',()=>{
  it('saves drafts independently, publishes exact versions and restores as a new draft',async()=>{
    const {engine}=setup();const definition=literal();engine.save(actor,definition,0,true);
    const draft=engine.draft(actor,{...engine.load(actor,'v2').definition,name:'Draft',nodes:definition.nodes.map(n=>n.kind==='return'?{...n,value:'Second'}:n)},1);
    expect(draft.record).toMatchObject({enabledRevision:1,publishedRevision:1,definition:{revision:2}});
    expect((await engine.run(actor,'v2',{},'published1')).result).toBe('First');
    engine.publish(actor,'v2',2,2);expect((await engine.run(actor,'v2',{},'published2')).result).toBe('Second');
    expect(engine.restore(actor,'v2',1,2).record).toMatchObject({enabledRevision:2,publishedRevision:2,definition:{revision:3}});
    expect(engine.versions(actor,'v2').map(v=>v.revision)).toEqual([3,2,1]);
  });
  it('tests unsaved data without mutating the library or publication',async()=>{
    const {engine}=setup();const before=engine.library(actor);const d=literal();d.nodes[1]={id:'return',kind:'return',label:'Return',value:'Unpublished'};
    const run=await engine.test(actor,d,{},'test-draft');expect(run).toMatchObject({testMode:true,state:'completed',result:'Unpublished'});expect(engine.library(actor)).toEqual(before);
  });
  it('keeps the published slug routable while a draft renames it',async()=>{
    const {engine}=setup();engine.save(actor,literal(),0,true);engine.draft(actor,{...engine.load(actor,'v2').definition,slug:'next-slug'},1);
    expect(engine.list(actor)).toContainEqual(expect.objectContaining({slug:'v2'}));expect((await engine.run(actor,'v2',{},'original-slug')).result).toBe('First');
    expect(()=>engine.save(actor,{...literal(),id:'other'},0,true)).toThrow(/slug/);
    engine.publish(actor,'v2',2,2);expect((await engine.run(actor,'next-slug',{},'new-slug')).result).toBe('First');
  });
  it('retains more than 50 runs and serves full large Unicode outputs in pages',async()=>{
    const {engine}=setup();const d=literal();d.nodes[1]={id:'return',kind:'return',label:'Return',value:'🧪'.repeat(10000)};engine.save(actor,d,0,true);
    let run;for(let index=0;index<61;index++)run=await engine.run(actor,'v2',{},`history-${index}`);
    expect(engine.history(actor,0,50)).toMatchObject({total:61,nextCursor:50});expect(engine.history(actor,50,50).items).toHaveLength(11);
    let result='',offset:number|null=0;while(offset!==null){const page=engine.output(actor,run!.id,undefined,offset,1000);result+=page.text;offset=page.nextOffset;}
    expect(result).toBe('🧪'.repeat(10000));expect(()=>engine.output({...actor,sessionId:'other'},run!.id)).toThrow(/not found/);
  });
  it('preserves Advanced overrides through draft, version restore and graph round trips',()=>{
    const {engine}=setup();const d={...structuredClone(examples[0]),schemaVersion:2 as const};if(d.nodes[1].kind!=='inference')throw Error();d.nodes[1].advanced={temperature:0,maxTokens:800};
    engine.draft(actor,{...d,revision:1},1);const saved=engine.load(actor,d.id).definition;
    expect(parseDefinition(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    engine.edit(actor,d.id,2,{name:'Edited'},false);expect(engine.restore(actor,d.id,2,3).record.definition.nodes[1]).toMatchObject({advanced:{temperature:0,maxTokens:800}});
  });
  it('reuses admitted settings after a wait and records explicit recovery ancestry',async()=>{
    const {engine,host}=setup();engine.enable(actor,'read-pause-continue',1,true);const waiting=await engine.run(actor,'read-pause-continue',{text:'A'},'pin');
    await engine.resume({...actor,model:'fake/changed',reasoning:'off'},waiting.id);
    expect(vi.mocked(host.complete).mock.lastCall?.[0]).toMatchObject({model:'fake/admitted',reasoning:'high'});
    const d=literal();d.nodes[1]={id:'return',kind:'return',label:'Return',value:'{{input.absent}}'};engine.save(actor,{...d,nodes:[d.nodes[0],{id:'fail',kind:'fail',label:'Fail',reason:'Failure'}],edges:[{id:'e',source:'input',target:'fail',port:'next'}]},0,true);
    const failed=await engine.run(actor,'v2',{},'failure');const retried=await engine.retry(actor,failed.id,'restart','retry');expect(retried.parentRunId).toBe(failed.id);expect(retried.id).not.toBe(failed.id);
  });
  it('recovers deleted definitions without losing history and detects slug reuse',async()=>{
    const {engine}=setup();engine.save(actor,literal(),0,true);const run=await engine.run(actor,'v2',{},'before-delete');engine.delete(actor,'v2',1);
    expect(engine.deleted(actor)).toContainEqual(expect.objectContaining({id:'v2'}));engine.recover(actor,'v2',1);expect(engine.load(actor,'v2').enabledRevision).toBeNull();expect(engine.status(actor,run.id).result).toBe('First');
  });
});
describe('v2 data and editor contracts',()=>{
  it('does not discard local changes when a recovered draft lacks a merge base',()=>{
    const local=structuredClone(examples[0]),remote=structuredClone(local);local.name='My recovered change';remote.name='Concurrent saved name';remote.revision++;
    const merged=mergeDefinitions(null,local,remote);expect(merged.conflicts).toContainEqual({path:'name',local:'My recovered change',remote:'Concurrent saved name'});
    expect(merged.conflicts.some(item=>item.path==='revision')).toBe(false);expect(merged.definition.name).toBe('My recovered change');
  });
  it('merges independent node edits and requires a choice for conflicting Advanced values',()=>{
    const base=structuredClone(examples[0]),local=structuredClone(base),remote=structuredClone(base);remote.revision++;
    local.name='Local name';remote.description='Remote description';
    const own=local.nodes[1],theirs=remote.nodes[1];if(own.kind!=='inference'||theirs.kind!=='inference')throw Error();
    own.advanced={temperature:0};theirs.prompt='Remote prompt';
    const combined=mergeDefinitions(base,local,remote);expect(combined.conflicts).toEqual([]);expect(combined.definition).toMatchObject({name:'Local name',description:'Remote description',revision:remote.revision});expect(combined.definition.nodes[1]).toMatchObject({prompt:'Remote prompt',advanced:{temperature:0}});
    theirs.advanced={temperature:1};const disputed=mergeDefinitions(base,local,remote);expect(disputed.conflicts.map(c=>c.path)).toEqual(['nodes.summary.advanced']);
    const chosen=mergeDefinitions(base,local,remote,{'nodes.summary.advanced':'local'});expect(chosen.conflicts).toEqual([]);expect(chosen.definition.nodes[1]).toMatchObject({advanced:{temperature:0}});
  });
  it('inherits host timeout when unset and subtracts elapsed time between model nodes',async()=>{
    const {engine,host}=setup();const d={...structuredClone(examples[0]),schemaVersion:2 as const};delete d.limits.timeoutMs;
    await engine.test(actor,d,{text:'No override'},'inherit-timeout');expect(vi.mocked(host.complete).mock.lastCall?.[3]).toBeUndefined();
    d.limits.timeoutMs=5000;const inference=d.nodes[1];if(inference.kind!=='inference')throw Error();
    d.nodes.splice(2,0,{...inference,id:'second'});d.edges=[{id:'e1',source:'input',target:inference.id,port:'next'},{id:'e2',source:inference.id,target:'second',port:'next'},{id:'e3',source:'second',target:'return',port:'next'}];
    vi.mocked(host.complete).mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {text:'ok'};});
    await engine.test(actor,d,{text:'Explicit budget'},'explicit-timeout');
    const times=vi.mocked(host.complete).mock.calls.slice(-2).map(call=>call[3]!);expect(times[1]).toBeLessThan(times[0]);expect(times[1]).toBeGreaterThan(0);
  });
  it('supports nested structured input and output bindings',async()=>{
    const {engine}=setup();const d={...structuredClone(examples[0]),schemaVersion:2 as const,inputSchema:[{name:'data',label:'Data',type:'json' as const,required:true}]};
    if(d.nodes[1].kind!=='inference'||d.nodes[2].kind!=='return')throw Error();d.nodes[1].prompt='{{input.data.rows.0.name}}';d.nodes[1].output='json';d.nodes[2].value='{{nodes.summary.value.nested.rows.0.name}}';
    expect(validateGraph(d)).toEqual([]);const result=await engine.test(actor,d,{data:{rows:[{name:'Input'}]}},'json');expect(result.result).toBe('Alpha');
  });
  it('preserves v1 equality while v2 compares typed objects independent of key order',()=>{
    const ctx={input:{n:1,text:'1',left:{x:1,y:2},right:{y:2,x:1}},nodes:{}};
    expect(compare({left:'{{input.n}}',op:'equals',right:'{{input.text}}'},ctx,1)).toBe(true);
    expect(compare({left:'{{input.n}}',op:'equals',right:'{{input.text}}'},ctx,2)).toBe(false);
    expect(compare({left:'{{input.left}}',op:'equals',right:'{{input.right}}'},ctx,2)).toBe(true);
  });
  it('duplicates Repeat with independent body identities and remapped internal bindings',()=>{
    let index=0;const copy=duplicateNode(examples[1],'refine',prefix=>`${prefix}-${++index}`);const repeat=copy.nodes.at(-1)!;if(repeat.kind!=='repeat')throw Error();expect(repeat.body[0].id).not.toBe('draft');expect(repeat.body[1].predicate.left).toContain(`nodes.${repeat.body[0].id}.text`);
    expect(revisionChanges(examples[1],copy)).toContain('Added Refine · at most 3 copy');
  });
  it('offers only actual producer fields to the binding picker',()=>{
    const d=examples[0];expect(bindingChoices(d,d.nodes[2])).toContain('{{nodes.summary.text}}');expect(bindingChoices(d,d.nodes[2])).not.toContain('{{nodes.input.text}}');
  });
});

import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {validateGraph,type Definition} from '../src/graph.js';
import {ContextLifecycleEditor} from '../src/context-lifecycle-editor.js';
import {initialContext} from '../src/context.js';
import {lifecycleMutation,validateLifecycle} from '../src/context-lifecycle.js';

const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const actor:Actor={agentId:'main',sessionKey:'lifecycle',sessionId:'lifecycle-session',source:'tool',human:false,check:()=>{}};
const host=(complete=vi.fn(async()=>({text:'short retained summary'}))):HostCapabilities=>({check:()=>{},modelInfo:async()=>({}),complete});
function storage(){const directory=mkdtempSync(join(tmpdir(),'loops-lifecycle-')),value=new SqliteStorage(join(directory,'loops.sqlite'));cleanups.push(async()=>{await value.close();rmSync(directory,{recursive:true,force:true});});return {directory,value};}
const base=(nodes:Definition['nodes'],edges:Definition['edges']):Definition=>({schemaVersion:3,id:'lifecycle',slug:'lifecycle',name:'Lifecycle',description:'',revision:0,inputSchema:[{name:'data',label:'Data',type:'json',required:true},{name:'secret',label:'Secret',type:'text',required:true}],capabilities:['llm'],limits:{maxExecutions:16,maxOutputBytes:4096},nodes,edges,layout:{}});
function primary():Definition{return base([
  {id:'input',kind:'input',label:'Input'},
  {id:'inject',kind:'context-lifecycle',label:'Inject',lifecycle:{operation:'inject',target:'/working',paths:['/input/data'],value:{literalJson:'{"zero":0,"none":null}'},reason:'seed a mutable value'}},
  {id:'compact',kind:'context-lifecycle',label:'Compact',lifecycle:{operation:'compact',target:'/summary',paths:['/working'],instructions:'Summarize exactly the selected JSON.',reason:'bounded compaction'}},
  {id:'return',kind:'return',label:'Return',value:'{{nodes.compact.contextVersion}}'},
],[{id:'a',source:'input',target:'inject',port:'next'},{id:'b',source:'inject',target:'compact',port:'next'},{id:'c',source:'compact',target:'return',port:'next'}]);}
function single(lifecycle:Extract<Definition['nodes'][number],{kind:'context-lifecycle'}>['lifecycle']):Definition{return base([
  {id:'input',kind:'input',label:'Input'},
  {id:'step',kind:'context-lifecycle',label:'Lifecycle',lifecycle},
  {id:'return',kind:'return',label:'Return',value:'{{nodes.step.contextVersion}}'},
],[{id:'a',source:'input',target:'step',port:'next'},{id:'b',source:'step',target:'return',port:'next'}]);}

describe('context lifecycle',()=>{
  it('renders accessible authored controls and rejects lifecycle configuration that would hide a model call',()=>{
    const markup=renderToStaticMarkup(React.createElement(ContextLifecycleEditor,{value:{operation:'compact',target:'/summary',paths:['/working'],instructions:'Keep facts.'},onChange:()=>{},loadCapabilities:async()=>({configured:'unknown' as const,authorized:'unknown' as const,available:'unknown' as const,parameters:[],notes:[]})}));
    expect(markup).toContain('Lifecycle write target');expect(markup).toContain('Selected paths');expect(markup).toContain('Authored summary instructions');expect(markup).toContain('Reasoning');expect(markup).toContain('Advanced settings');
    const invalid=primary();if(invalid.nodes[2].kind!=='context-lifecycle')throw Error();invalid.nodes[2].lifecycle.source={kind:'initial'};
    expect(validateGraph(invalid).map(issue=>issue.message).join(' ')).toMatch(/cannot replace/);
  });
  it('retains exact pre-loss snapshots, sends only the selected projection, and compacts after a completion',async()=>{
    const {directory,value}=storage(),complete=vi.fn(async()=>({text:'short retained summary'})),engine=new Engine(value,host(complete),{documentDirectory:join(directory,'documents')}),definition=primary();
    if(definition.nodes[1].kind!=='context-lifecycle')throw Error();definition.nodes[1].lifecycle.value='{{input.data}}';
    expect(validateGraph(definition)).toEqual([]);
    const run=await engine.test(actor,definition,{data:{nested:['α',0,null],literal:'{{input.secret}}'},secret:'do-not-send'},'lifecycle-primary');
    expect(run).toMatchObject({state:'completed',result:2,context:{version:2,value:{input:{data:{nested:['α',0,null],literal:'{{input.secret}}'},secret:'do-not-send'},summary:'short retained summary'}}});
    expect(run.context!.sources).toHaveLength(2);
    expect(run.context!.sources![1]).toMatchObject({operation:'compact',paths:['/working'],removedPaths:['/working'],sourceVersion:1,targetVersion:2,model:{text:'short retained summary'}});
    const prompt=(complete.mock.calls as unknown as Array<[unknown,string]>)[0]![1];expect(complete).toHaveBeenCalledTimes(1);expect(prompt).toContain('"/working"');expect(prompt).toContain('{{input.secret}}');expect(prompt).not.toContain('do-not-send');
    expect(run.context!.sources![1].modelRequest).toMatchObject({prompt});
    const retention=engine.maintenance(actor,{olderThanDays:0,keepLatest:0});
    expect(retention.protected.referenced).toBeGreaterThan(0);expect(retention.protected.readers).toBe(0);
    await engine.close();const reopened=new SqliteStorage(join(directory,'loops.sqlite'));cleanups.push(()=>reopened.close());
    expect(new Engine(reopened,host(),{documentDirectory:join(directory,'documents')}).status(actor,run.id).context).toEqual(run.context);
  });
  it('retrieves an explicit retained source and resets from the initial snapshot without implicit lookup',async()=>{
    const {directory,value}=storage(),engine=new Engine(value,host(),{documentDirectory:join(directory,'documents')}),first=await engine.test(actor,primary(),{data:{keep:'yes'},secret:'hidden'},'source-run');
    const retained=first.context!.sources![0].id;
    const definition=base([
      {id:'input',kind:'input',label:'Input'},
      {id:'retrieve',kind:'context-lifecycle',label:'Retrieve',lifecycle:{operation:'retrieve',target:'/recovered',paths:['/input/data'],source:{kind:'retained',sourceId:retained}}},
      {id:'reset',kind:'context-lifecycle',label:'Reset',lifecycle:{operation:'reset',target:'/initial',paths:['/input/data'],source:{kind:'initial'},reason:'restore authored initial value'}},
      {id:'return',kind:'return',label:'Return',value:'{{nodes.reset.contextVersion}}'},
    ],[{id:'a',source:'input',target:'retrieve',port:'next'},{id:'b',source:'retrieve',target:'reset',port:'next'},{id:'c',source:'reset',target:'return',port:'next'}]);
    const run=await engine.test(actor,definition,{data:{keep:'yes'},secret:'different'},'retrieve-reset');
    expect(run).toMatchObject({state:'completed',context:{value:{recovered:{'/input/data':{keep:'yes'}},initial:{'/input/data':{keep:'yes'}}},sources:[{operation:'retrieve'},{operation:'reset'}]}});
  });
  it('retrieves an absent current path only from the selected retained snapshot',async()=>{
    const {directory,value}=storage(),engine=new Engine(value,host(),{documentDirectory:join(directory,'documents')});
    const first=await engine.test(actor,primary(),{data:{selected:0,other:'private'},secret:'hidden'},'retained-absent-source');
    const sourceId=first.context!.sources![1].id;
    const definition=single({operation:'retrieve',target:'/copy',paths:['/working'],source:{kind:'retained',sourceId,format:'snapshot'}});
    const restored=await engine.test(actor,definition,{data:{selected:1},secret:'new'},'retained-absent-retrieve');
    expect(restored).toMatchObject({state:'completed',context:{value:{copy:{'/working':{zero:0,none:null}}},sources:[{absentPaths:['/working','/copy']}]}});
    const denied=single({operation:'retrieve',target:'/copy',paths:['/input/secret'],source:{kind:'retained',sourceId,format:'snapshot'}});
    const failed=await engine.test(actor,denied,{data:{selected:1},secret:'new'},'retained-unselected');
    expect(failed).toMatchObject({state:'failed',context:{version:0}});
    expect(failed.errorDetail?.code).toBe('LOOPS_CONTEXT_SOURCE_UNAVAILABLE');
  });
  it('selects ordinary JSON documents with zero, null and Unicode and rejects a foreign owner',async()=>{
    const {directory,value}=storage(),engine=new Engine(value,host(),{documentDirectory:join(directory,'documents')});
    const document=engine.documentSnapshot(actor,{zero:0,nullable:null,unicode:'🦊 café',private:'no'});
    const definition=single({operation:'inject',target:'/copy',paths:['/zero','/nullable','/unicode'],source:{kind:'retained',sourceId:document.documentId,format:'document'}});
    const run=await engine.test(actor,definition,{data:{},secret:'s'},'ordinary-document');
    expect(run).toMatchObject({state:'completed',context:{value:{copy:{'/zero':0,'/nullable':null,'/unicode':'🦊 café'}}}});
    expect(JSON.stringify(run.context!.value.copy)).not.toContain('private');
    const foreign={...actor,sessionKey:'another-conversation',sessionId:'another-session'};
    const blocked=await engine.test(foreign,definition,{data:{},secret:'s'},'foreign-document');
    expect(blocked).toMatchObject({state:'failed',context:{version:0}});
    expect(blocked.context!.sources).toBeUndefined();
  });
  it('treats initial as the immutable input snapshot, never the current mutable context',async()=>{
    const {directory,value}=storage(),engine=new Engine(value,host(),{documentDirectory:join(directory,'documents')});
    const definition=base([
      {id:'input',kind:'input',label:'Input'},
      {id:'inject',kind:'context-lifecycle',label:'Inject',lifecycle:{operation:'inject',target:'/working',paths:['/input/data'],value:{literalJson:'{"changed":true}'}}},
      {id:'reset',kind:'context-lifecycle',label:'Reset',lifecycle:{operation:'reset',target:'/restored',paths:['/input/data'],source:{kind:'initial'},reason:'restore immutable initial value'}},
      {id:'return',kind:'return',label:'Return',value:'{{nodes.reset.contextVersion}}'},
    ],[{id:'a',source:'input',target:'inject',port:'next'},{id:'b',source:'inject',target:'reset',port:'next'},{id:'c',source:'reset',target:'return',port:'next'}]);
    const run=await engine.test(actor,definition,{data:{original:true},secret:'s'},'initial-reset');
    expect(run.context!.value).toMatchObject({working:{changed:true},restored:{'/input/data':{original:true}}});
    const invalid=structuredClone(definition);if(invalid.nodes[2].kind!=='context-lifecycle')throw Error();invalid.nodes[2].lifecycle.paths=['/working'];
    const failed=await engine.test(actor,invalid,{data:{original:true},secret:'s'},'initial-never-current');
    expect(failed).toMatchObject({state:'failed',context:{version:1,value:{working:{changed:true}}}});
  });
  it('removes array selections in descending index order and rejects unsafe compact paths before inference',()=>{
    const state=initialContext({});state.value.items=['a','b','c','d'];
    const compacted=lifecycleMutation(state,'/summary','kept',['/items/1','/items/3'],{id:'a'.repeat(64),operation:'compact',documentId:'a'.repeat(64),sha256:'b'.repeat(64),bytes:1,paths:['/items/1','/items/3'],removedPaths:['/items/1','/items/3'],reason:'',sourceVersion:0,createdAt:new Date().toISOString()});
    expect(compacted.value).toMatchObject({items:['a','c'],summary:'kept'});
    expect(()=>validateLifecycle({operation:'compact',target:'/summary',paths:['/input/data'],instructions:'x'})).toThrow(/immutable/);
    expect(()=>validateLifecycle({operation:'compact',target:'/summary',paths:['/items','/items/0'],instructions:'x'})).toThrow(/overlap/);
  });
  it('does not publish lifecycle context or source metadata when later output validation rejects the node',async()=>{
    const {directory,value}=storage(),definition=primary();definition.limits.maxOutputBytes=128;
    const run=await new Engine(value,host(),{documentDirectory:join(directory,'documents')}).test(actor,definition,{data:{x:1},secret:'s'},'lifecycle-output-fault');
    expect(run).toMatchObject({state:'failed',context:{version:0,value:{input:{data:{x:1},secret:'s'}}}});expect(run.context!.sources).toBeUndefined();
    expect(run.trace.find(item=>item.nodeId==='inject')?.state).toBe('failed');
  });
  it('validates authored lifecycle output schema before accepting a context checkpoint',async()=>{
    const {directory,value}=storage(),definition=single({operation:'inject',target:'/copy',paths:['/input/data'],value:{literalJson:'0'}});
    definition.nodes[1].outputSchema={type:'string'};
    const run=await new Engine(value,host(),{documentDirectory:join(directory,'documents')}).test(actor,definition,{data:{},secret:'s'},'lifecycle-output-schema');
    expect(run).toMatchObject({state:'failed',context:{version:0}});
    expect(run.trace.find(item=>item.nodeId==='step')?.state).toBe('failed');
  });
  it('does not commit a late model result after cancellation',async()=>{
    const {directory,value}=storage();let resolveCompletion!: (value:{text:string})=>void;
    const complete=vi.fn(()=>new Promise<{text:string}>(resolve=>{resolveCompletion=resolve;}));
    const engine=new Engine(value,host(complete),{documentDirectory:join(directory,'documents'),replyTimeoutMs:5});
    const definition=single({operation:'compact',target:'/summary',paths:['/input/data'],instructions:'x',reason:'test cancellation'});
    // The selected path must be mutable, so first create it with an injection.
    definition.nodes.splice(1,0,{id:'seed',kind:'context-lifecycle',label:'Seed',lifecycle:{operation:'inject',target:'/working',paths:['/input/data'],value:{literalJson:'{"x":1}'}}});
    definition.edges=[{id:'a',source:'input',target:'seed',port:'next'},{id:'b',source:'seed',target:'step',port:'next'},{id:'c',source:'step',target:'return',port:'next'}];
    if(definition.nodes[2].kind!=='context-lifecycle')throw Error();definition.nodes[2].lifecycle.paths=['/working'];
    const pending=await engine.test(actor,definition,{data:{},secret:'s'},'cancel-late-compact');
    expect(pending.state).toBe('running');expect(complete).toHaveBeenCalledTimes(1);
    engine.cancel(actor,pending.id);resolveCompletion({text:'late'});
    await new Promise(resolve=>setTimeout(resolve,20));
    const cancelled=engine.status(actor,pending.id);
    expect(cancelled).toMatchObject({state:'cancelled',context:{version:1,value:{working:{x:1}}}});
    expect(cancelled.context!.sources).toHaveLength(1);
  });
  it('does not publish a lifecycle mutation when document creation fails',async()=>{
    const {directory,value}=storage(),blocked=join(directory,'not-a-directory');writeFileSync(blocked,'blocked');
    const run=await new Engine(value,host(),{documentDirectory:blocked}).test(actor,primary(),{data:{x:1},secret:'s'},'document-fault');
    expect(run).toMatchObject({state:'failed',context:{version:0,value:{input:{data:{x:1},secret:'s'}}}});
  });
  it('rolls back a lifecycle mutation on a failed SQLite checkpoint while retaining its prewritten evidence',async()=>{
    const {directory,value}=storage(),fault=new DatabaseSync(join(directory,'loops.sqlite'));cleanups.push(()=>{try{fault.close();}catch{/* closed below */}});
    fault.exec("CREATE TRIGGER reject_lifecycle_context BEFORE UPDATE ON runs WHEN json_extract(NEW.record,'$.context.version')=1 BEGIN SELECT RAISE(ABORT,'Injected lifecycle checkpoint failure'); END;");
    const engine=new Engine(value,host(),{documentDirectory:join(directory,'documents')});
    const run=await engine.test(actor,primary(),{data:{x:1},secret:'s'},'lifecycle-checkpoint-fault');
    expect(run).toMatchObject({state:'failed',context:{version:0,value:{input:{data:{x:1},secret:'s'}}}});
    expect(readdirSync(join(directory,'documents')).some(name=>name.startsWith('document-'))).toBe(true);
    fault.exec('DROP TRIGGER reject_lifecycle_context');fault.close();await engine.close();
    const reopened=new SqliteStorage(join(directory,'loops.sqlite'));cleanups.push(()=>reopened.close());
    expect(new Engine(reopened,host(),{documentDirectory:join(directory,'documents')}).status(actor,run.id).context).toMatchObject({version:0,value:{input:{data:{x:1},secret:'s'}}});
  });
});

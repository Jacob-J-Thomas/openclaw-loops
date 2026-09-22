import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import {initialContext,projectContext,type ContextPatch,type ContextProjection} from '../src/context.js';
import {SqliteStorage} from '../src/storage.js';
import {parseDefinition,validateGraph,type Definition} from '../src/graph.js';

const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const actor:Actor={agentId:'main',sessionKey:'agent:main:context',sessionId:'context-session',source:'tool',human:false,check:()=>{}};
const host=():HostCapabilities=>({check:()=>{},modelInfo:async()=>({provider:'fixture',model:'fixture'}),complete:vi.fn(async()=>({text:'{"title":"model"}'}))});
const context=(projection:ContextProjection,patch:ContextPatch)=>({version:1 as const,projection,patch} as const);
function definition():Definition{return {schemaVersion:3,id:'context-fixture',slug:'context-fixture',name:'Context fixture',description:'Explicit context mechanics.',revision:0,inputSchema:[{name:'data',label:'Data',type:'json',required:true}],capabilities:['model-info'],limits:{maxExecutions:20,maxOutputBytes:4096},
  nodes:[
    {id:'input',kind:'input',label:'Input',context:context({mode:'omit'},{mode:'replace',target:'/items',source:{kind:'literal',value:{literalJson:'[]'}}})},
    {id:'append',kind:'condition',label:'Append',predicate:{left:'true',op:'truthy',right:''},context:context({mode:'omit'},{mode:'append',target:'/items',source:{kind:'literal',value:{literalJson:'null'}}})},
    {id:'escaped',kind:'action',label:'Escaped',capability:'model-info',context:context({mode:'omit'},{mode:'replace',target:'/a~1b',source:{kind:'literal',value:{literalJson:'0'}}})},
    {id:'meta',kind:'action',label:'Meta',capability:'model-info',context:context({mode:'omit'},{mode:'replace',target:'/meta',source:{kind:'literal',value:{literalJson:'{"zero":0}'}}})},
    {id:'return',kind:'return',label:'Return',value:'{{context.input.data.items.2}}',context:context({mode:'consume',paths:['/input/data/items/2']},{mode:'merge',target:'/meta',source:{kind:'literal',value:{literalJson:'{"nullable":null}'}}})},
  ],
  edges:[{id:'input-append',source:'input',target:'append',port:'next'},{id:'append-escaped-true',source:'append',target:'escaped',port:'true'},{id:'append-escaped-false',source:'append',target:'escaped',port:'false'},{id:'escaped-meta',source:'escaped',target:'meta',port:'next'},{id:'meta-return',source:'meta',target:'return',port:'next'}],layout:{}};}
function storage(){const directory=mkdtempSync(join(tmpdir(),'loops-context-')),file=join(directory,'loops.sqlite'),value=new SqliteStorage(file);cleanups.push(async()=>{await value.close();rmSync(directory,{recursive:true,force:true});});return {file,value};}
function parkedDefinition(kind:'wait'|'review',slug=`context-${kind}`):Definition{
  const park=kind==='wait'?{id:'park',kind:'wait' as const,label:'Wait',message:'Continue',context:context({mode:'omit'},{mode:'append',target:'/events',source:{kind:'output'}})}:{id:'park',kind:'review' as const,label:'Review',proposal:'Decide',context:context({mode:'omit'},{mode:'append',target:'/events',source:{kind:'output'}})};
  return {schemaVersion:3,id:slug,slug,name:'Parked context',description:'Durable context fixture.',revision:0,inputSchema:[],capabilities:[],limits:{maxExecutions:20,maxOutputBytes:4096},nodes:[
    {id:'input',kind:'input',label:'Input',context:context({mode:'omit'},{mode:'replace',target:'/events',source:{kind:'literal',value:{literalJson:'[]'}}})},park,
    {id:'return',kind:'return',label:'Return',value:'done'},...kind==='review'?[{id:'fail',kind:'fail' as const,label:'Fail',reason:'rejected'}]:[],
  ],edges:[{id:'input-park',source:'input',target:'park',port:'next'},...kind==='wait'?[{id:'park-return',source:'park',target:'return',port:'next'}]:[{id:'park-return',source:'park',target:'return',port:'approve'},{id:'park-fail',source:'park',target:'fail',port:'reject'}]],layout:{}} as Definition;
}
function restartDefinition():Definition{return {schemaVersion:3,id:'restart-context',slug:'restart-context',name:'Restart context',description:'Restart fixture.',revision:0,inputSchema:[],capabilities:['llm'],limits:{maxExecutions:20,maxOutputBytes:4096},nodes:[
  {id:'input',kind:'input',label:'Input'},{id:'infer',kind:'inference',label:'Inference',prompt:'Fresh output',output:'text',context:context({mode:'omit'},{mode:'replace',target:'/last',source:{kind:'output'}})},
  {id:'wait',kind:'wait',label:'Wait',message:'Checkpoint'},{id:'return',kind:'return',label:'Return',value:'done'},
],edges:[{id:'input-infer',source:'input',target:'infer',port:'next'},{id:'infer-wait',source:'infer',target:'wait',port:'next'},{id:'wait-return',source:'wait',target:'return',port:'next'}],layout:{}};}
function repeatChildValidationDefinition():Definition{return {schemaVersion:3,id:'repeat-context',slug:'repeat-context',name:'Repeat context',description:'Nested context validation fixture.',revision:0,inputSchema:[],capabilities:['llm'],limits:{maxExecutions:20,maxOutputBytes:4096},nodes:[
  {id:'input',kind:'input',label:'Input'},
  {id:'repeat',kind:'repeat',label:'Repeat',maxIterations:1,context:context({mode:'consume',paths:['/allowed']},{mode:'omit'}),body:[
    {id:'draft',kind:'inference',label:'Draft',prompt:'{{context.allowed}}',output:'text',context:context({mode:'omit'},{mode:'replace',target:'/child',source:{kind:'literal',value:{literalJson:'{'}}})},
    {id:'check',kind:'condition',label:'Check',predicate:{left:'true',op:'truthy',right:''}},
  ]},
  {id:'return',kind:'return',label:'Return',value:'done'},
],edges:[{id:'input-repeat',source:'input',target:'repeat',port:'next'},{id:'repeat-return',source:'repeat',target:'return',port:'next'}],layout:{}} as Definition;}

describe('version 3 shared context',()=>{
  it('projects only declared values and persists successful append, merge, null, zero, and escaped-key patches across restart',async()=>{
    const {file,value}=storage(),capabilities=host(),engine=new Engine(value,capabilities),d=definition();expect(validateGraph(d)).toEqual([]);
    expect(projectContext(initialContext({data:{items:['first','second','third']}}),d.nodes[4].context)).toEqual({input:{data:{items:{2:'third'}}}});
    const first=await engine.test(actor,d,{data:{items:['first','second','third'],secret:'hidden'}},'context-run');
    expect(first).toMatchObject({state:'completed',result:'third',context:{version:5,value:{input:{data:{items:['first','second','third'],secret:'hidden'}},items:[null],'a/b':0,meta:{zero:0,nullable:null}},journal:[
      {nodeId:'input',baseVersion:0,version:1,mode:'replace',target:'/items',source:{kind:'literal'}},{nodeId:'append',baseVersion:1,version:2,mode:'append',target:'/items',source:{kind:'literal'}},{nodeId:'escaped',baseVersion:2,version:3,mode:'replace',target:'/a~1b',source:{kind:'literal'}},{nodeId:'meta',baseVersion:3,version:4,mode:'replace',target:'/meta',source:{kind:'literal'}},{nodeId:'return',baseVersion:4,version:5,mode:'merge',target:'/meta',source:{kind:'literal'}}]}});
    expect(first.context!.journal.every(entry=>/^[a-f0-9]{64}$/.test(entry.valueSha256)&&entry.valueBytes>=0)).toBe(true);
    expect(first.context!.journal[0].valueSha256).toBe(createHash('sha256').update('[]').digest('hex'));
    await engine.close();const reopened=new SqliteStorage(file);cleanups.push(()=>reopened.close());const again=new Engine(reopened,capabilities);
    expect(again.status(actor,first.id).context).toEqual(first.context);expect((await again.test(actor,d,{data:{items:['first','second','third'],secret:'hidden'}},'context-run')).id).toBe(first.id);
  });
  it('rejects hidden bindings, unsafe pointers, immutable targets, and malformed paths during authoring validation',()=>{
    const hidden=definition();if(hidden.nodes[4].kind!=='return')throw Error();hidden.nodes[4].value='{{context.input.data.secret}}';expect(validateGraph(hidden).map(issue=>issue.message).join(' ')).toMatch(/not projected/);
    const unsafe=definition();unsafe.nodes[0].context!.patch={mode:'replace',target:'/__proto__/polluted',source:{kind:'output'}};expect(validateGraph(unsafe).map(issue=>issue.message).join(' ')).toMatch(/Invalid context path/);
    const immutable=definition();immutable.nodes[0].context!.patch={mode:'merge',target:'/input',source:{kind:'literal',value:{literalJson:'{}'}}};expect(validateGraph(immutable).map(issue=>issue.message).join(' ')).toMatch(/immutable/);
    const malformed=definition();malformed.nodes[0].context!.patch={mode:'replace',target:'/bad~2path',source:{kind:'output'}};expect(validateGraph(malformed).map(issue=>issue.message).join(' ')).toMatch(/escape/);
  });
  it('rolls back a rejected context checkpoint and retains the failed admission across restart without replaying it',async()=>{
    const {file,value}=storage(),engine=new Engine(value,host()),fault=new DatabaseSync(file);cleanups.push(()=>{try{fault.close();}catch{/* closed after the restart assertion */}});
    fault.exec("CREATE TRIGGER reject_first_context BEFORE UPDATE ON runs WHEN json_extract(NEW.record,'$.context.version')=1 BEGIN SELECT RAISE(ABORT,'Injected context commit failure'); END;");
    const failed=await engine.test(actor,definition(),{data:{items:['first','second','third']}},'context-commit-fault');
    expect(failed).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_STORAGE_CONFLICT',phase:'storage'},context:{version:0,journal:[]}});expect(JSON.stringify(failed)).not.toContain('Injected context commit failure');
    const saved=engine.status(actor,failed.id);await engine.close();fault.close();
    const reopened=new SqliteStorage(file);cleanups.push(()=>reopened.close());const again=new Engine(reopened,host());expect(again.status(actor,failed.id)).toEqual(saved);expect((await again.test(actor,definition(),{data:{items:['first','second','third']}},'context-commit-fault')).id).toBe(failed.id);
  });
  it('defers Wait and Human review context patches until their final outcomes, including rejection and cancellation',async()=>{
    const {value}=storage(),engine=new Engine(value,host());
    const cancelled=await engine.test(actor,parkedDefinition('wait','cancelled-wait'),{},'cancelled-wait');expect(cancelled).toMatchObject({state:'waiting',context:{version:1,journal:[{nodeId:'input'}]}});expect(cancelled.outputs.park).toBeUndefined();
    expect(engine.cancel(actor,cancelled.id)).toMatchObject({state:'cancelled',context:{version:1,journal:[{nodeId:'input'}]}});expect(engine.status(actor,cancelled.id).outputs.park).toBeUndefined();
    const waited=await engine.test(actor,parkedDefinition('wait','resumed-wait'),{},'resumed-wait');const resumed=await engine.resume(actor,waited.id);expect(resumed).toMatchObject({state:'completed',outputs:{park:{}},context:{version:2,value:{input:{},events:[{}]},journal:[{nodeId:'input'},{nodeId:'park',source:{kind:'output'}}]}});
    const approved=await engine.test(actor,parkedDefinition('review','approved-review'),{},'approved-review');expect(approved.outputs.park).toBeUndefined();const accepted=await engine.review({...actor,human:true,source:'session-action',requester:'operator'},approved.id,'approve');expect(accepted).toMatchObject({state:'completed',outputs:{park:{decision:'approve'}},context:{version:2,value:{input:{},events:[{decision:'approve'}]},journal:[{nodeId:'input'},{nodeId:'park',source:{kind:'output'}}]}});
    const rejected=await engine.test(actor,parkedDefinition('review','rejected-review'),{},'rejected-review');const declined=await engine.review({...actor,human:true,source:'session-action',requester:'operator'},rejected.id,'reject');expect(declined).toMatchObject({state:'failed',outputs:{park:{decision:'reject'}},context:{version:2,value:{input:{},events:[{decision:'reject'}]},journal:[{nodeId:'input'},{nodeId:'park',source:{kind:'output'}}]}});
  });
  it('rolls back a deferred Wait patch atomically when its resume checkpoint cannot persist',async()=>{
    const {file,value}=storage(),engine=new Engine(value,host()),parked=await engine.test(actor,parkedDefinition('wait','rollback-wait'),{},'rollback-wait'),fault=new DatabaseSync(file);cleanups.push(()=>{try{fault.close();}catch{/* closed after the restart assertion */}});
    fault.exec("CREATE TRIGGER reject_wait_context BEFORE UPDATE ON runs WHEN json_extract(NEW.record,'$.context.version')=2 BEGIN SELECT RAISE(ABORT,'Injected resumed context failure'); END;");
    await expect(engine.resume(actor,parked.id)).rejects.toThrow();const saved=engine.status(actor,parked.id);expect(saved).toMatchObject({state:'waiting',context:{version:1,journal:[{nodeId:'input'}]}});expect(saved.outputs.park).toBeUndefined();
    await engine.close();fault.close();const reopened=new SqliteStorage(file);cleanups.push(()=>reopened.close());expect(new Engine(reopened,host()).status(actor,parked.id)).toEqual(saved);
  });
  it('restarts v3 runs from initial input context rather than cloning prior patch history',async()=>{
    const {value}=storage(),capabilities=host();vi.mocked(capabilities.complete).mockResolvedValueOnce({text:'first'}).mockResolvedValueOnce({text:'second'});const engine=new Engine(value,capabilities),first=await engine.test(actor,restartDefinition(),{},'first-context');expect(first).toMatchObject({state:'waiting',context:{version:1,value:{input:{},last:{text:'first'}},journal:[{nodeId:'infer',baseVersion:0}]}});
    engine.cancel(actor,first.id);const restarted=await engine.retry(actor,first.id,'restart','restart-context');expect(restarted).toMatchObject({state:'waiting',parentRunId:first.id,outputs:{infer:{text:'second'}},context:{version:1,value:{input:{},last:{text:'second'}},journal:[{nodeId:'infer',baseVersion:0,version:1}]}});expect(restarted.trace.map(entry=>entry.nodeId)).toEqual(['input','infer','wait']);expect(vi.mocked(capabilities.complete)).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed context literals and unprojected bindings in Repeat children before host execution',()=>{
    const candidate=repeatChildValidationDefinition();expect(parseDefinition(candidate)).toEqual(candidate);const issues=validateGraph(candidate);expect(issues.filter(issue=>issue.nodeId==='draft').map(issue=>issue.message).join(' ')).toMatch(/not projected.*Literal JSON|Literal JSON.*not projected/);
  });
  it('validates full Repeat-child patch bindings with child projection, body order, and repeat scope',()=>{
    const invalid=repeatChildValidationDefinition(),repeat=invalid.nodes.find(node=>node.kind==='repeat')!,draft=repeat.body[0] as typeof repeat.body[0]&{context:ReturnType<typeof context>};
    draft.context=context({mode:'consume',paths:['/allowed']},{mode:'replace',target:'/child',source:{kind:'literal',value:'{{bogus}} {{input.missing}} {{nodes.check.value}} {{context.}}'}});
    const messages=validateGraph(invalid).filter(issue=>issue.nodeId==='draft').map(issue=>issue.message).join(' ');expect(messages).toMatch(/Unsupported binding: bogus/);expect(messages).toMatch(/Unknown input: missing/);expect(messages).toMatch(/not guaranteed to have executed/);expect(messages).toMatch(/Unsupported binding: context/);
    const valid=repeatChildValidationDefinition(),validRepeat=valid.nodes.find(node=>node.kind==='repeat')!,validDraft=validRepeat.body[0] as typeof validRepeat.body[0]&{context:ReturnType<typeof context>};
    validRepeat.context=context({mode:'omit'},{mode:'omit'});validDraft.context=context({mode:'consume',paths:['/allowed']},{mode:'replace',target:'/child',source:{kind:'literal',value:'{{context.allowed}}'}});validDraft.prompt='{{repeat.index}} {{context.allowed}}';validRepeat.body[1].predicate={left:'{{nodes.draft.text}}',op:'contains',right:'ok'};
    expect(parseDefinition(valid)).toEqual(valid);expect(validateGraph(valid)).toEqual([]);
  });
  it('round-trips the public v3 definition schema',()=>{expect(parseDefinition(definition())).toMatchObject({schemaVersion:3});});
  it('keeps ordinary creation at v2 and requires an explicit v3 selection for context',()=>{
    const {value}=storage(),engine=new Engine(value,host()),v3=definition(),{id:_id,revision:_revision,schemaVersion:_version,...content}=v3;
    const ordinary={...content,nodes:content.nodes.map(({context:_context,...node})=>node)};
    expect(engine.create(actor,ordinary,false).record.definition.schemaVersion).toBe(2);
    expect(()=>engine.create(actor,content,false)).toThrow(/schemaVersion/);
    expect(engine.create(actor,{...content,slug:'explicit-v3',schemaVersion:3},false).record.definition).toMatchObject({schemaVersion:3,nodes:v3.nodes});
  });
});

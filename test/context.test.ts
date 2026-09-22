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
  it('round-trips the public v3 definition schema',()=>{expect(parseDefinition(definition())).toMatchObject({schemaVersion:3});});
  it('keeps ordinary creation at v2 and requires an explicit v3 selection for context',()=>{
    const {value}=storage(),engine=new Engine(value,host()),v3=definition(),{id:_id,revision:_revision,schemaVersion:_version,...content}=v3;
    const ordinary={...content,nodes:content.nodes.map(({context:_context,...node})=>node)};
    expect(engine.create(actor,ordinary,false).record.definition.schemaVersion).toBe(2);
    expect(()=>engine.create(actor,content,false)).toThrow(/schemaVersion/);
    expect(engine.create(actor,{...content,slug:'explicit-v3',schemaVersion:3},false).record.definition).toMatchObject({schemaVersion:3,nodes:v3.nodes});
  });
});

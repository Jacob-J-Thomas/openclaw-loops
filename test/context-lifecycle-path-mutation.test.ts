import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {DocumentStore} from '../src/document-store.js';
import {initialContext} from '../src/context.js';
import {lifecycleMutation,validateLifecycle,type ContextLifecycle} from '../src/context-lifecycle.js';
import {validateGraph,type Definition} from '../src/graph.js';

const cleanup:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const dispose of cleanup.splice(0).reverse())await dispose();});
const actor:Actor={agentId:'main',sessionKey:'lifecycle-paths',sessionId:'lifecycle-paths',source:'tool',human:false,check:()=>{}};
const source=(sourceVersion:number,paths:string[])=>({id:'a'.repeat(64),operation:'compact' as const,documentId:'a'.repeat(64),sha256:'b'.repeat(64),bytes:1,paths,removedPaths:paths,reason:'bounded compact',sourceVersion,createdAt:'2026-09-25T00:00:00.000Z'});
const directory=()=>{const root=mkdtempSync(join(tmpdir(),'loops-lifecycle-paths-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));return root;};
const definition=(operation:'summarize'|'compact',target:string,paths:string[]):Definition=>({schemaVersion:3,id:'path-fixture',slug:'path-fixture',name:'Path fixture',description:'',revision:0,inputSchema:[{name:'data',label:'Data',type:'json',required:true}],capabilities:['llm'],limits:{maxExecutions:8,maxOutputBytes:4096},nodes:[
  {id:'input',kind:'input',label:'Input'},
  {id:'seed',kind:'context-lifecycle',label:'Seed',lifecycle:{operation:'inject',target:'/working',paths:['/input/data'],value:{literalJson:'{"fact":{"value":"original"},"a/b":0,"a":{"b":"nested"},"🙂":null}'}}},
  {id:'step',kind:'context-lifecycle',label:'Step',lifecycle:{operation,target,paths,instructions:'Retain only these selected values.',...operation==='compact'?{reason:'Authored compact'}:{}}},
  {id:'return',kind:'return',label:'Return',value:'{{nodes.step.contextVersion}}'},
],edges:[{id:'a',source:'input',target:'seed',port:'next'},{id:'b',source:'seed',target:'step',port:'next'},{id:'c',source:'step',target:'return',port:'next'}],layout:{}});

describe('context lifecycle path mutation',()=>{
  it('rejects summarize equality and ancestor/descendant overlaps before completion or state mutation',async()=>{
    const root=directory(),storage=new SqliteStorage(join(root,'loops.sqlite')),complete=vi.fn(async()=>({text:'SUMMARY'}));
    const host:HostCapabilities={check:()=>{},modelInfo:async()=>({}),complete};
    const engine=new Engine(storage,host,{documentDirectory:join(root,'documents')});cleanup.push(()=>engine.close());
    const before=storage.read();
    for(const [target,paths] of [
      ['/working/fact',['/working/fact']],
      ['/working',['/working/fact']],
      ['/working/fact/value',['/working/fact']],
      ['/working/a~1b',['/working/a~1b']],
      ['/working/🙂',['/working/🙂']],
    ] as const){
      const config:ContextLifecycle={operation:'summarize',target,paths:[...paths],instructions:'Retain only these selected values.'};
      expect(()=>validateLifecycle(config),`${target}/${paths}`).toThrow(/Summarize target must not overlap a selected path/);
      const graph=definition('summarize',target,[...paths]);
      expect(validateGraph(graph).map(issue=>issue.message).join(' ')).toMatch(/Summarize target must not overlap a selected path/);
      await expect(engine.test(actor,graph,{data:{source:true}},`overlap-${target}`)).rejects.toThrow();
      expect(storage.read()).toEqual(before);
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it('allows segment-disjoint nested, escaped, and Unicode selections and preserves their live values',async()=>{
    expect(()=>validateLifecycle({operation:'summarize',target:'/working/a~1b',paths:['/working/a/b'],instructions:'Keep nested'})).not.toThrow();
    const root=directory(),storage=new SqliteStorage(join(root,'loops.sqlite')),complete=vi.fn(async()=>({text:'SUMMARY'}));
    const engine=new Engine(storage,{check:()=>{},modelInfo:async()=>({}),complete},{documentDirectory:join(root,'documents')});cleanup.push(()=>engine.close());
    const graph=definition('summarize','/summary',['/working/fact/value','/working/a~1b','/working/🙂']);
    expect(validateGraph(graph)).toEqual([]);
    const run=await engine.test(actor,graph,{data:{source:true}},'disjoint-summary');
    expect(run).toMatchObject({state:'completed',context:{version:2,value:{working:{fact:{value:'original'},'a/b':0,a:{b:'nested'},'🙂':null},summary:'SUMMARY'}}});
    expect(run.context!.sources?.at(-1)).toMatchObject({operation:'summarize',removedPaths:[]});
    const escaped=definition('summarize','/working/a~1b',['/working/a/b']);
    expect(validateGraph(escaped)).toEqual([]);
    const second=await engine.test(actor,escaped,{data:{source:true}},'escaped-disjoint-summary');
    expect(second).toMatchObject({state:'completed',context:{value:{working:{'a/b':'SUMMARY',a:{b:'nested'}}}}});
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('writes compact targets in original array coordinates before sorted removals',()=>{
    const cases:Array<{value:Record<string,unknown>;target:string;removed:string[];replacement:unknown;expected:Record<string,unknown>}>= [
      {value:{items:['selected A','target B','unselected C']},target:'/items/1',removed:['/items/0'],replacement:'SUMMARY',expected:{items:['SUMMARY','unselected C']}},
      {value:{items:['target A','middle B','selected C']},target:'/items/0',removed:['/items/2'],replacement:'SUMMARY',expected:{items:['SUMMARY','middle B']}},
      {value:{items:['selected A','unselected B','target C','selected D','unselected E']},target:'/items/2',removed:['/items/0','/items/3'],replacement:'SUMMARY',expected:{items:['unselected B','SUMMARY','unselected E']}},
      {value:{items:['selected A','unselected B','unselected C']},target:'/items/3',removed:['/items/0'],replacement:'APPEND',expected:{items:['unselected B','unselected C','APPEND']}},
      {value:{items:[{value:'selected A'},{value:'target B'},{value:'unselected C'}]},target:'/items/1/value',removed:['/items/0'],replacement:'SUMMARY',expected:{items:[{value:'SUMMARY'},{value:'unselected C'}]}},
      {value:{groups:[{items:[{value:0},{value:null},{value:'🦊 café'}]}]},target:'/groups/0/items/1/value',removed:['/groups/0/items/0'],replacement:'SUMMARY',expected:{groups:[{items:[{value:'SUMMARY'},{value:'🦊 café'}]}]}},
    ];
    for(const fixture of cases){
      const state=initialContext({});Object.assign(state.value,fixture.value);const before=structuredClone(state);
      const next=lifecycleMutation(state,fixture.target,fixture.replacement as never,fixture.removed,source(0,fixture.removed));
      expect(next.value,fixture.target).toEqual({input:{},...fixture.expected});
      expect(next.sources?.at(-1)).toMatchObject({paths:fixture.removed,removedPaths:fixture.removed,sourceVersion:0,targetVersion:1});
      expect(state).toEqual(before);
    }
  });

  it('retains exact pre-loss source values in a completed Compact and leaves committed state unchanged on errors',async()=>{
    const root=directory(),storage=new SqliteStorage(join(root,'loops.sqlite')),complete=vi.fn(async()=>({text:'SUMMARY'}));
    const engine=new Engine(storage,{check:()=>{},modelInfo:async()=>({}),complete},{documentDirectory:join(root,'documents')});cleanup.push(()=>engine.close());
    const graph=definition('compact','/working/1',['/working/0']);
    graph.nodes[1]={id:'seed',kind:'context-lifecycle',label:'Seed',lifecycle:{operation:'inject',target:'/working',paths:['/input/data'],value:'{{input.data}}'}};
    const run=await engine.test(actor,graph,{data:['selected A','target B','unselected C']},'array-compact');
    expect(run).toMatchObject({state:'completed',context:{version:2,value:{working:['SUMMARY','unselected C']}}});
    expect(complete).toHaveBeenCalledOnce();
    const retained=run.context!.sources![1]!;
    expect(retained).toMatchObject({operation:'compact',paths:['/working/0'],removedPaths:['/working/0'],sourceVersion:1,targetVersion:2});
    expect(JSON.parse(new DocumentStore(join(root,'documents')).read(actor,retained.id).text)).toEqual({'/working/0':'selected A','/working/1':'target B'});
    const state=initialContext({});state.value.items=['selected A','target B','unselected C'];const before=structuredClone(state);
    expect(()=>lifecycleMutation(state,'/items/1','SUMMARY',['/items/0','/items/1'],source(0,['/items/0','/items/1']))).toThrow(/overlap/);
    expect(()=>lifecycleMutation(state,'/items/9','SUMMARY',['/items/0'],source(0,['/items/0']))).toThrow(/unavailable/);
    expect(()=>lifecycleMutation(state,'/items/1','SUMMARY',['/items/9'],source(0,['/items/9']))).toThrow(/unavailable/);
    expect(state).toEqual(before);
  });
});

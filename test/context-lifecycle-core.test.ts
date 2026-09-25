import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {applyContextPatch,assertContextState,initialContext,type ContextPatch,type ContextState} from '../src/context.js';
import {lifecycleMutation,lifecycleValue,selectRetainedSource,validateLifecycle,type LifecycleSourceRecord} from '../src/context-lifecycle.js';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import type {Definition} from '../src/graph.js';
import type {Json} from '../src/node-values.js';
import {SqliteStorage} from '../src/storage.js';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const source=(version:number):Omit<LifecycleSourceRecord,'targetVersion'>=>({id:'a'.repeat(64),operation:'inject',documentId:'a'.repeat(64),sha256:'b'.repeat(64),bytes:12,paths:['/input/data'],removedPaths:[],reason:'explicit test source',sourceVersion:version,createdAt:'2026-09-24T00:00:00.000Z'});
const patch=(state:ContextState,mode:'append'|'replace'|'merge',target:string,value:Json):ContextState=>{
  const config:{version:1;projection:{mode:'omit'};patch:ContextPatch}={version:1,projection:{mode:'omit'},patch:{mode,target,source:{kind:'output'}}};
  return applyContextPatch(state,`patch-${mode}`,config,value,()=>{throw Error('No literal binding expected.');},digest);
};

describe('context lifecycle core recovery',()=>{
  it('keeps one continuous ordered provenance across append, lifecycle, replace and merge after serialization',()=>{
    const initial=initialContext({data:{zero:0}});initial.value.items=[0];initial.value.meta={first:true};
    const appended=patch(initial,'append','/items',null);
    const retained=lifecycleMutation(appended,'/summary','α',[],source(appended.version));
    const replaced=patch(retained,'replace','/summary','updated');
    const merged=patch(replaced,'merge','/meta',{second:false});
    const restored=JSON.parse(JSON.stringify(merged)) as ContextState;
    expect(()=>assertContextState(restored)).not.toThrow();
    expect(restored).toMatchObject({version:4,value:{items:[0,null],summary:'updated',meta:{first:true,second:false}},journal:[{baseVersion:0,version:1},{baseVersion:2,version:3},{baseVersion:3,version:4}],sources:[{sourceVersion:1,targetVersion:2,operation:'inject'}]});
    expect(initial.version).toBe(0);
    expect(appended.sources).toBeUndefined();
    expect(retained.sources).toHaveLength(1);
  });

  it('reads the mixed provenance and source record from a reopened SQLite run',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-lifecycle-core-')),file=join(directory,'loops.sqlite');
    const actor:Actor={agentId:'main',sessionKey:'agent:main:lifecycle-core',sessionId:'lifecycle-core',source:'tool',human:false,check:()=>{}};
    const host:HostCapabilities={check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'unused'})};
    const definition:Definition={schemaVersion:3,id:'lifecycle-core',slug:'lifecycle-core',name:'Lifecycle core',description:'Mixed context persistence fixture.',revision:0,inputSchema:[],capabilities:[],limits:{maxExecutions:4,maxOutputBytes:2048},nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'done'}],edges:[{id:'next',source:'input',target:'return',port:'next'}],layout:{}};
    const storage=new SqliteStorage(file);let reopened:SqliteStorage|undefined;
    try{
      const engine=new Engine(storage,host),run=await engine.test(actor,definition,{},'mixed-context-restart');
      expect(run.state).toBe('completed');
      const first=patch(run.context!,'replace','/working',0);
      const second=lifecycleMutation(first,'/summary','α',[],source(first.version));
      const third=patch(second,'replace','/working',null);
      storage.writeRun({...run,context:third});
      await storage.close();
      reopened=new SqliteStorage(file);
      expect(new Engine(reopened,host).status(actor,run.id).context).toEqual(third);
    }finally{
      await storage.close();
      await reopened?.close();
      rmSync(directory,{recursive:true,force:true});
    }
  });

  it('rejects missing, duplicated and out-of-order provenance across both record kinds',()=>{
    const initial=initialContext({data:0});
    const first=patch(initial,'replace','/working',0);
    const retained=lifecycleMutation(first,'/summary','x',[],source(first.version));
    const final=patch(retained,'replace','/working',1);
    const missing=structuredClone(final);delete missing.sources;
    expect(()=>assertContextState(missing)).toThrow(/provenance|version/);
    const duplicated=structuredClone(final);duplicated.sources![0]!.sourceVersion=0;duplicated.sources![0]!.targetVersion=1;
    expect(()=>assertContextState(duplicated)).toThrow(/provenance/);
    const reordered=structuredClone(final);reordered.journal.reverse();
    expect(()=>assertContextState(reordered)).toThrow(/journal order/);
    expect(()=>lifecycleMutation(first,'/summary','x',[],source(0))).toThrow(/version/);
  });

  it('selects only authored paths from a retained lifecycle snapshot or an ordinary document',()=>{
    const snapshot={'/input/data':{zero:0,text:'🙂'},'/input/secret':'do not expose'};
    expect(selectRetainedSource(snapshot,['/input/data'],'snapshot')).toEqual({'/input/data':{zero:0,text:'🙂'}});
    expect(selectRetainedSource({input:{data:null,secret:'do not expose'}},['/input/data'],'document')).toEqual({'/input/data':null});
    expect(()=>selectRetainedSource(snapshot,['/input/missing'],'snapshot')).toThrow(/unavailable/);
    expect(()=>selectRetainedSource(snapshot,['/input/__proto__'],'snapshot')).toThrow(/Invalid context path/);
  });

  it('accepts explicit typed zero, null, false and empty text inject values',()=>{
    for(const value of [{literalJson:'0'},{literalJson:'null'},{literalJson:'false'},''])
      expect(()=>validateLifecycle({operation:'inject',target:'/working',paths:['/input/data'],value})).not.toThrow();
    expect(()=>validateLifecycle({operation:'inject',target:'/working',paths:['/input/data']})).toThrow(/explicit value/);
    const zero=lifecycleMutation(initialContext({data:0}),'/working',lifecycleValue(0),[],source(0));
    expect(zero.value.working).toBe(0);
    expect(()=>assertContextState(JSON.parse(JSON.stringify(zero)))).not.toThrow();
  });
});

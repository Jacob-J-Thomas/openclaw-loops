import {afterEach,describe,expect,it} from 'vitest';
import {Engine,type Actor,type State,type Storage} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const actor:Actor={agentId:'main',sessionKey:'agent:main:versions',sessionId:'versions',source:'tool',human:false,check:()=>{}};
const close:Array<()=>Promise<void>>=[];
const directories:string[]=[];
afterEach(async()=>{for(const stop of close.splice(0))await stop();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function setup(initial?:State,file?:string){
  let state=structuredClone(initial),closed=false;
  const storage:Storage=file?new SqliteStorage(file):{read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
  if(file&&initial)storage.write(initial);
  const engine=new Engine(storage,{check:()=>{},modelInfo:async()=>({}),complete:async()=>{throw Error('No inference in this namespace fixture.');}});
  const stop=async()=>{if(!closed){closed=true;await engine.close();}};close.push(stop);return {engine,storage,stop};
}
const content=(slug:string,value=slug,park=false)=>({slug,name:slug,description:'Version namespace fixture',inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},...park?[{id:'wait',kind:'wait',label:'Wait',message:'Hold'}]:[],{id:'return',kind:'return',label:'Return',value}],edges:park?[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'return',port:'next'}]:[{id:'edge',source:'input',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}});
describe('published version namespace',()=>{
  it('rejects publishing an older revision whose slug another loop now owns',()=>{
    const {engine,storage}=setup(),a=engine.create(actor,content('occupied')).record;
    engine.edit(actor,a.definition.id,1,{slug:'renamed'},true);engine.create(actor,content('occupied'));
    const before=storage.read();expect(()=>engine.publish(actor,a.definition.id,1,2)).toThrow(/slug/i);expect(storage.read()).toEqual(before);
  });
  it('rejects recovering a deleted draft whose slug another loop still publishes under an older revision',()=>{
    const {engine,storage}=setup(),a=engine.create(actor,content('occupied')).record;engine.delete(actor,a.definition.id,1);
    const b=engine.create(actor,content('occupied')).record;engine.draft(actor,{...b.definition,slug:'renamed'},1);
    const before=storage.read();expect(()=>engine.recover(actor,a.definition.id,1)).toThrow(/slug/i);expect(storage.read()).toEqual(before);
  });
  it('reserves disabled current draft slugs but permits an old publication once the other loop releases its name',()=>{
    const {engine,storage}=setup(),a=engine.create(actor,content('occupied')).record;
    engine.edit(actor,a.definition.id,1,{slug:'renamed'},true);const b=engine.create(actor,content('occupied'),false).record;
    const before=storage.read();expect(()=>engine.publish(actor,a.definition.id,1,2)).toThrow(/slug/i);expect(storage.read()).toEqual(before);
    engine.edit(actor,b.definition.id,1,{slug:'released'},false);const published=engine.publish(actor,a.definition.id,1,2);
    expect(published.enabledRevision).toBe(1);expect(published.definition.revision).toBe(2);expect(published.revisions?.[1]).toEqual(a.definition);
  });
  it('keeps compatible recovery and same-loop historical publication available',()=>{
    const {engine}=setup(),a=engine.create(actor,content('available')).record;engine.edit(actor,a.definition.id,1,{name:'Version two'},true);
    expect(engine.publish(actor,a.definition.id,1,2).enabledRevision).toBe(1);engine.delete(actor,a.definition.id,2);
    const recovered=engine.recover(actor,a.definition.id,2);expect(recovered.enabledRevision).toBeNull();expect(recovered.revisions?.[1]).toEqual(a.definition);expect(engine.enable(actor,a.definition.id,2,true).enabledRevision).toBe(2);
  });
  it('rejects activation of a conflicting current draft admitted by an older recovery implementation',async()=>{
    const old=setup(),a=old.engine.create(actor,content('occupied')).record;old.engine.delete(actor,a.definition.id,1);
    const b=old.engine.create(actor,content('occupied')).record;old.engine.draft(actor,{...b.definition,slug:'renamed'},1);await old.stop();
    const legacy=old.storage.read()!;delete legacy.loops[a.definition.id].deletedAt;
    const {engine,storage}=setup(legacy),before=storage.read();expect(()=>engine.enable(actor,a.definition.id,1,true)).toThrow(/slug/i);expect(storage.read()).toEqual(before);
  });
  it('refuses a new ambiguous admission from legacy state while preserving pinned retries, continuation and explicit repair',async()=>{
    const old=setup(),a=old.engine.create(actor,content('occupied','Original A',true)).record,parked=await old.engine.run(actor,'occupied',{},'original');
    old.engine.edit(actor,a.definition.id,1,{slug:'renamed'},true);const b=old.engine.create(actor,content('occupied','Distinct B')).record;await old.stop();
    const legacy=old.storage.read()!;legacy.loops[a.definition.id].enabledRevision=1;legacy.loops[a.definition.id].publishedRevision=1;
    const {engine,storage}=setup(legacy),before=storage.read();
    expect(()=>engine.describe(actor,'occupied')).toThrow(/ambiguous/i);
    await expect(engine.run(actor,'occupied',{},'new-request')).rejects.toThrow(/ambiguous/i);expect(storage.read()).toEqual(before);
    expect((await engine.run(actor,'occupied',{},'original')).id).toBe(parked.id);expect((await engine.resume(actor,parked.id)).result).toBe('Original A');
    engine.enable(actor,a.definition.id,2,false);const resolved=await engine.run(actor,'occupied',{},'new-request');expect(resolved.definition.id).toBe(b.definition.id);expect(resolved.result).toBe('Distinct B');
  });
  it('preserves ambiguous historical records through SQLite reopen, refuses dispatch and commits explicit repair',async()=>{
    const old=setup(),a=old.engine.create(actor,content('occupied','Original A')).record;
    old.engine.edit(actor,a.definition.id,1,{slug:'renamed'},true);const b=old.engine.create(actor,content('occupied','Distinct B')).record;await old.stop();
    const legacy=old.storage.read()!;legacy.loops[a.definition.id].enabledRevision=1;legacy.loops[a.definition.id].publishedRevision=1;
    const directory=mkdtempSync(join(tmpdir(),'loops-version-namespace-'));directories.push(directory);const file=join(directory,'loops.sqlite');
    const stored=setup(legacy,file);await stored.stop();const reopened=setup(undefined,file);expect(reopened.storage.read()).toEqual(legacy);
    await expect(reopened.engine.run(actor,'occupied',{},'ambiguous')).rejects.toMatchObject({code:'LOOPS_AMBIGUOUS_SLUG'});expect(reopened.storage.read()).toEqual(legacy);
    reopened.engine.enable(actor,a.definition.id,2,false);const repaired=reopened.storage.read();await reopened.stop();
    const final=setup(undefined,file);expect(final.storage.read()).toEqual(repaired);const run=await final.engine.run(actor,'occupied',{},'ambiguous');expect(run.definition.id).toBe(b.definition.id);expect(run.result).toBe('Distinct B');
  });
});

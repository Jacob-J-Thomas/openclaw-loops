import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Engine,FileStorage,type Actor,type HostCapabilities,type State} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import type {Definition} from '../src/graph.js';

const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const actor:Actor={agentId:'main',sessionKey:'agent:main:retained-source',sessionId:'retention-session',source:'tool',human:false,check:()=>{}};
const foreign:Actor={...actor,sessionKey:'agent:main:foreign',sessionId:'foreign-session'};
const host=():HostCapabilities=>({check:()=>{},modelInfo:async()=>({}),complete:vi.fn(async()=>{throw Error('No completion is authorized in this retention fixture.');})});
const policy={keepLatest:0} as const;
function definition(id:string,nodes:Definition['nodes'],edges:Definition['edges']):Definition{
  return {schemaVersion:3,id,slug:id,name:id,description:'',revision:0,inputSchema:[{name:'data',label:'Data',type:'json',required:true}],capabilities:[],limits:{maxExecutions:12,maxOutputBytes:4096},nodes,edges,layout:{}};
}
const input={id:'input',kind:'input',label:'Input'} as const;
const returned={id:'return',kind:'return',label:'Return',value:'done'} as const;
const edge=(id:string,source:string,target:string):Definition['edges'][number]=>({id,source,target,port:'next'});
function producer(){return definition('retention-producer',[input,{id:'inject',kind:'context-lifecycle',label:'Retain',lifecycle:{operation:'inject',target:'/working',paths:['/input/data'],value:'{{input.data}}'}},returned],[edge('a','input','inject'),edge('b','inject','return')]);}
function consumer(sourceId:string,wait=true){
  const retrieve:Extract<Definition['nodes'][number],{kind:'context-lifecycle'}>={id:'retrieve',kind:'context-lifecycle',label:'Restore',lifecycle:{operation:'retrieve',target:'/copy',paths:['/input/data'],source:{kind:'retained',sourceId}}};
  return definition('retention-consumer',wait?[input,{id:'wait',kind:'wait',label:'Park',message:'Continue after cleanup'},retrieve,returned]:[input,retrieve,returned],wait?[edge('a','input','wait'),edge('b','wait','retrieve'),edge('c','retrieve','return')]:[edge('a','input','retrieve'),edge('b','retrieve','return')]);
}
function setupSqlite(){
  const directory=mkdtempSync(join(tmpdir(),'loops-context-retention-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
  const filename=join(directory,'loops.sqlite'),documents=join(directory,'documents');
  const store=new SqliteStorage(filename);cleanups.push(()=>store.close());
  const engine=new Engine(store,host(),{documentDirectory:documents});
  return {directory,filename,documents,store,engine};
}
async function produce(engine:Engine){
  engine.save(actor,producer(),0,true);
  const run=await engine.run(actor,'retention-producer',{data:{zero:0,none:null,unicode:'🦊'}},'produce-retained-source');
  expect(run.state).toBe('completed');return {run,id:run.context!.sources![0].documentId};
}

describe('retained context source custody during transport maintenance',()=>{
  it('keeps a saved, parked consumer source after producer history removal and resumes from cold SQLite',async()=>{
    const {filename,documents,store,engine}=setupSqlite(),{run:produced,id}=await produce(engine);
    engine.save(actor,consumer(id),0,true);
    const parked=await engine.run(actor,'retention-consumer',{data:{other:true}},'park-retained-consumer');
    expect(parked.state).toBe('waiting');
    expect(store.readWorkingState()?.runs[parked.id]).toBeUndefined();
    const history=engine.retention(actor,policy);expect(history.candidates.map(item=>item.id)).toContain(produced.id);
    engine.retention(actor,policy,history.planId);
    await engine.close();
    const reopenedStore=new SqliteStorage(filename);cleanups.push(()=>reopenedStore.close());
    const reopened=new Engine(reopenedStore,host(),{documentDirectory:documents});
    const preview=reopened.maintenance(actor,policy);
    expect(preview.candidates.map(item=>item.id)).not.toContain(id);
    expect(preview.protected.referenced).toBeGreaterThan(0);
    reopened.maintenance(actor,policy,preview.planId);
    expect(reopened.documentContextValue(actor,id)).toEqual({'/input/data':{zero:0,none:null,unicode:'🦊'}});
    expect(()=>reopened.documentContextValue(foreign,id)).toThrow(/not found/i);
    expect(await reopened.resume(actor,parked.id)).toMatchObject({state:'completed',context:{value:{copy:{'/input/data':{zero:0,none:null,unicode:'🦊'}}}}});
  });

  it('keeps an immutable older revision while the current draft omits its retained source',async()=>{
    const {engine}=setupSqlite(),{run,id}=await produce(engine);
    const saved=engine.save(actor,consumer(id,false),0,true);
    expect(saved.record.definition.revision).toBe(1);
    const changed=definition('retention-consumer',[input,returned],[edge('a','input','return')]);changed.revision=1;
    engine.save(actor,changed,1,false);
    const history=engine.retention(actor,policy);expect(history.candidates.map(item=>item.id)).toContain(run.id);
    engine.retention(actor,policy,history.planId);
    const preview=engine.maintenance(actor,policy);
    expect(preview.candidates.map(item=>item.id)).not.toContain(id);
    expect(engine.documentContextValue(actor,id)).toEqual({'/input/data':{zero:0,none:null,unicode:'🦊'}});
  });

  it('keeps a source referenced only by a parked, cold SQLite run after a disposable storage fixture removes other records',async()=>{
    const {filename,documents,engine}=setupSqlite(),{run:produced,id}=await produce(engine);
    engine.save(actor,consumer(id),0,true);
    const parked=await engine.run(actor,'retention-consumer',{data:{other:2}},'cold-only-consumer');expect(parked.state).toBe('waiting');
    await engine.close();
    // No public hard-purge exists for recoverable revisions. Remove them only
    // from this disposable SQLite fixture; keep the legitimate parked run row.
    const database=new DatabaseSync(filename);try{
      database.exec('BEGIN IMMEDIATE');
      for(const runId of [produced.id]){
        for(const table of ['attempts','outputs','events'])database.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(runId);
        database.prepare('DELETE FROM admissions WHERE run_id=?').run(runId);
        database.prepare('DELETE FROM runs WHERE id=?').run(runId);
      }
      for(const loopId of ['retention-producer','retention-consumer']){
        database.prepare('DELETE FROM revisions WHERE loop_id=?').run(loopId);
        database.prepare('DELETE FROM loops WHERE id=?').run(loopId);
      }
      database.exec('COMMIT');
    }catch(error){database.exec('ROLLBACK');throw error;}finally{database.close();}
    const reopenedStore=new SqliteStorage(filename);cleanups.push(()=>reopenedStore.close());
    const reopened=new Engine(reopenedStore,host(),{documentDirectory:documents});
    expect(reopenedStore.readWorkingState()?.runs[parked.id]).toBeUndefined();
    expect(reopened.status(actor,parked.id).definition.nodes.some(node=>node.kind==='context-lifecycle'&&node.lifecycle.source?.kind==='retained'&&node.lifecycle.source.sourceId===id)).toBe(true);
    const preview=reopened.maintenance(actor,policy);
    expect(preview.candidates.map(item=>item.id)).not.toContain(id);
    expect(reopened.documentContextValue(actor,id)).toEqual({'/input/data':{zero:0,none:null,unicode:'🦊'}});
  });

  it('invalidates a stale cleanup plan when an actual retained reference is saved',async()=>{
    const {engine}=setupSqlite(),{run,id}=await produce(engine);
    const retention=engine.retention(actor,policy);expect(retention.candidates.map(item=>item.id)).toContain(run.id);
    engine.retention(actor,policy,retention.planId);
    const before=engine.maintenance(actor,policy);expect(before.candidates.map(item=>item.id)).toContain(id);
    engine.save(actor,consumer(id,false),0,false);
    expect(()=>engine.maintenance(actor,policy,before.planId)).toThrow(/changed since preview/i);
    expect(engine.documentContextValue(actor,id)).toBeDefined();
  });

  it('retains a recovery child context source after a storage fixture removes producer and parent history',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-context-recovery-fixture-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
    const storage=new FileStorage(join(directory,'state.json')),documents=join(directory,'documents'),engine=new Engine(storage,host(),{documentDirectory:documents});
    const {run:produced,id}=await produce(engine);
    const failed=definition('retention-failed-consumer',[input,{id:'restore',kind:'context-lifecycle',label:'Restore',lifecycle:{operation:'retrieve',target:'/copy',paths:['/input/data'],source:{kind:'retained',sourceId:id}}},{id:'fail',kind:'fail',label:'Fail',reason:'Intentional recovery fixture'}],[edge('a','input','restore'),edge('b','restore','fail')]);
    engine.save(actor,failed,0,true);
    const parent=await engine.run(actor,'retention-failed-consumer',{data:{other:1}},'failed-retained-consumer');expect(parent.state).toBe('failed');
    const child=await engine.retry(actor,parent.id,'retry-node','retry-retained-consumer');expect(child).toMatchObject({state:'failed',parentRunId:parent.id});
    const childSourceId=child.context!.sources![0].documentId;expect(childSourceId).not.toBe(id);
    await engine.close();
    // A public family hard-purge does not exist. This disposable store fixture
    // removes other references so the recovery child's context is decisive.
    const state=storage.read() as State;delete state.runs[parent.id];delete state.runs[produced.id];delete state.loops['retention-failed-consumer'];delete state.loops['retention-producer'];storage.write(state);
    const reopened=new Engine(storage,host(),{documentDirectory:documents});
    expect(reopened.status(actor,child.id).context!.sources?.some(source=>source.documentId===childSourceId)).toBe(true);
    const preview=reopened.maintenance(actor,policy);expect(preview.candidates.map(item=>item.id)).not.toContain(childSourceId);
    expect(reopened.documentContextValue(actor,childSourceId)).toBeDefined();
  });

  it('denies foreign and corrupt source reads, then allows cleanup only after a fixture removes the final stored reference and reader',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-context-final-reference-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
    const file=join(directory,'state.json'),documents=join(directory,'documents'),storage=new FileStorage(file),engine=new Engine(storage,host(),{documentDirectory:documents});
    const {run,id}=await produce(engine);engine.save(actor,consumer(id,false),0,false);
    expect(()=>engine.documentContextValue(foreign,id)).toThrow(/not found/i);
    expect(()=>engine.documentContextValue(actor,'a'.repeat(64))).toThrow(/not found/i);
    const documentFile=join(documents,`document-${id}.json`),original=readFileSync(documentFile,'utf8');
    const corrupted=JSON.parse(original);corrupted.text='changed';writeFileSync(documentFile,JSON.stringify(corrupted));
    expect(()=>engine.documentContextValue(actor,id)).toThrow(/integrity|corrupt/i);
    expect(engine.maintenance(actor,policy).candidates.map(item=>item.id)).not.toContain(id);
    writeFileSync(documentFile,original);
    const history=engine.retention(actor,policy);expect(history.candidates.map(item=>item.id)).toContain(run.id);engine.retention(actor,policy,history.planId);
    const held=engine.maintenance(actor,policy);expect(held.candidates.map(item=>item.id)).not.toContain(id);
    await engine.close();
    // There is no public hard-purge operation for immutable loop revisions.
    // This disposable storage fixture removes the final loop reference only.
    const state=storage.read() as State;delete state.loops['retention-consumer'];delete state.loops['retention-producer'];storage.write(state);
    const reopened=new Engine(storage,host(),{documentDirectory:documents});
    const reader=reopened.documentAcquire(actor,id);
    expect(reopened.maintenance(actor,policy).candidates.map(item=>item.id)).not.toContain(id);
    reopened.documentRelease(actor,id,reader.readerId);
    const eligible=reopened.maintenance(actor,policy);expect(eligible.candidates.map(item=>item.id)).toContain(id);
    reopened.maintenance(actor,policy,eligible.planId);
    expect(readdirSync(documents)).not.toContain(`document-${id}.json`);
  });
});

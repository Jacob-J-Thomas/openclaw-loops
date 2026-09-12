import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Engine,type Actor,type HostCapabilities,type Run,type State} from '../src/engine.js';
import type {Definition} from '../src/graph.js';
import {SqliteStorage} from '../src/storage.js';

const actor:Actor={agentId:'main',sessionKey:'agent:main:lazy-history',sessionId:'lazy-session',source:'tool',human:false,check:()=>{}};
const foreign:Actor={...actor,sessionKey:'agent:main:other-history',sessionId:'other-session'};
const human:Actor={...actor,source:'session-action',human:true};
const definition:Definition={schemaVersion:2,id:'history-fixture',revision:1,slug:'history-fixture',name:'History fixture',description:'Deterministic synthetic history.',inputSchema:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'Synthetic result'}],edges:[{id:'edge',source:'input',target:'return',port:'next'}],layout:{},capabilities:[],limits:{maxExecutions:1000,maxOutputBytes:1024*1024}};
const host:HostCapabilities={check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'Synthetic model result'})};
const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function fixture(){const directory=mkdtempSync(join(tmpdir(),'loops-lazy-history-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));return {directory,filename:join(directory,'loops.sqlite')};}
function open(filename:string){const storage=new SqliteStorage(filename);cleanups.push(()=>storage.close());return storage;}
function savedRun(id:string,owner:Actor=actor,changes:Partial<Run>={}):Run{
  const at='2026-01-01T00:00:00.000Z',text=`${id}: `+'🙂'.repeat(1024);
  return {id,requestKey:createHash('sha256').update(id).digest('hex'),requestFingerprint:'a'.repeat(64),owner:{agentId:owner.agentId,sessionKey:owner.sessionKey,sessionId:owner.sessionId},source:'tool',definition:structuredClone(definition),input:{},state:'completed',cursor:'return',outputs:{return:text},trace:[],executions:2,activeMs:1,createdAt:at,updatedAt:at,result:text,...changes};
}
function state(runs:Run[]):State{return {version:1,loops:{[definition.id]:{definition:structuredClone(definition),enabledRevision:1,publishedRevision:1,revisions:{1:structuredClone(definition)},grants:[]}},runs:Object.fromEntries(runs.map(run=>[run.id,run]))};}
function retained(engine:Engine){return (engine as unknown as {cachedState:State}).cachedState.runs;}

describe('indexed history without retained output copies',()=>{
  it('opens and pages cold history without a full-state read and retrieves only the authorized run',async()=>{
    const {filename}=fixture(),seed=open(filename);
    const owned=Array.from({length:120},(_,index)=>savedRun(`cold-${String(index).padStart(3,'0')}`));
    const other=savedRun('foreign-cold',foreign);seed.write(state([...owned,other]));await seed.close();
    const fullRead=vi.spyOn(SqliteStorage.prototype,'read').mockImplementation(()=>{throw new Error('Historical outputs must not be loaded as a startup snapshot.');});
    const storage=open(filename),reads=vi.spyOn(storage,'readRun'),engine=new Engine(storage,host);
    expect(retained(engine)).toEqual({});expect(storage.readWorkingState()?.runs).toEqual({});
    const first=engine.history(actor,0,75),second=engine.history(actor,75,75);
    expect(first.total).toBe(120);expect(first.nextCursor).toBe(75);expect(second.nextCursor).toBeNull();
    expect([...first.items,...second.items].map(row=>row.id)).toEqual(owned.map(run=>run.id).reverse());
    expect(reads).not.toHaveBeenCalled();expect(JSON.stringify(first)).not.toContain('🙂');
    expect(engine.history(foreign).items.map(row=>row.id)).toEqual([other.id]);
    expect(()=>engine.status(actor,other.id)).toThrow(/not found/);
    expect(engine.output(actor,owned[0].id).text).toBe(owned[0].result);
    expect(engine.status(actor,owned[1].id)).toEqual(owned[1]);expect(retained(engine)).toEqual({});
    await engine.close();expect(fullRead).not.toHaveBeenCalled();
  });
  it('saves drafts and publications without rewriting or deleting cold runs',async()=>{
    const {filename}=fixture(),storage=open(filename),cold=savedRun('cold-preserved');storage.write(state([cold]));
    const engine=new Engine(storage,host),before=storage.read()!;
    const database=new DatabaseSync(filename);cleanups.push(()=>database.close());
    database.exec("CREATE TRIGGER preserve_cold BEFORE INSERT ON runs WHEN NEW.id='cold-preserved' BEGIN SELECT RAISE(ABORT,'Cold run was rewritten'); END;");
    const edited=engine.draft(actor,{...engine.load(actor,definition.id).definition,name:'Unpublished new name'},1);
    expect(edited.record.enabledRevision).toBe(1);engine.publish(actor,definition.id,2,2);
    expect(storage.read()?.runs).toEqual(before.runs);expect(retained(engine)).toEqual({});
    expect(engine.status(actor,cold.id).definition).toEqual(definition);
    await engine.close();
    const reopened=open(filename);expect(reopened.read()?.runs).toEqual(before.runs);expect(reopened.integrity()).toEqual([{integrity_check:'ok'}]);
  });
  it('reloads parked waits and reviews, protects them from deletion, and retains pinned revisions',async()=>{
    const {filename}=fixture(),storage=open(filename),engine=new Engine(storage,host);
    const parkedDefinition={...definition,nodes:[definition.nodes[0],{id:'wait',kind:'wait' as const,label:'Wait',message:'Continue explicitly'},{id:'review',kind:'review' as const,label:'Review',proposal:'Approve explicitly'},definition.nodes[1],{id:'fail',kind:'fail' as const,label:'Fail',reason:'Rejected'}],edges:[{id:'one',source:'input',target:'wait',port:'next' as const},{id:'two',source:'wait',target:'review',port:'next' as const},{id:'yes',source:'review',target:'return',port:'approve' as const},{id:'no',source:'review',target:'fail',port:'reject' as const}]};
    const {id:_id,revision:_revision,schemaVersion:_version,...content}=parkedDefinition;
    const created=engine.create(actor,content).record,parked=await engine.run(actor,created.definition.slug,{},'parked');
    expect(parked.state).toBe('waiting');expect(retained(engine)).toEqual({});
    expect(()=>engine.delete(actor,created.definition.id,1)).toThrow(/active or parked/);
    engine.edit(actor,created.definition.id,1,{name:'New definition revision'});await engine.close();
    const reopenedStore=open(filename),reopened=new Engine(reopenedStore,host);
    expect(retained(reopened)).toEqual({});expect(reopened.status(actor,parked.id).definition.revision).toBe(1);
    const review=await reopened.resume(actor,parked.id);expect(review.state).toBe('review');expect(retained(reopened)).toEqual({});
    await expect(reopened.review(actor,parked.id,'approve')).rejects.toThrow(/authenticated human/);
    const completed=await reopened.review(human,parked.id,'approve');expect(completed).toMatchObject({state:'completed',result:'Synthetic result',definition:{revision:1}});
    expect(retained(reopened)).toEqual({});expect(reopened.delete(actor,created.definition.id,2).deleted).toBe(true);await reopened.close();
  });
  it('repairs only restart work and backfills lost legacy revisions without losing cold evidence',async()=>{
    const {directory,filename}=fixture(),cold=savedRun('cold-legacy'),running=savedRun('running-legacy',actor,{state:'running',result:undefined,trace:[{nodeId:'return',kind:'return',state:'running',startedAt:'2026-01-01'}]});
    const settling=savedRun('settling-legacy',actor,{state:'cancelled',cleanupPending:true});
    const legacy=state([cold,running,settling]);legacy.loops[definition.id]={definition:{...structuredClone(definition),revision:2,name:'Latest legacy revision'},enabledRevision:2,grants:[]};
    const legacyFile=join(directory,'legacy.json');writeFileSync(legacyFile,JSON.stringify(legacy));
    const storage=new SqliteStorage(filename,legacyFile);cleanups.push(()=>storage.close());const engine=new Engine(storage,host);
    expect(retained(engine)).toEqual({});expect(storage.read()?.runs[cold.id]).toEqual(cold);
    expect(engine.status(actor,running.id)).toMatchObject({state:'interrupted',uncertainty:expect.stringMatching(/unknown/)});
    expect(engine.status(actor,settling.id).cleanupPending).toBeUndefined();
    expect(engine.load(actor,definition.id).revisions?.[1]).toEqual(definition);expect(engine.load(actor,definition.id).definition.revision).toBe(2);
    expect(storage.integrity()).toEqual([{integrity_check:'ok'}]);await engine.close();
  });
  it('keeps active and physically settling objects until cancellation cleanup ends',async()=>{
    let finish!:(value:{text:string})=>void;
    const {filename}=fixture(),storage=open(filename),engine=new Engine(storage,{...host,complete:()=>new Promise(resolve=>{finish=resolve;})},{replyTimeoutMs:1});
    const d:Definition={...definition,capabilities:['llm'],nodes:[definition.nodes[0],{id:'infer',kind:'inference',label:'Infer',prompt:'Synthetic',output:'text'},definition.nodes[1]],edges:[{id:'one',source:'input',target:'infer',port:'next'},{id:'two',source:'infer',target:'return',port:'next'}]};
    const running=await engine.test(actor,d,{},'physical');expect(retained(engine)[running.id]).toBeDefined();engine.cancel(actor,running.id);
    await vi.waitFor(()=>expect(engine.status(actor,running.id).cleanupPending).toBe(true));expect(retained(engine)[running.id]).toBeDefined();
    expect(engine.retention(actor,{keepLatest:0}).candidates).toEqual([]);finish({text:'Late outcome'});
    await vi.waitFor(()=>expect(engine.status(actor,running.id).cleanupPending).not.toBe(true));expect(retained(engine)).toEqual({});
    expect(engine.retention(actor,{keepLatest:0}).candidates.map(row=>row.id)).toEqual([running.id]);await engine.close();
  });
  it('rolls back authoring during a host call without orphaning its retained execution object',async()=>{
    let finish!:(value:{text:string})=>void;
    const {filename}=fixture(),storage=open(filename);storage.write(state([]));
    const engine=new Engine(storage,{...host,complete:()=>new Promise(resolve=>{finish=resolve;})},{replyTimeoutMs:1});
    const d:Definition={...definition,capabilities:['llm'],nodes:[definition.nodes[0],{id:'infer',kind:'inference',label:'Infer',prompt:'Synthetic',output:'text'},definition.nodes[1]],edges:[{id:'one',source:'input',target:'infer',port:'next'},{id:'two',source:'infer',target:'return',port:'next'}]};
    const running=await engine.test(actor,d,{},'authoring-fault');const held=retained(engine)[running.id];
    const database=new DatabaseSync(filename);cleanups.push(()=>database.close());
    database.exec("CREATE TRIGGER reject_draft BEFORE INSERT ON loops BEGIN SELECT RAISE(ABORT,'Synthetic draft failure'); END;");
    expect(()=>engine.edit(actor,definition.id,1,{name:'Must roll back'})).toThrow(expect.objectContaining({code:'LOOPS_STORAGE_CONFLICT'}));
    expect(engine.load(actor,definition.id).definition).toEqual(definition);expect(retained(engine)[running.id]).toBe(held);
    database.exec('DROP TRIGGER reject_draft');finish({text:'Late result after failed save'});
    await vi.waitFor(()=>{const current=engine.status(actor,running.id);expect(current.state).toBe('failed');expect(current.cleanupPending).not.toBe(true);});
    const final=engine.status(actor,running.id);expect(final.state).toBe('failed');expect(storage.read()?.runs[running.id]).toEqual(final);expect(retained(engine)).toEqual({});await engine.close();
  });
  it('rejects corrupt cold inspection and metadata without rewriting the evidence',async()=>{
    const {filename}=fixture(),storage=open(filename),cold=savedRun('cold-corrupt');storage.write(state([cold]));await storage.close();
    const fault=new DatabaseSync(filename);const damaged={...cold,trace:'invalid trace'};fault.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(damaged),cold.id);fault.close();
    const reopened=open(filename),engine=new Engine(reopened,host);
    expect(()=>engine.status(actor,cold.id)).toThrow(/Invalid saved run structure/);
    const database=new DatabaseSync(filename);cleanups.push(()=>database.close());
    for(const invalid of [{owner:{agentId:3}},{state:'waiting'},{cleanupPending:1},{parentRunId:null},{requestFingerprint:'mismatched-index'}]){
      database.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify({...damaged,...invalid}),cold.id);
      expect(()=>engine.retention(actor,{keepLatest:0})).toThrow(/Invalid saved history metadata/);
    }
    const invalidMetadata={...damaged,owner:{agentId:3}};database.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(invalidMetadata),cold.id);
    await engine.close();expect(JSON.parse(String(database.prepare('SELECT record FROM runs WHERE id=?').get(cold.id)?.record))).toEqual(invalidMetadata);
  });
});

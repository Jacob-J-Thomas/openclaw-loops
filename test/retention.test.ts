import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Engine,type Actor,type HostCapabilities,type Run} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {examples} from '../src/examples.js';
import {retentionCandidates} from '../src/retention.js';
const actor:Actor={agentId:'main',sessionKey:'agent:main:retention',sessionId:'retention',source:'tool',human:false,check:()=>{}};
const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function setup(host?:Partial<HostCapabilities>){
  const directory=mkdtempSync(join(tmpdir(),'loops-retention-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
  const filename=join(directory,'loops.sqlite'),storage=new SqliteStorage(filename);cleanups.push(()=>storage.close());
  const engine=new Engine(storage,{check:()=>{},modelInfo:async()=>({}),complete:vi.fn(async()=>({text:'Done'})),...host},{replyTimeoutMs:2});
  return {directory,filename,storage,engine};
}
const definition=()=>({...structuredClone(examples[0]),schemaVersion:2 as const,capabilities:[],inputSchema:[],nodes:[{id:'input',kind:'input' as const,label:'Input'},{id:'return',kind:'return' as const,label:'Return',value:'Stored result'}],edges:[{id:'edge',source:'input',target:'return',port:'next' as const}]});

describe('explicit history retention',()=>{
  it('previews without mutation, applies only within the caller conversation, and reserves removed admission IDs across restart',async()=>{
    const {engine,storage,filename}=setup();const d=definition();
    const owned=await engine.test(actor,d,{},'owned');
    const other={...actor,sessionKey:'agent:main:other',sessionId:'other'};
    const foreign=await engine.test(other,d,{},'other');
    const before=storage.read();const preview=engine.retention(actor,{keepLatest:0});
    expect(preview.candidates.map(run=>run.id)).toEqual([owned.id]);expect(preview.applied).toBe(false);expect(storage.read()).toEqual(before);
    expect(()=>engine.retention(other,{keepLatest:0},preview.planId)).toThrow(/changed since preview/);
    const removed=engine.retention(actor,preview.policy,preview.planId);expect(removed.applied).toBe(true);
    expect(engine.status(other,foreign.id).result).toBe('Stored result');expect(engine.library(actor)).toHaveLength(3);
    expect(()=>engine.status(actor,owned.id)).toThrow(/not found/);expect(engine.history(actor).total).toBe(0);
    await engine.close();
    const reopenedStore=new SqliteStorage(filename);cleanups.push(()=>reopenedStore.close());
    const reopened=new Engine(reopenedStore,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'Unused'})});
    await expect(reopened.test(actor,d,{},'owned')).rejects.toMatchObject({detail:{code:'LOOPS_HISTORY_REMOVED'}});
    await expect(reopened.test(actor,{...d,name:'Different'}, {},'owned')).rejects.toThrow(/Request ID conflict/);
    expect((await reopened.test(actor,d,{},'intentional-new-run')).state).toBe('completed');await reopened.close();
  });
  it('protects queued, waiting, review, uncertain cleanup and recovery parents',()=>{
    const base={id:'old',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',state:'completed'} as Run;
    const runs=[base,{...base,id:'latest',createdAt:'2026-03-01T00:00:00.000Z'},...(['running','queued','waiting','review'] as const).map(state=>({...base,id:state,state})),{...base,id:'physical',state:'cancelled' as const},{...base,id:'flagged',cleanupPending:true},{...base,id:'parent'}];
    const plan=retentionCandidates(runs,{olderThanDays:30,keepLatest:1},new Set(['physical']),new Set(['parent']),Date.parse('2026-04-01T00:00:00Z'));
    expect(plan.candidates).toEqual([{id:'old',updatedAt:base.updatedAt}]);expect(plan.protected).toEqual({active:6,ancestry:1,recent:1});
    expect(()=>retentionCandidates(runs,{},new Set(),new Set())).toThrow(/requires/);
    expect(()=>retentionCandidates(runs,{keepLatest:-1},new Set(),new Set())).toThrow(/requires/);
  });
  it('keeps physical execution occupied and unprunable after logical cancellation',async()=>{
    let finish!:(value:{text:string})=>void;
    const {engine}=setup({complete:()=>new Promise(resolve=>{finish=resolve;})});
    const running=await engine.test(actor,{...structuredClone(examples[0]),schemaVersion:2},{text:'Synthetic'},'physical');
    expect(running.state).toBe('running');engine.cancel(actor,running.id);
    expect(engine.retention(actor,{keepLatest:0}).candidates).toEqual([]);
    finish({text:'Late result'});
    await vi.waitFor(()=>expect(engine.status(actor,running.id).cleanupPending).not.toBe(true));
    expect(engine.retention(actor,{keepLatest:0}).candidates.map(run=>run.id)).toEqual([running.id]);await engine.close();
  });
  it('invalidates a stale candidate set and preserves a real recovery parent',async()=>{
    let fail=true;const {engine}=setup({complete:async()=>{if(fail)throw new Error('Synthetic failure');return {text:'Recovered'};}});
    const d={...structuredClone(examples[0]),schemaVersion:2 as const};const parent=await engine.test(actor,d,{text:'Synthetic'},'parent');expect(parent.state).toBe('failed');
    const preview=engine.retention(actor,{keepLatest:0});fail=false;
    const child=await engine.retry(actor,parent.id,'retry-node','child');expect(child.state).toBe('completed');
    expect(()=>engine.retention(actor,preview.policy,preview.planId)).toThrow(/changed since preview/);
    const plan=engine.retention(actor,{keepLatest:0});expect(plan.protected.ancestry).toBe(1);expect(plan.candidates.map(run=>run.id)).toEqual([child.id]);
    engine.retention(actor,plan.policy,plan.planId);expect(engine.status(actor,parent.id).state).toBe('failed');await engine.close();
  });
  it('rolls back pruning and admission retirement together when SQLite refuses a deletion',async()=>{
    const {engine,storage,filename}=setup();const d=definition(),run=await engine.test(actor,d,{},'cannot-remove');const before=storage.read();
    const fault=new DatabaseSync(filename);cleanups.push(()=>fault.close());
    fault.exec("CREATE TRIGGER reject_history_removal BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'Injected history deletion failure'); END;");
    const preview=engine.retention(actor,{keepLatest:0});expect(()=>engine.retention(actor,preview.policy,preview.planId)).toThrow(expect.objectContaining({code:'LOOPS_STORAGE_CONFLICT',cause:expect.objectContaining({message:'Injected history deletion failure'})}));
    expect(storage.read()).toEqual(before);expect(engine.status(actor,run.id).result).toBe('Stored result');
    expect((await engine.test(actor,d,{},'cannot-remove')).id).toBe(run.id);
    fault.exec('DROP TRIGGER reject_history_removal');await engine.close();
  });
  it('upgrades a version 1 SQLite schema without changing its existing records',async()=>{
    const {engine,storage,filename,directory}=setup();const run=await engine.test(actor,definition(),{},'upgrade');const before=storage.read();await engine.close();
    const legacy=new DatabaseSync(filename);legacy.exec('DROP TABLE retired_admissions; PRAGMA user_version=1;');legacy.close();
    const upgraded=new SqliteStorage(filename);cleanups.push(()=>upgraded.close());expect(upgraded.read()).toEqual(before);expect(upgraded.read()?.runs[run.id].state).toBe('completed');
    expect(upgraded.integrity()).toEqual([{integrity_check:'ok'}]);
    const saved=readdirSync(directory).find(name=>name.startsWith('loops.sqlite.before-schema-2-'));expect(saved).toBeDefined();
    const backup=new DatabaseSync(join(directory,saved!),{readOnly:true});try{expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1);expect(backup.prepare('SELECT id FROM runs').all()).toEqual([{id:run.id}]);}finally{backup.close();}
  });
});

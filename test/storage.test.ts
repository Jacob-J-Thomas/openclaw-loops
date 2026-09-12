import {afterEach,describe,it,expect,vi} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {SqliteStorage} from '../src/storage.js';
import {examples} from '../src/examples.js';
import {Engine,type Actor,type State} from '../src/engine.js';
const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function setup(){const directory=mkdtempSync(join(tmpdir(),'loops-sqlite-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));const filename=join(directory,'loops.sqlite');return {directory,filename};}
const initial=():State=>({version:1,loops:Object.fromEntries(examples.map(d=>[d.id,{definition:{...structuredClone(d),revision:1},enabledRevision:null,grants:[]}])),runs:{}});
describe('plugin-owned SQLite worker',()=>{
  it('commits execution checkpoints without retransmitting or rewriting retained history',async()=>{
    const {filename}=setup(),store=new SqliteStorage(filename);cleanups.push(()=>store.close());
    const actor:Actor={agentId:'main',sessionKey:'agent:main:checkpoint-history',sessionId:'history-session',source:'tool',human:false,check:()=>{}};
    const engine=new Engine(store,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'Synthetic output '.repeat(1000)})});
    const definition={...structuredClone(examples[0]),schemaVersion:2 as const,limits:{maxExecutions:20,maxOutputBytes:100000}};
    const previous=await engine.test(actor,definition,{text:'Retained history'},'retained');
    const retained=store.read()!;
    const writes=vi.spyOn(store,'write');
    const post=Worker.prototype.postMessage,requests:Array<{operation:string;payload:unknown}>=[];
    const messages=vi.spyOn(Worker.prototype,'postMessage').mockImplementation(function(this:Worker,message,transfers){requests.push(message);return post.call(this,message,transfers);});
    let completed;
    try{
      completed=await engine.test(actor,definition,{text:'New execution'},'fresh');
      expect(completed.state).toBe('completed');expect(writes).not.toHaveBeenCalled();
      expect(requests.length).toBeGreaterThan(1);
      expect(requests.every(request=>request.operation==='write-run')).toBe(true);
      expect(requests.every(request=>!JSON.stringify(request.payload).includes(previous.id))).toBe(true);
    }finally{messages.mockRestore();writes.mockRestore();}
    const saved=store.read()!;
    expect(saved.loops).toEqual(retained.loops);expect(saved.runs[previous.id]).toEqual(retained.runs[previous.id]);
    expect(saved.runs[completed.id]).toEqual(completed);
    const inspection=new DatabaseSync(filename,{readOnly:true});
    try{
      expect(inspection.prepare('SELECT count(*) AS count FROM attempts WHERE run_id=?').get(completed.id)?.count).toBe(completed.trace.length);
      expect(inspection.prepare('SELECT count(*) AS count FROM outputs WHERE run_id=?').get(completed.id)?.count).toBe(Object.keys(completed.outputs).length);
      expect(inspection.prepare('SELECT run_id FROM admissions WHERE request_key=?').get(completed.requestKey)?.run_id).toBe(completed.id);
    }finally{inspection.close();}
    await engine.close();
    const reopened=new SqliteStorage(filename);cleanups.push(()=>reopened.close());expect(reopened.read()).toEqual(saved);
  });
  it('rolls back a conflicting run-only admission and retains the previously committed cache',async()=>{
    const {filename}=setup(),store=new SqliteStorage(filename);cleanups.push(()=>store.close());
    const actor:Actor={agentId:'main',sessionKey:'agent:main:checkpoint-conflict',sessionId:'conflict-session',source:'tool',human:false,check:()=>{}};
    const engine=new Engine(store,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'Committed output'})});
    const run=await engine.test(actor,examples[0],{text:'Original'},'same-admission'),before=store.read();
    expect(()=>store.writeRun({...run,id:'conflicting-run'})).toThrow(/Admission identity conflict/);
    expect(store.read()).toEqual(before);
    const next=await engine.test(actor,examples[0],{text:'After rejection'},'new-admission');expect(next.state).toBe('completed');
    expect(store.read()?.runs[run.id]).toEqual(run);expect(store.read()?.runs['conflicting-run']).toBeUndefined();
    expect(store.integrity()).toEqual([{integrity_check:'ok'}]);await engine.close();
  });
  it('keeps returned and persisted run outcomes consistent after SQLite rejects completion',async()=>{
    const {filename}=setup(),store=new SqliteStorage(filename);cleanups.push(()=>store.close());
    const actor:Actor={agentId:'main',sessionKey:'agent:main:commit-fault',sessionId:'fault-session',source:'tool',human:false,check:()=>{}};
    const engine=new Engine(store,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'Unused'})});
    // Fault injection changes only this disposable fixture. The real worker's
    // transaction must roll back, and its caller must retain the committed run.
    const fault=new DatabaseSync(filename);cleanups.push(()=>fault.close());
    fault.exec("CREATE TRIGGER reject_completion BEFORE INSERT ON runs WHEN json_extract(NEW.record,'$.state')='completed' BEGIN SELECT RAISE(ABORT,'Injected completion commit failure'); END;");
    const definition={...structuredClone(examples[0]),schemaVersion:2 as const,inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input' as const,label:'Input'},{id:'return',kind:'return' as const,label:'Return',value:'Completed value'}],edges:[{id:'edge',source:'input',target:'return',port:'next' as const}]};
    const returned=await engine.test(actor,definition,{},'completion-commit-fault');
    expect(returned.state).toBe('failed');expect(returned.error).toContain('Injected completion commit failure');
    expect(engine.status(actor,returned.id)).toEqual(returned);
    expect(store.read()?.runs[returned.id]).toEqual(returned);
    fault.exec('DROP TRIGGER reject_completion');
    const recovered=await engine.retry(actor,returned.id,'retry-node','explicit-recovery');expect(recovered).toMatchObject({state:'completed',result:'Completed value',parentRunId:returned.id});
    await engine.close();
  });
  it('migrates JSON transactionally, retains original and backup, then reopens the database',async()=>{
    const {directory,filename}=setup(),legacy=join(directory,'state.json'),state=initial();writeFileSync(legacy,JSON.stringify(state));
    const store=new SqliteStorage(filename,legacy);cleanups.push(()=>store.close());
    expect(store.read()).toEqual(state);expect(JSON.parse(readFileSync(legacy,'utf8'))).toEqual(state);
    expect(readdirSync(directory).some(name=>name.startsWith('state.json.before-sqlite-'))).toBe(true);
    expect(store.integrity()).toEqual([{integrity_check:'ok'}]);await store.close();
    const reopened=new SqliteStorage(filename,legacy);cleanups.push(()=>reopened.close());expect(reopened.read()).toEqual(state);
  });
  it('rejects a competing process/store and immutable revision overwrite without a partial commit',()=>{
    const {filename}=setup();const store=new SqliteStorage(filename);cleanups.push(()=>store.close());const state=initial();store.write(state);
    expect(()=>new SqliteStorage(filename)).toThrow(/already open/);
    const invalid=structuredClone(state);invalid.loops['summarize-text'].definition.name='Changed without a revision';
    expect(()=>store.write(invalid)).toThrow(/Immutable revision conflict/);expect(store.read()).toEqual(state);
  });
  it('produces a verified backup that can be restored independently',()=>{
    const {directory,filename}=setup();const store=new SqliteStorage(filename);cleanups.push(()=>store.close());store.write(initial());
    const snapshot=join(directory,'backup.sqlite');store.backup(snapshot);const restored=new SqliteStorage(snapshot);cleanups.push(()=>restored.close());
    expect(restored.read()).toEqual(store.read());expect(restored.integrity()).toEqual([{integrity_check:'ok'}]);
  });
  it('refuses invalid legacy data without replacing it and releases ownership after worker cleanup',async()=>{
    const {directory,filename}=setup(),legacy=join(directory,'state.json');writeFileSync(legacy,'{"version":99}');
    expect(()=>new SqliteStorage(filename,legacy)).toThrow(/unsupported/);expect(readFileSync(legacy,'utf8')).toBe('{"version":99}');
    await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
    writeFileSync(legacy,JSON.stringify(initial()));
    const store=new SqliteStorage(filename,legacy);cleanups.push(()=>store.close());expect(store.read()).toEqual(initial());
  });
  it('reports a corrupt SQLite file promptly without replacing it',async()=>{
    const {filename}=setup();writeFileSync(filename,'not a sqlite database');const start=Date.now();
    expect(()=>new SqliteStorage(filename)).toThrow(/not a database/);expect(Date.now()-start).toBeLessThan(5000);expect(readFileSync(filename,'utf8')).toBe('not a sqlite database');
    await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
  });
  it('reports invalid saved JSON promptly instead of waiting for a dead worker',async()=>{
    const {filename}=setup(),store=new SqliteStorage(filename);store.write(initial());await store.close();
    const fault=new DatabaseSync(filename);
    fault.prepare("UPDATE metadata SET value=? WHERE key='version'").run('invalid stored JSON');fault.close();
    const start=Date.now();expect(()=>new SqliteStorage(filename)).toThrow(/JSON/);
    expect(Date.now()-start).toBeLessThan(5000);
    await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
    const preserved=new DatabaseSync(filename,{readOnly:true});
    try{expect(preserved.prepare("SELECT value FROM metadata WHERE key='version'").get()?.value).toBe('invalid stored JSON');}
    finally{preserved.close();}
  });
  it('keeps the lease after a failed close until the storage worker physically terminates',async()=>{
    const {filename}=setup(),store=new SqliteStorage(filename);store.write(initial());
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const terminate=Worker.prototype.terminate,post=Worker.prototype.postMessage;
    const terminateSpy=vi.spyOn(Worker.prototype,'terminate').mockImplementation(function(this:Worker){return gate.then(()=>terminate.call(this));});
    const postSpy=vi.spyOn(Worker.prototype,'postMessage').mockImplementation(function(this:Worker,message,transfers){
      // Reject close inside the real worker, leaving its SQLite connection open.
      return post.call(this,message.operation==='close'?{...message,operation:'injected-close-failure'}:message,transfers);
    });
    const closing=store.close();let settled=false;void closing.then(()=>{settled=true;},()=>{settled=true;});
    try{
      expect(terminateSpy).toHaveBeenCalledOnce();expect(settled).toBe(false);
      expect(()=>new SqliteStorage(filename)).toThrow(/already open/);
      expect(existsSync(filename+'.lock')).toBe(true);
    }finally{
      postSpy.mockRestore();release();
      await expect(closing).rejects.toThrow('Unknown storage operation.');terminateSpy.mockRestore();
    }
    expect(settled).toBe(true);
    const reopened=new SqliteStorage(filename);cleanups.push(()=>reopened.close());expect(reopened.read()).toEqual(initial());
  });
});

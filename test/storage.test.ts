import {afterEach,describe,it,expect,vi} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
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
      expect(requests.some(request=>request.operation==='write-run')).toBe(true);
      expect(requests.every(request=>['read-retired','find-admission','write-run'].includes(request.operation))).toBe(true);
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
  it('rolls back a conflicting run-only admission and retains the committed state',async()=>{
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
  it('compares against committed rows after reopen without rewriting unchanged history',async()=>{
    const {filename}=setup(),store=new SqliteStorage(filename);cleanups.push(()=>store.close());
    const actor:Actor={agentId:'main',sessionKey:'agent:main:checkpoint-reopen',sessionId:'reopen-session',source:'tool',human:false,check:()=>{}};
    const engine=new Engine(store,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'Committed output'})});
    const run=await engine.test(actor,examples[0],{text:'Retained'},'retained');await engine.close();
    const reopened=new SqliteStorage(filename);cleanups.push(()=>reopened.close());const state=reopened.read()!;
    const database=new DatabaseSync(filename);cleanups.push(()=>database.close());
    for(const table of ['runs','attempts','outputs','events'])database.exec(`CREATE TRIGGER unchanged_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'Unchanged history was rewritten'); END;`);
    reopened.write(state);reopened.writeRun(run);
    // Changing only the run must not reinsert its identical attempts or outputs,
    // nor append an event when the state has not changed.
    database.exec('DROP TRIGGER unchanged_runs');
    const updated={...run,updatedAt:new Date(Date.parse(run.updatedAt)+1000).toISOString()};
    reopened.writeRun(updated);
    expect(reopened.read()?.runs[run.id]).toEqual(updated);
    expect(database.prepare('SELECT count(*) AS count FROM attempts WHERE run_id=?').get(run.id)?.count).toBe(run.trace.length);
    expect(database.prepare('SELECT count(*) AS count FROM outputs WHERE run_id=?').get(run.id)?.count).toBe(Object.keys(run.outputs).length);
    const invalid=structuredClone(state);delete invalid.runs[run.id];
    expect(()=>reopened.write(invalid)).toThrow('History removal requires a retained admission identity.');
    expect(reopened.read()?.runs[run.id]).toEqual(updated);
    expect(reopened.integrity()).toEqual([{integrity_check:'ok'}]);
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
    expect(returned.state).toBe('failed');expect(returned.errorDetail).toMatchObject({code:'LOOPS_STORAGE_CONFLICT',phase:'storage',retryable:false});
    expect(JSON.stringify(returned)).not.toContain('Injected completion commit failure');
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
  it.each([3,99])('rejects future schema %i without changing database bytes or journal format',async version=>{
    const {filename}=setup(),database=new DatabaseSync(filename);
    database.exec(`PRAGMA journal_mode=DELETE;CREATE TABLE future_evidence(id TEXT,value TEXT);INSERT INTO future_evidence VALUES ('preserve','Future-format evidence');PRAGMA user_version=${version};`);database.close();
    const original=readFileSync(filename);
    expect(()=>new SqliteStorage(filename)).toThrow(/requires a newer plugin/);
    await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
    expect(readFileSync(filename)).toEqual(original);
    const inspect=new DatabaseSync(filename,{readOnly:true});
    try{expect(inspect.prepare('PRAGMA journal_mode').get()).toEqual({journal_mode:'delete'});expect(inspect.prepare('PRAGMA user_version').get()).toEqual({user_version:version});expect(inspect.prepare('SELECT * FROM future_evidence').all()).toEqual([{id:'preserve',value:'Future-format evidence'}]);}finally{inspect.close();}
  });
  it('rejects a crashed future WAL store without checkpointing or deleting its committed WAL',async()=>{
    const {filename}=setup();
    const child=spawnSync(process.execPath,['--input-type=module','--eval',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec("PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;CREATE TABLE future_evidence(value TEXT);INSERT INTO future_evidence VALUES ('Committed future WAL evidence');PRAGMA user_version=99;");process.kill(process.pid,'SIGKILL');`,filename]);
    expect(child.signal).toBe('SIGKILL');expect(existsSync(filename+'-wal')).toBe(true);
    const original=readFileSync(filename),wal=readFileSync(filename+'-wal');expect(wal.length).toBeGreaterThan(0);
    expect(()=>new SqliteStorage(filename)).toThrow(/requires a newer plugin/);
    await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
    expect(readFileSync(filename)).toEqual(original);expect(readFileSync(filename+'-wal')).toEqual(wal);
    const inspect=new DatabaseSync(filename,{readOnly:true});
    try{expect(inspect.prepare('PRAGMA user_version').get()).toEqual({user_version:99});expect(inspect.prepare('SELECT * FROM future_evidence').all()).toEqual([{value:'Committed future WAL evidence'}]);}finally{inspect.close();}
    expect(readFileSync(filename)).toEqual(original);expect(readFileSync(filename+'-wal')).toEqual(wal);
  });
  it('preserves a supported-schema backup with a readable header but corrupt later B-tree page',async()=>{
    const {filename}=setup(),store=new SqliteStorage(filename);store.write(initial());await store.close();
    const database=new DatabaseSync(filename);database.exec('PRAGMA journal_mode=DELETE;');
    const page=Number(database.prepare("SELECT rootpage FROM sqlite_schema WHERE name='loops'").get()!.rootpage),size=Number(database.prepare('PRAGMA page_size').get()!.page_size);database.close();
    expect(page).toBeGreaterThan(1);const damaged=readFileSync(filename);damaged[(page-1)*size]=0xff;writeFileSync(filename,damaged);
    const header=new DatabaseSync(filename,{readOnly:true});try{expect(header.prepare('PRAGMA user_version').get()).toEqual({user_version:2});}finally{header.close();}
    expect(()=>new SqliteStorage(filename)).toThrow(/integrity|corrupt|malformed/);await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
    expect(readFileSync(filename)).toEqual(damaged);expect(existsSync(filename+'-wal')).toBe(false);
  });
  it('preserves legacy and backup inputs after a rejected import transaction and retries without partial records',async()=>{
    const {directory,filename}=setup(),legacy=join(directory,'state.json'),original=JSON.stringify(initial());writeFileSync(legacy,original);
    const uninitialized=new SqliteStorage(filename);await uninitialized.close();
    const fault=new DatabaseSync(filename);fault.exec("CREATE TRIGGER reject_import BEFORE INSERT ON metadata BEGIN SELECT RAISE(ABORT,'Synthetic import rejection'); END;");fault.close();
    expect(()=>new SqliteStorage(filename,legacy)).toThrow(/conflicting write/);
    await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
    const backup=join(directory,readdirSync(directory).find(name=>name.startsWith('state.json.before-sqlite-'))!);
    expect(readFileSync(legacy,'utf8')).toBe(original);expect(readFileSync(backup,'utf8')).toBe(original);
    const inspect=new DatabaseSync(filename);
    try{for(const table of ['metadata','loops','revisions','runs'])expect(inspect.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({n:0});inspect.exec('DROP TRIGGER reject_import');}finally{inspect.close();}
    const recovered=new SqliteStorage(filename,legacy);cleanups.push(()=>recovered.close());expect(recovered.read()).toEqual(initial());expect(recovered.integrity()).toEqual([{integrity_check:'ok'}]);
    expect(readFileSync(legacy,'utf8')).toBe(original);expect(readFileSync(backup,'utf8')).toBe(original);
  });
  it.each([
    "UPDATE metadata SET value='invalid JSON' WHERE key='version'",
    "UPDATE metadata SET value='99' WHERE key='version'",
    "DELETE FROM metadata WHERE key='version'",
    "UPDATE loops SET record='{}' WHERE id='summarize-text'",
    "DROP TABLE outputs",
  ])('preserves a physically healthy restore rejected by startup record/schema validation (%#)',async damage=>{
    const {filename}=setup(),store=new SqliteStorage(filename);store.write(initial());await store.close();
    const fault=new DatabaseSync(filename);fault.exec('PRAGMA journal_mode=DELETE;'+damage);expect(fault.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok');fault.close();
    const before=readFileSync(filename);
    expect(()=>{const opened=new SqliteStorage(filename);cleanups.push(()=>opened.close());}).toThrow();await vi.waitFor(()=>expect(existsSync(filename+'.lock')).toBe(false));
    expect(readFileSync(filename)).toEqual(before);expect(existsSync(filename+'-wal')).toBe(false);
  });
  it('rejects a corrupt restored copy while preserving the verified backup and source store',async()=>{
    const {directory,filename}=setup(),store=new SqliteStorage(filename);cleanups.push(()=>store.close());store.write(initial());
    const backup=join(directory,'verified.sqlite');store.backup(backup);
    const digest=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex'),before=digest(backup),corrupt=join(directory,'damaged-restore.sqlite');writeFileSync(corrupt,readFileSync(backup).subarray(0,100));const damaged=digest(corrupt);
    expect(()=>new SqliteStorage(corrupt)).toThrow(/corrupt|not a SQLite database/);await vi.waitFor(()=>expect(existsSync(corrupt+'.lock')).toBe(false));
    expect(digest(corrupt)).toBe(damaged);expect(digest(backup)).toBe(before);expect(store.read()).toEqual(initial());
    const restored=new SqliteStorage(backup);cleanups.push(()=>restored.close());expect(restored.read()).toEqual(initial());
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
    expect(()=>new SqliteStorage(filename)).toThrow(/corrupt|not a SQLite database/);expect(Date.now()-start).toBeLessThan(5000);expect(readFileSync(filename,'utf8')).toBe('not a sqlite database');
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

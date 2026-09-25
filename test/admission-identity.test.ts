import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {copyFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Engine,type Actor,type HostCapabilities,type State,type Storage} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';

const actor:Actor={agentId:'main',sessionKey:'agent:main:identity',sessionId:'identity',source:'tool',human:false,check:()=>{}};
const input={data:[{'é':0,'e\u0301':false,'ä':1,z:[0,false,null]}]},reordered={data:[{z:[0,false,null],'ä':1,'e\u0301':false,'é':0}]};
const content={slug:'identity',name:'Identity',description:'Synthetic admission qualification',inputSchema:[{name:'data',label:'Data',type:'json',required:true}],capabilities:['model-info'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'model',kind:'action',label:'Model',capability:'model-info'},{id:'return',kind:'return',label:'Return',value:'{{input.data}}'}],edges:[{id:'a',source:'input',target:'model',port:'next'},{id:'b',source:'model',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}};
const cleanup:Array<()=>void|Promise<void>>=[];
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'loops-identity-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));return root;};
const host=():HostCapabilities=>({check:()=>{},complete:vi.fn(async()=>({text:'Unused'})),modelInfo:vi.fn(async()=>({model:'fixture'}))});
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
let bundle:string;
beforeAll(async()=>{
  bundle=mkdtempSync(join(tmpdir(),'loops-identity-code-'));
  await build({stdin:{contents:"export {Engine} from './src/engine.ts'; export {SqliteStorage} from './src/storage.ts';",resolveDir:process.cwd(),loader:'ts'},outfile:join(bundle,'runtime.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
  copyFileSync('src/storage-worker.mjs',join(bundle,'storage-worker.mjs'));
});
afterAll(()=>rmSync(bundle,{recursive:true,force:true}));
const oldFingerprint=(value:unknown,locale?:string)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b,locale))):item)).digest('hex');
async function legacy(locale?:string,testMode=false){
  let state:State|undefined;const memory:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}},engine=new Engine(memory,host());
  const created=engine.create(actor,content),run=testMode?await engine.test(actor,created.record.definition,input,'legacy'):await engine.run(actor,'identity',input,'legacy');await engine.close();
  const saved=state!.runs[run.id];delete saved.requestFingerprintVersion;saved.requestFingerprint=oldFingerprint({slug:'identity',input,...testMode?{draft:saved.definition}:{}},locale);
  return {state:state!,run:saved};
}
function open(file:string,state?:State){const store=new SqliteStorage(file);if(state)store.write(state);const adapter=host(),engine=new Engine(store,adapter,{replyTimeoutMs:2});let closed=false;const close=async()=>{if(!closed){closed=true;await engine.close();}};cleanup.push(close);return {store,engine,adapter,close};}

describe('durable admission identities',()=>{
  it('backs up a schema 2 fixture and preserves every legacy row while upgrading its reader boundary once',async()=>{
    const root=fixture(),file=join(root,'loops.sqlite'),previous=await legacy('sv-SE'),old=open(file,previous.state);await old.close();
    // This is a constructed legacy fixture; exact previous-artifact upgrade
    // and downgrade refusal are qualified separately against installed builds.
    const database=new DatabaseSync(file);database.exec('DROP TABLE memory_receipts; DROP TABLE memory_mutations; DROP TABLE memory_records; PRAGMA user_version=2;');
    const tables=['metadata','loops','revisions','runs','admissions','retired_admissions','attempts','outputs','events'];
    const rows=(db:DatabaseSync)=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    const before=rows(database);database.close();
    const upgraded=open(file);expect(upgraded.store.read()).toEqual(previous.state);expect(upgraded.store.integrity()).toEqual([{integrity_check:'ok'}]);
    const backups=()=>readdirSync(root).filter(name=>name.startsWith('loops.sqlite.before-schema-4-')&&name.endsWith('.bak'));expect(backups()).toHaveLength(1);
    const backup=new DatabaseSync(join(root,backups()[0]),{readOnly:true}),current=new DatabaseSync(file,{readOnly:true});
    try{expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(2);expect(current.prepare('PRAGMA user_version').get()?.user_version).toBe(4);expect(rows(backup)).toEqual(before);expect(rows(current)).toEqual(before);}finally{backup.close();current.close();}
    expect((await upgraded.engine.run(actor,'identity',reordered,'legacy')).id).toBe(previous.run.id);expect(upgraded.adapter.modelInfo).not.toHaveBeenCalled();await upgraded.close();
    const reopened=open(file);expect(reopened.store.read()).toEqual(previous.state);expect(backups()).toHaveLength(1);
  });
  it('keeps one effect for concurrent duplicates while distinct intentional IDs execute separately',async()=>{
    const {engine,adapter}=open(join(fixture(),'loops.sqlite'));engine.create(actor,content);
    let release!:(value:{model:string})=>void;vi.mocked(adapter.modelInfo).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const first=engine.run(actor,'identity',input,'concurrent');
    try{
      await vi.waitFor(()=>expect(adapter.modelInfo).toHaveBeenCalledOnce());
      const copies=await Promise.all(Array.from({length:8},(_,i)=>engine.run(actor,'identity',i%2?input:reordered,'concurrent')));
      expect(new Set(copies.map(run=>run.id)).size).toBe(1);expect(copies.every(run=>run.state==='running')).toBe(true);expect(adapter.modelInfo).toHaveBeenCalledOnce();
      await expect(engine.run(actor,'identity',{data:[{'é':false,'e\u0301':0}]},'concurrent')).rejects.toThrow(/conflict/);
      release({model:'fixture'});const original=await first;await vi.waitFor(()=>expect(engine.status(actor,original.id).state).toBe('completed'));
      const intentional=await engine.run(actor,'identity',input,'intentional');expect(intentional.id).not.toBe(original.id);expect(intentional.state).toBe('completed');expect(adapter.modelInfo).toHaveBeenCalledTimes(2);
    }finally{release?.({model:'fixture'});await first;}
  });
  it('preserves new fingerprints and tombstones across actual process and locale changes',()=>{
    const root=fixture(),file=join(root,'loops.sqlite'),effects=join(root,'effects');
    const step=(stage:string,locale:string)=>{const result=spawnSync(process.execPath,[resolve('test/helpers/identity-owner.mjs'),join(bundle,'runtime.mjs'),file,effects,stage],{env:{...process.env,LANG:locale,LC_ALL:locale},encoding:'utf8',timeout:15000});expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);return JSON.parse(result.stdout) as {locale:string;id:string;effects:number;fingerprint?:string};};
    const first=step('create','en_US.UTF-8'),replayed=step('replay','sv_SE.UTF-8');expect(replayed.id).toBe(first.id);expect(replayed.fingerprint).toBe(first.fingerprint);expect(replayed.locale).not.toBe(first.locale);expect(replayed.effects).toBe(1);
    const retired=step('retire','de_DE.UTF-8');expect(retired.id).toBe(first.id);expect(retired.effects).toBe(1);
    const intentional=step('retired','sv_SE.UTF-8');expect(intentional.id).not.toBe(first.id);expect(intentional.effects).toBe(2);
  });
  it.each([false,true])('compares retained legacy requests (unpublished=%s) canonically and preserves their immutable hashes through retirement and reopen',async testMode=>{
    const root=fixture(),file=join(root,'loops.sqlite'),previous=await legacy('sv-SE',testMode);let current=open(file,previous.state);
    const request=(value:unknown)=>testMode?current.engine.test(actor,previous.run.definition,value,'legacy'):current.engine.run(actor,'identity',value,'legacy');
    const replay=await request(reordered);expect(replay.id).toBe(previous.run.id);expect(replay.requestFingerprint).toBe(previous.run.requestFingerprint);expect(replay.requestFingerprintVersion).toBeUndefined();expect(current.adapter.modelInfo).not.toHaveBeenCalled();
    await expect(request({data:[]})).rejects.toThrow(/conflict/);
    const preview=current.engine.retention(actor,{keepLatest:0});current.engine.retention(actor,preview.policy,preview.planId);
    const retired=current.store.readRetiredAdmission(previous.run.requestKey)!;expect(retired.fingerprint).toBe(previous.run.requestFingerprint);expect(retired.canonicalFingerprint).toMatch(/^[a-f0-9]{64}$/);expect(retired.canonicalFingerprint).not.toBe(retired.fingerprint);
    await current.close();current=open(file);await expect(request(reordered)).rejects.toMatchObject({code:'LOOPS_HISTORY_REMOVED'});expect(current.adapter.modelInfo).not.toHaveBeenCalled();
    await expect(request({data:[]})).rejects.toThrow(/conflict/);expect(current.store.readRetiredAdmission(previous.run.requestKey)).toEqual(retired);
  });
  it('deduplicates concurrent recovery admissions and keeps retired retries separate from fresh intentional recovery',async()=>{
    const {engine,adapter}=open(join(fixture(),'loops.sqlite'));engine.create(actor,content);vi.mocked(adapter.modelInfo).mockRejectedValueOnce(Error('Synthetic failed action'));
    const parent=await engine.run(actor,'identity',input,'parent');expect(parent.state).toBe('failed');
    let release!:(value:{model:string})=>void;vi.mocked(adapter.modelInfo).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const first=engine.retry(actor,parent.id,'restart','recovery');
    try{
      await vi.waitFor(()=>expect(adapter.modelInfo).toHaveBeenCalledTimes(2));
      const copies=await Promise.all(Array.from({length:8},()=>engine.retry(actor,parent.id,'restart','recovery')));expect(new Set(copies.map(run=>run.id)).size).toBe(1);expect(copies.every(run=>run.parentRunId===parent.id&&run.requestFingerprintVersion===2)).toBe(true);
      await expect(engine.retry(actor,parent.id,'retry-node','recovery')).rejects.toThrow(/conflict/);await expect(engine.run(actor,'identity',input,'recovery')).rejects.toThrow(/conflict/);
      release({model:'fixture'});const recovered=await first;await vi.waitFor(()=>expect(engine.status(actor,recovered.id).state).toBe('completed'));
      const preview=engine.retention(actor,{keepLatest:0});expect(preview.candidates.map(run=>run.id)).toEqual([recovered.id]);engine.retention(actor,preview.policy,preview.planId);
      await expect(engine.retry(actor,parent.id,'restart','recovery')).rejects.toMatchObject({code:'LOOPS_HISTORY_REMOVED'});expect(adapter.modelInfo).toHaveBeenCalledTimes(2);
      const intentional=await engine.retry(actor,parent.id,'restart','another-recovery');expect(intentional.id).not.toBe(recovered.id);expect(intentional.parentRunId).toBe(parent.id);expect(adapter.modelInfo).toHaveBeenCalledTimes(3);
    }finally{release?.({model:'fixture'});await first;}
  });
  it('keeps already removed legacy IDs reserved when discarded payloads cannot prove canonical equivalence',async()=>{
    const previous=await legacy();previous.state.retiredAdmissions={[previous.run.requestKey]:{runId:previous.run.id,fingerprint:previous.run.requestFingerprint,owner:previous.run.owner,retiredAt:new Date().toISOString()}};delete previous.state.runs[previous.run.id];
    const {engine,store,adapter}=open(join(fixture(),'loops.sqlite'),previous.state),before=store.read();
    await expect(engine.run(actor,'identity',input,'legacy')).rejects.toMatchObject({code:'LOOPS_HISTORY_REMOVED'});
    await expect(engine.run(actor,'identity',reordered,'legacy')).rejects.toThrow(/removed history/);await expect(engine.run(actor,'identity',{data:[]},'legacy')).rejects.toThrow(/conflict/);
    expect(adapter.modelInfo).not.toHaveBeenCalled();expect(store.read()).toEqual(before);
  });
  it('does not change history or reserve partial tombstones when a legacy payload read fails before cleanup',async()=>{
    const previous=await legacy('sv-SE'),{engine,store,adapter}=open(join(fixture(),'loops.sqlite'),previous.state),before=store.read(),preview=engine.retention(actor,{keepLatest:0});
    const read=vi.spyOn(store,'readRun').mockImplementationOnce(()=>{throw Error('Synthetic unreadable legacy payload');});
    expect(()=>engine.retention(actor,preview.policy,preview.planId)).toThrow('Synthetic unreadable legacy payload');read.mockRestore();
    expect(store.read()).toEqual(before);expect(engine.history(actor).total).toBe(1);expect((await engine.run(actor,'identity',reordered,'legacy')).id).toBe(previous.run.id);expect(adapter.modelInfo).not.toHaveBeenCalled();
  });
  it('rejects changes to the fingerprint contract of an existing run transactionally',async()=>{
    const {engine,store}=open(join(fixture(),'loops.sqlite'));engine.create(actor,content);const run=await engine.run(actor,'identity',input,'fixed'),before=store.read();
    expect(()=>store.writeRun({...run,requestFingerprintVersion:undefined})).toThrow('Admission fingerprint contract is immutable.');expect(store.read()).toEqual(before);expect((await engine.run(actor,'identity',reordered,'fixed')).id).toBe(run.id);
  });
});

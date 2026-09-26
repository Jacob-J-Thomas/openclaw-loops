import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Type} from 'typebox';
import {Value} from 'typebox/value';
import {MemoryCore,type MemoryInvocation} from '../src/memory-core.js';
import type {MemoryPolicy} from '../src/memory-policy.js';
import {SqliteStorage} from '../src/storage.js';
import {examples} from '../src/examples.js';

const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const stamp=Date.parse('2026-09-24T00:00:00.000Z');
const policy:MemoryPolicy={version:1,enabled:true,nodes:{
  writer:{readPrefixes:['research'],writeScopes:[{prefix:'research',schemaId:'note',schemaVersion:1,retentionDays:30}],forgetPrefixes:['research']},
  reader:{readPrefixes:['research'],writeScopes:[],forgetPrefixes:[]},
}};
const validator={check:(id:string,version:number,value:unknown)=>id==='note'&&version===1&&Value.Check(Type.Object({text:Type.String({minLength:1})},{additionalProperties:false}),value)};
const invocation=(overrides:Partial<MemoryInvocation>={}):MemoryInvocation=>({owner:{agentId:'main',sessionKey:'agent:main:memory',sessionId:'session-one'},loopId:'research_loop',loopRevision:3,runId:'run_one',nodeId:'writer',grantGeneration:'grant_one',policy,assertAuthorized:()=>{},...overrides});
function setup(){
  const directory=mkdtempSync(join(tmpdir(),'loops-memory-sqlite-')),file=join(directory,'loops.sqlite');
  cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
  const storage=new SqliteStorage(file);cleanups.push(()=>storage.close());storage.write({version:1,loops:{},runs:{}});
  return {directory,file,storage,memory:new MemoryCore(storage,validator)};
}
async function expectFailedOwnerDisposed(file:string){
  await vi.waitFor(()=>{
    expect(existsSync(file+'.lock')).toBe(false);
    const lease=new DatabaseSync(file+'.owner.sqlite');
    try{lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK;');}
    finally{lease.close();}
  });
}

describe('plugin-owned SQLite memory repository',()=>{
  it('persists versioned values, owner isolation, ordered pages, tombstones and receipts across restart',async()=>{
    const {file,storage,memory}=setup();
    memory.write(invocation(),'research.alpha',{text:'A'},'mutation_a',stamp);
    memory.write(invocation(),'research.beta',{text:'B'},'mutation_b',stamp+1);
    const read=invocation({runId:'run_two',nodeId:'reader'});
    expect(memory.consume(read,'research.alpha',stamp+2)).toMatchObject({version:1,value:{text:'A'},provenance:{runId:'run_one',mutationId:'mutation_a'}});
    expect(memory.search(read,'research',undefined,1,stamp+2)).toMatchObject({items:[{key:'research.alpha'}],nextCursor:'research.alpha',total:2});
    expect(memory.search(read,'research','research.alpha',1,stamp+2).items.map(item=>item.key)).toEqual(['research.beta']);
    expect(()=>memory.consume(invocation({owner:{agentId:'main',sessionKey:'agent:main:memory',sessionId:'other-session'}}),'research.alpha',stamp+2)).toThrow(/absent/);
    memory.forget(invocation(),'research.alpha',1,'mutation_forget',stamp+3);
    expect(memory.inspect(invocation(),'research.alpha')).toMatchObject({version:2,deleted:true});
    expect(memory.mutation(invocation(),'mutation_forget')).toMatchObject([{version:2,deleted:true,mutationId:'mutation_forget'}]);
    storage.write({version:1,loops:{},runs:{}});
    expect(memory.mutation(invocation(),'mutation_forget')).toMatchObject([{version:2,deleted:true}]);
    await storage.close();
    const reopened=new SqliteStorage(file);cleanups.push(()=>reopened.close());const recovered=new MemoryCore(reopened,validator);
    expect(recovered.mutation(invocation(),'mutation_forget')).toMatchObject([{version:2,deleted:true}]);
    expect(recovered.search(read,'research',undefined,20,stamp+4).items.map(item=>item.key)).toEqual(['research.beta']);
    expect(recovered.inspect(invocation(),'research.alpha')).toMatchObject({version:2,deleted:true});
    expect(()=>recovered.write(invocation(),'research.gamma',{text:'C'},'mutation_a',stamp+5)).toThrow(/mutation|changed/i);
  });

  it('rejects stale versions, duplicate mutations and quota overflow without a partial write',()=>{
    const {storage,memory}=setup();
    memory.write(invocation(),'research.alpha',{text:'A'},'mutation_a',stamp);
    const original=storage.get(memory.consume(invocation(),'research.alpha',stamp).scope,'research_loop','research.alpha');
    expect(()=>memory.update(invocation(),'research.alpha',{text:'B'},2,'mutation_stale',stamp+1)).toThrow(/changed/);
    expect(()=>memory.write(invocation(),'research.beta',{text:'B'},'mutation_a',stamp+1)).toThrow(/mutation|changed/i);
    const small=new MemoryCore(storage,validator,{maxKeys:1});
    expect(()=>small.write(invocation(),'research.beta',{text:'B'},'mutation_b',stamp+1)).toThrow(/quota/i);
    const receiptLimited=new MemoryCore(storage,validator,{maxReceiptBytes:32});
    expect(()=>receiptLimited.write(invocation(),'research.beta',{text:'B'},'mutation_bytes',stamp+1)).toThrow(/quota/i);
    expect(storage.get(original!.scope,'research_loop','research.alpha')).toEqual(original);
    expect(storage.mutation(original!.scope,'research_loop','mutation_b')).toBeUndefined();
    expect(storage.mutation(original!.scope,'research_loop','mutation_bytes')).toBeUndefined();
  });

  it('reserves finite tombstone headroom when effect receipts reach their quota',async()=>{
    const {file,storage}=setup(),bounded=new MemoryCore(storage,validator,{maxMutations:1,maxReceiptBytes:1024});
    const written=bounded.write(invocation(),'research.alpha',{text:'A'},'mutation_a',stamp);
    expect(()=>bounded.update(invocation(),'research.alpha',{text:'B'},1,'mutation_update',stamp+1)).toThrow(/quota/i);
    expect(bounded.mutation(invocation(),'mutation_a')).toEqual([written]);
    const forgotten=bounded.forget(invocation(),'research.alpha',1,'mutation_forget',stamp+2);
    expect(forgotten).toMatchObject({version:2,deleted:true});
    expect(bounded.mutation(invocation(),'mutation_forget')).toEqual([forgotten]);
    expect(()=>bounded.consume(invocation(),'research.alpha',stamp+3)).toThrow(/absent/);
    expect(()=>bounded.update(invocation(),'research.alpha',{text:'revive'},2,'mutation_revive',stamp+4)).toThrow(/quota/i);
    await storage.close();
    const reopened=new SqliteStorage(file);cleanups.push(()=>reopened.close());const recovered=new MemoryCore(reopened,validator,{maxMutations:1,maxReceiptBytes:1024});
    expect(recovered.mutation(invocation(),'mutation_a')).toEqual([written]);
    expect(recovered.mutation(invocation(),'mutation_forget')).toEqual([forgotten]);
    expect(recovered.inspect(invocation(),'research.alpha')).toMatchObject({version:2,deleted:true});
  });

  it('rolls back a multi-key reset when receipt insertion fails, then commits ordered tombstones',()=>{
    const {file,memory}=setup();
    memory.write(invocation(),'research.alpha',{text:'A'},'mutation_a',stamp);
    memory.write(invocation(),'research.beta',{text:'B'},'mutation_b',stamp+1);
    const plan=memory.removalPreview(invocation(),'research','reset',stamp+2);
    const fault=new DatabaseSync(file);cleanups.push(()=>fault.close());
    fault.exec("CREATE TRIGGER reject_memory_receipt BEFORE INSERT ON memory_receipts WHEN NEW.mutation_id='mutation_reset' BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END;");
    expect(()=>memory.applyRemoval(invocation(),plan,'mutation_reset',stamp+3)).toThrow(/uncertain outcome/);
    expect(memory.mutation(invocation(),'mutation_reset')).toBeUndefined();
    expect(memory.consume(invocation(),'research.alpha',stamp+4).value).toEqual({text:'A'});
    expect(memory.consume(invocation(),'research.beta',stamp+4).value).toEqual({text:'B'});
    fault.exec('DROP TRIGGER reject_memory_receipt');
    const receipts=memory.applyRemoval(invocation(),plan,'mutation_reset',stamp+3);
    expect(receipts.map(row=>row.key)).toEqual(['research.alpha','research.beta']);
    expect(receipts.every(row=>row.deleted)).toBe(true);
    expect(memory.mutation(invocation(),'mutation_reset')).toEqual(receipts);
  });

  it('migrates v3 after a verified backup and rejects malformed memory evidence before a writable handle',async()=>{
    const {directory,file,storage}=setup();
    const definition={...structuredClone(examples[0]),revision:1};
    storage.write({version:1,loops:{[definition.id]:{definition,enabledRevision:1,grants:[]}},runs:{}});
    await storage.close();
    const legacy=new DatabaseSync(file);legacy.exec('DROP TABLE memory_receipts; DROP TABLE memory_mutations; DROP TABLE memory_records; PRAGMA user_version=3;');
    const loops=legacy.prepare('SELECT * FROM loops').all(),revisions=legacy.prepare('SELECT * FROM revisions').all(),runs=legacy.prepare('SELECT * FROM runs').all();legacy.close();
    const upgraded=new SqliteStorage(file);cleanups.push(()=>upgraded.close());
    const backups=readdirSync(directory).filter(name=>name.startsWith('loops.sqlite.before-schema-4-')&&name.endsWith('.bak'));
    expect(backups).toHaveLength(1);const backup=new DatabaseSync(join(directory,backups[0]),{readOnly:true});
    try{expect(backup.prepare('PRAGMA user_version').get()).toEqual({user_version:3});expect(backup.prepare('PRAGMA quick_check').get()).toEqual({quick_check:'ok'});expect(backup.prepare('SELECT * FROM loops').all()).toEqual(loops);expect(backup.prepare('SELECT * FROM revisions').all()).toEqual(revisions);expect(backup.prepare('SELECT * FROM runs').all()).toEqual(runs);}
    finally{backup.close();}
    const current=new DatabaseSync(file,{readOnly:true});
    try{expect(current.prepare('PRAGMA user_version').get()).toEqual({user_version:4});expect(current.prepare('SELECT * FROM loops').all()).toEqual(loops);expect(current.prepare('SELECT * FROM revisions').all()).toEqual(revisions);expect(current.prepare('SELECT * FROM runs').all()).toEqual(runs);}
    finally{current.close();}
    expect(new MemoryCore(upgraded,validator).write(invocation(),'research.new',{text:'new'},'mutation_new',stamp).version).toBe(1);
    await upgraded.close();
    const corrupt=new DatabaseSync(file);corrupt.exec("UPDATE memory_records SET record=json_set(record,'$.key','research.other') WHERE key='research.new'; PRAGMA journal_mode=DELETE;");corrupt.close();
    const bytes=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/memory record identity/);
    await expectFailedOwnerDisposed(file);
    expect(readFileSync(file)).toEqual(bytes);
  });

  it('rejects a damaged mutation ledger and missing receipt foreign key before writing',async()=>{
    const {file,storage,memory}=setup();memory.write(invocation(),'research.note',{text:'held'},'mutation_held',stamp);await storage.close();
    const damage=new DatabaseSync(file);damage.exec("UPDATE memory_mutations SET receipt_count=2 WHERE mutation_id='mutation_held'; PRAGMA journal_mode=DELETE;");damage.close();
    const before=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/receipt count/);
    expect(readFileSync(file)).toEqual(before);
    await expectFailedOwnerDisposed(file);
    const repair=new DatabaseSync(file);
    repair.exec("UPDATE memory_mutations SET receipt_count=1 WHERE mutation_id='mutation_held'; DROP TABLE memory_receipts; CREATE TABLE memory_receipts(scope TEXT NOT NULL,loop_id TEXT NOT NULL,mutation_id TEXT NOT NULL,ordinal INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(scope,loop_id,mutation_id,ordinal));");repair.close();
    const noForeignKey=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/foreign key/);
    expect(readFileSync(file)).toEqual(noForeignKey);
    await expectFailedOwnerDisposed(file);
  });

  it('rejects inconsistent stored provenance times before acquiring a writable store',async()=>{
    const {file,storage,memory}=setup();memory.write(invocation(),'research.note',{text:'held'},'mutation_held',stamp);await storage.close();
    const damage=new DatabaseSync(file);
    damage.exec("UPDATE memory_records SET record=json_set(record,'$.updatedAt','2026-09-24T00:00:01.000Z'); PRAGMA journal_mode=DELETE;");damage.close();
    const before=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/memory record time/);
    expect(readFileSync(file)).toEqual(before);
    await expectFailedOwnerDisposed(file);
    const receiptDamage=new DatabaseSync(file);
    receiptDamage.exec("UPDATE memory_records SET record=json_set(record,'$.updatedAt','2026-09-24T00:00:00.000Z'); UPDATE memory_receipts SET record=json_set(record,'$.committedAt','2026-09-24T00:00:01.000Z'); PRAGMA journal_mode=DELETE;");receiptDamage.close();
    const receiptBefore=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/memory receipt time/);
    expect(readFileSync(file)).toEqual(receiptBefore);
    await expectFailedOwnerDisposed(file);
  });

  it('refuses unexpected memory tables under a v3 header before taking a migration backup',async()=>{
    const {directory,file,storage}=setup();await storage.close();
    const stale=new DatabaseSync(file);stale.exec('DROP TABLE memory_receipts; DROP TABLE memory_mutations; DROP TABLE memory_records; CREATE TABLE memory_records(id TEXT); PRAGMA user_version=3; PRAGMA journal_mode=DELETE;');stale.close();
    const before=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/Unexpected memory tables/);
    await vi.waitFor(()=>expect(existsSync(file+'.lock')).toBe(false));
    expect(readFileSync(file)).toEqual(before);
    expect(readdirSync(directory).filter(name=>name.includes('.before-schema-4-'))).toEqual([]);
  });
});

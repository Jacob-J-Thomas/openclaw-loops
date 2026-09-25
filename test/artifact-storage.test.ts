import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ArtifactCustody,type ArtifactOwner,type ArtifactReference} from '../src/artifact-custody.js';
import {SqliteStorage} from '../src/storage.js';
import {Engine,type Actor} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {MemoryCore} from '../src/memory-core.js';
import {fingerprintJson} from '../src/fingerprint.js';

const disposals:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const dispose of disposals.splice(0).reverse())await dispose();});
const at=Date.parse('2026-09-24T00:00:00.000Z');
const actor:Actor={agentId:'main',sessionKey:'agent:main:artifact-test',sessionId:'artifact-generation',source:'tool',human:false,check:()=>{}};
const owner:ArtifactOwner={agentId:actor.agentId,sessionKey:actor.sessionKey,sessionId:actor.sessionId};
const foreign:ArtifactOwner={...owner,sessionId:'foreign-generation'};
function setup(){
  const root=mkdtempSync(join(tmpdir(),'loops-artifact-sql-'));disposals.push(()=>rmSync(root,{recursive:true,force:true}));
  const file=join(root,'loops.sqlite'),storage=new SqliteStorage(file),custody=new ArtifactCustody(join(root,'artifacts'));
  disposals.push(()=>storage.close());storage.write({version:1,loops:{},runs:{}});
  return {root,file,storage,custody};
}
async function run(storage:SqliteStorage){
  const engine=new Engine(storage,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'fixture'})});
  const result=await engine.test(actor,examples[0],{text:'artifact'},randomUUID());
  return result;
}
function publish(storage:SqliteStorage,ref:ArtifactReference,operationId:string=randomUUID()){
  storage.artifactReserve(owner,[ref],operationId);
  storage.artifactPublished(owner,[ref],operationId);
  return operationId;
}
function artifactFile(root:string,id:string){
  const directory=join(root,'artifacts'),batch=readdirSync(directory).find(name=>name.startsWith('batch-')&&existsSync(join(directory,name,`artifact-${id}.json`)));
  if(!batch)throw new Error('Missing test artifact file.');
  return join(directory,batch,`artifact-${id}.json`);
}
function inspectAll(storage:SqliteStorage,custody:ArtifactCustody){
  const ids:string[]=[];let cursor='';
  for(;;){const page=storage.artifactRecoveryInventory(owner,cursor,2);ids.push(...page.items.map(item=>item.id));if(!page.nextCursor)break;cursor=page.nextCursor;}
  return ids.flatMap((_,index)=>index%100===0?custody.inspectRecovery(owner,ids.slice(index,index+100)):[]);
}
function memoryFor(storage:SqliteStorage){
  const memory=new MemoryCore(storage,{check:()=>true});
  const invocation={owner,loopId:'artifact_memory',loopRevision:1,runId:'memory_writer',nodeId:'writer',grantGeneration:'grant_one',
    policy:{version:1 as const,enabled:true,nodes:{writer:{readPrefixes:['files'],writeScopes:[{prefix:'files',schemaId:'note',schemaVersion:1,retentionDays:30}],forgetPrefixes:['files']}}},assertAuthorized:()=>{}};
  return {memory,invocation};
}
async function disposed(file:string){
  await vi.waitFor(()=>{
    expect(existsSync(file+'.lock')).toBe(false);
    const lease=new DatabaseSync(file+'.owner.sqlite');
    try{lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK;');}
    finally{lease.close();}
  });
}

describe('SQLite artifact reservations, run links and cleanup leases',()=>{
  it('keeps real bytes protected through run retirement when only Memory still refers to them',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage),payload=Uint8Array.of(0,255,23,0);
    const ref=custody.put(owner,{runId:saved.id,nodeId:'file_output'},payload,'application/octet-stream',0,at);
    publish(storage,ref,'memory_hold');storage.writeRun({...saved,outputs:{...saved.outputs,file_output:ref}});
    const {memory,invocation}=memoryFor(storage);
    memory.write(invocation,'files.held',{artifact:ref},'memory_hold_write',at);
    const engine=new Engine(storage,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'fixture'})});
    const plan=engine.retention(actor,{keepLatest:0});
    expect(plan.candidates.map(item=>item.id)).toContain(saved.id);
    engine.retention(actor,plan.policy,plan.planId);
    expect(storage.readRun(saved.id,JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId]))).toBeUndefined();
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    await storage.close();
    const reopened=new SqliteStorage(file);disposals.push(()=>reopened.close());
    expect(reopened.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    expect(new MemoryCore(reopened,{check:()=>true}).consume(invocation,'files.held',at+1).value).toEqual({artifact:ref});
    expect([...custody.readPage(owner,ref.id,0,payload.length,at-1).bytes]).toEqual([...payload]);
    expect(custody.previewCleanupCoordinated(owner,{olderThanDays:0},()=>reopened.artifactProtectedSnapshot(owner),at+1000).candidates).toEqual([]);
  });

  it('moves Memory custody links on update and forget, retaining refs held by another key',()=>{
    const {storage,custody}=setup(),{memory,invocation}=memoryFor(storage);
    const first=custody.put(owner,{runId:'capture-first',nodeId:'upload'},Uint8Array.of(1),'application/octet-stream',0,at);
    const second=custody.put(owner,{runId:'capture-second',nodeId:'upload'},Uint8Array.of(2),'application/octet-stream',0,at);
    publish(storage,first,'first');publish(storage,second,'second');
    memory.write(invocation,'files.one',{artifact:first},'memory_one',at);
    memory.write(invocation,'files.two',{artifact:first},'memory_two',at+1);
    memory.update(invocation,'files.one',{artifact:second},1,'memory_update',at+2);
    expect(storage.artifactProtectedSnapshot(owner).has(first.id)).toBe(true);
    expect(storage.artifactProtectedSnapshot(owner).has(second.id)).toBe(true);
    memory.forget(invocation,'files.two',1,'memory_forget_two',at+3);
    expect(storage.artifactProtectedSnapshot(owner).has(first.id)).toBe(false);
    expect(storage.artifactProtectedSnapshot(owner).has(second.id)).toBe(true);
    memory.forget(invocation,'files.one',2,'memory_forget_one',at+4);
    expect(storage.artifactProtectedSnapshot(owner).has(second.id)).toBe(false);
    const policy={olderThanDays:0},plan=custody.previewCleanupCoordinated(owner,policy,()=>storage.artifactProtectedSnapshot(owner),at+1000);
    expect(plan.candidates.map(ref=>ref.id).sort()).toEqual([first.id,second.id].sort());
    const token=randomUUID();
    expect(custody.applyCleanupCoordinated(owner,policy,plan.planId,{
      begin:()=>storage.artifactBeginCleanup(owner,token,plan,new Date(at+1000).toISOString()),
      finish:receipt=>{storage.artifactFinishCleanup(owner,token,receipt);},
    },at+1000).removed).toBe(2);
  });

  it('rolls back stale and faulted Memory link transactions and rejects foreign custody',()=>{
    const {file,storage,custody}=setup(),{memory,invocation}=memoryFor(storage);
    const ref=custody.put(owner,{runId:'capture-one',nodeId:'upload'},Uint8Array.of(7),'application/octet-stream',0,at);
    publish(storage,ref,'one');
    const foreignRef=custody.put(foreign,{runId:'capture-foreign',nodeId:'upload'},Uint8Array.of(8),'application/octet-stream',0,at);
    storage.artifactReserve(foreign,[foreignRef],'foreign');storage.artifactPublished(foreign,[foreignRef],'foreign');
    expect(()=>memory.write(invocation,'files.bad',{artifact:foreignRef},'memory_foreign',at)).toThrow();
    expect(()=>memory.inspect(invocation,'files.bad')).toThrow(/absent/);
    const fault=new DatabaseSync(file);disposals.push(()=>fault.close());
    fault.exec("CREATE TRIGGER reject_memory_artifact BEFORE INSERT ON artifact_memory_links BEGIN SELECT RAISE(ABORT,'Injected Memory link failure'); END;");
    expect(()=>memory.write(invocation,'files.one',{artifact:ref},'memory_fault',at+1)).toThrow();
    expect(()=>memory.inspect(invocation,'files.one')).toThrow(/absent/);
    expect(memory.mutation(invocation,'memory_fault')).toBeUndefined();
    fault.exec('DROP TRIGGER reject_memory_artifact');
    memory.write(invocation,'files.one',{artifact:ref},'memory_one',at+2);
    expect(()=>memory.update(invocation,'files.one',{artifact:foreignRef},0,'memory_stale',at+3)).toThrow();
    expect(memory.consume(invocation,'files.one',at+4).value).toEqual({artifact:ref});
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
  });

  it('removes custody links through reset and expiry retention batches',()=>{
    const {storage,custody}=setup(),{memory,invocation}=memoryFor(storage);
    const ref=custody.put(owner,{runId:'capture-removal',nodeId:'upload'},Uint8Array.of(12),'application/octet-stream',0,at);
    publish(storage,ref,'removal');
    memory.write(invocation,'files.one',{artifact:ref},'memory_reset_one',at);
    memory.write(invocation,'files.two',{artifact:ref},'memory_reset_two',at+1);
    const reset=memory.removalPreview(invocation,'files','reset',at+2);
    expect(memory.applyRemoval(invocation,reset,'memory_reset',at+3)).toHaveLength(2);
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(false);
    memory.write(invocation,'files.three',{artifact:ref},'memory_retained',at+4);
    const expiry=at+31*24*60*60*1000;
    const retention=memory.removalPreview(invocation,'files','retention',expiry);
    expect(memory.applyRemoval(invocation,retention,'memory_expire',expiry)).toHaveLength(1);
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(false);
  });

  it('rejects a missing Memory custody link before writable cold admission',async()=>{
    const {file,storage,custody}=setup(),{memory,invocation}=memoryFor(storage);
    const ref=custody.put(owner,{runId:'capture-cold',nodeId:'upload'},Uint8Array.of(11),'application/octet-stream',0,at);
    publish(storage,ref,'cold');memory.write(invocation,'files.one',{artifact:ref},'memory_cold',at);
    await storage.close();
    const damaged=new DatabaseSync(file);
    damaged.prepare('DELETE FROM artifact_memory_links WHERE artifact_id=?').run(ref.id);
    damaged.exec('PRAGMA journal_mode=DELETE');damaged.close();
    const before=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/memory reference links/);
    await disposed(file);
    expect(readFileSync(file)).toEqual(before);
  });
  it('persists a binary reference and protects parked and uncertain runs across restart',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const bytes=Uint8Array.from([0,255,1,0,128]),ref=custody.put(owner,{runId:saved.id,nodeId:'file_output'},bytes,'application/octet-stream',0,at);
    const operationId=publish(storage,ref);
    const parked={...saved,state:'waiting' as const,pending:'signal',outputs:{...saved.outputs,file_output:ref}};
    storage.writeRun(parked);
    expect(storage.artifactOperation(owner,operationId)).toMatchObject({status:'published',references:[{everLinked:true}]});
    expect(()=>storage.artifactReleaseUnlinked(owner,ref.id,operationId)).toThrow(/standalone capture/i);
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    expect(storage.artifactProtectedSnapshot(foreign).has(ref.id)).toBe(false);
    await storage.close();
    const reopened=new SqliteStorage(file);disposals.push(()=>reopened.close());
    expect(reopened.readRun(saved.id,JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId]))?.outputs.file_output).toEqual(ref);
    expect(reopened.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    expect([...custody.readPage(owner,ref.id,0,bytes.length,at-1).bytes]).toEqual([...bytes]);
    const uncertain={...parked,state:'cancelled' as const,uncertainty:'Dispatched effect outcome unknown.',pending:undefined};
    reopened.writeRun(uncertain);
    expect(reopened.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    const gcToken=randomUUID(),gcPlan=custody.previewCleanupCoordinated(owner,{olderThanDays:0},()=>reopened.artifactProtectedSnapshot(owner),at+1000);
    expect(gcPlan.candidates).toEqual([]);
    expect(()=>reopened.artifactBeginCleanup(owner,gcToken,gcPlan)).toThrow(/No cleanup candidates/);
    expect(reopened.artifactCleanupLease(owner)).toBeUndefined();
    expect(reopened.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
  });

  it('keeps an unbound reservation protected and rolls back failed link checkpoints',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const ref=custody.put(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(9),'application/octet-stream',0,at);
    const operationId=randomUUID();storage.artifactReserve(owner,[ref],operationId);
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    expect(storage.artifactOperation(owner,operationId)?.status).toBe('reserved');
    expect(()=>storage.artifactReleaseUnlinked(owner,ref.id,operationId)).toThrow(/published operation/i);
    storage.artifactPublished(owner,[ref],operationId);
    const fault=new DatabaseSync(file);disposals.push(()=>fault.close());
    fault.exec("CREATE TRIGGER reject_artifact_link BEFORE INSERT ON artifact_links BEGIN SELECT RAISE(ABORT,'Injected link failure'); END;");
    const changed={...saved,outputs:{...saved.outputs,file_output:ref}};
    expect(()=>storage.writeRun(changed)).toThrow();
    expect(storage.readRun(saved.id,JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId]))?.outputs.file_output).toBeUndefined();
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    fault.exec('DROP TRIGGER reject_artifact_link');
    storage.writeRun(changed);
    expect(storage.artifactOperation(owner,operationId)?.references[0].everLinked).toBe(true);
    expect(()=>storage.artifactPublished(foreign,[ref],operationId)).toThrow();
    expect(()=>storage.artifactReserve(owner,[ref],randomUUID())).toThrow();
  });

  it('releases only a never-linked published capture for explicit cleanup, retaining the release after restart',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage),operationId='unused_capture';
    const ref=custody.put(owner,{runId:`capture-${operationId}`,nodeId:'upload'},Uint8Array.of(4),'application/octet-stream',0,at);
    publish(storage,ref,operationId);
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    expect(()=>storage.artifactReleaseUnlinked(foreign,ref.id,operationId)).toThrow();
    const release=storage.artifactReleaseUnlinked(owner,ref.id,operationId,new Date(at+1).toISOString());
    expect(release).toMatchObject({id:ref.id,status:'released'});
    expect(storage.artifactReleaseUnlinked(owner,ref.id,operationId,new Date(at+2).toISOString())).toEqual(release);
    expect(storage.artifactReferenceStatus(owner,ref.id)).toMatchObject({operationId,status:'released',everLinked:false,releasedAt:new Date(at+1).toISOString()});
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(false);
    expect(()=>storage.writeRun({...saved,outputs:{...saved.outputs,unused:ref}})).toThrow(/released artifact/i);
    const graphOrigin=custody.put(owner,{runId:saved.id,nodeId:'artifact_node'},Uint8Array.of(5),'application/octet-stream',0,at);
    publish(storage,graphOrigin,'graph_origin');
    expect(()=>storage.artifactReleaseUnlinked(owner,graphOrigin.id,'graph_origin')).toThrow(/standalone capture/i);
    const occupied={...saved,id:'capture-run_present',requestKey:'capture-run-present-admission'};
    const direct=new DatabaseSync(file);
    try{
      direct.prepare('INSERT INTO runs(id,owner_key,state,created_at,record) VALUES (?,?,?,?,?)').run(occupied.id,JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId]),occupied.state,occupied.createdAt,JSON.stringify(occupied));
      direct.prepare('INSERT INTO admissions(request_key,fingerprint,run_id) VALUES (?,?,?)').run(occupied.requestKey,occupied.requestFingerprint,occupied.id);
    }finally{direct.close();}
    const runOrigin=custody.put(owner,{runId:'capture-run_present',nodeId:'upload'},Uint8Array.of(6),'application/octet-stream',0,at);
    publish(storage,runOrigin,'run_present');
    expect(()=>storage.artifactReleaseUnlinked(owner,runOrigin.id,'run_present')).toThrow(/standalone capture/i);
    await storage.close();
    const reopened=new SqliteStorage(file);disposals.push(()=>reopened.close());
    expect(reopened.artifactReferenceStatus(owner,ref.id)?.status).toBe('released');
    const policy={olderThanDays:0},plan=custody.previewCleanupCoordinated(owner,policy,()=>reopened.artifactProtectedSnapshot(owner),at+1000);
    expect(plan.candidates.map(item=>item.id)).toEqual([ref.id]);
    const token=randomUUID();
    expect(custody.applyCleanupCoordinated(owner,policy,plan.planId,{
      begin:()=>reopened.artifactBeginCleanup(owner,token,plan,new Date(at+1000).toISOString()),
      finish:receipt=>{reopened.artifactFinishCleanup(owner,token,receipt);},
    },at+1000).removed).toBe(1);
    expect(reopened.artifactReferenceStatus(owner,ref.id)).toMatchObject({status:'retired',releasedAt:new Date(at+1).toISOString()});
    expect(reopened.artifactReleaseUnlinked(owner,ref.id,operationId)).toMatchObject({status:'retired',releasedAt:new Date(at+1).toISOString()});
    expect(reopened.artifactCleanupReceipt(owner,token)?.removed).toBe(1);
  });

  it('reconciles whole-state authoring writes and run links in one SQLite transaction',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const ref=custody.put(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(8),'application/octet-stream',0,at);
    publish(storage,ref);
    const next=storage.read()!;next.runs[saved.id].outputs.file_output=ref;
    storage.write(next);
    const inspect=new DatabaseSync(file);disposals.push(()=>inspect.close());
    expect(inspect.prepare('SELECT active FROM artifact_links WHERE artifact_id=?').get(ref.id)).toEqual({active:1});
    const removal=storage.read()!;delete removal.runs[saved.id].outputs.file_output;
    inspect.exec("CREATE TRIGGER reject_link_retirement BEFORE UPDATE ON artifact_links WHEN NEW.active=0 BEGIN SELECT RAISE(ABORT,'Injected retirement failure'); END;");
    expect(()=>storage.write(removal)).toThrow();
    expect(storage.read()?.runs[saved.id].outputs.file_output).toEqual(ref);
    expect(inspect.prepare('SELECT active FROM artifact_links WHERE artifact_id=?').get(ref.id)).toEqual({active:1});
    inspect.exec('DROP TRIGGER reject_link_retirement');
    storage.write(removal);
    expect(inspect.prepare('SELECT active FROM artifact_links WHERE artifact_id=?').get(ref.id)).toEqual({active:0});
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(false);
  });

  it('orders durable reservation before file publication and retains uncertain post-publish evidence',async()=>{
    const {storage,custody}=setup(),saved=await run(storage),operationId='publish_one';
    const ref=custody.putCoordinated(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(1,0,255),'application/octet-stream',{
      operationId,
      reserve:(refs,id)=>{
        expect(custody.list(owner).total).toBe(0);
        storage.artifactReserve(owner,refs,id);
        expect(storage.artifactOperation(owner,id)?.status).toBe('reserved');
      },
      published:(refs,id)=>{
        expect(custody.list(owner).items).toEqual(refs);
        storage.artifactPublished(owner,refs,id);
      },
    },0,at);
    expect(storage.artifactOperation(owner,operationId)?.status).toBe('published');
    expect(storage.artifactProtectedSnapshot(owner).has(ref.id)).toBe(true);
    const uncertainId='publish_uncertain';
    expect(()=>custody.putCoordinated(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(7),'application/octet-stream',{
      operationId:uncertainId,reserve:(refs,id)=>{storage.artifactReserve(owner,refs,id);},
      published:()=>{throw new Error('Injected acknowledgement loss after rename');},
    },0,at)).toThrow(/uncertain/i);
    const pending=storage.artifactOperation(owner,uncertainId)!;
    expect(pending.status).toBe('reserved');
    const [reservedId]=pending.references.map(item=>item.reference.id);
    expect(custody.inspectRecovery(owner,[reservedId])).toMatchObject([{id:reservedId,status:'published'}]);
    expect(storage.artifactProtectedSnapshot(owner).has(reservedId)).toBe(true);
  });

  it('explicitly acknowledges exact published bytes or abandons an all-missing reservation without replay',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const publishedId='lost_acknowledgement';
    expect(()=>custody.putCoordinated(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(1,255),'application/octet-stream',{
      operationId:publishedId,reserve:(refs,id)=>{storage.artifactReserve(owner,refs,id);},published:()=>{throw new Error('Injected SQL acknowledgement loss');},
    },0,at)).toThrow(/uncertain/i);
    const reserved=storage.artifactOperation(owner,publishedId)!;
    const recoveryId=randomUUID(),before=custody.list(owner).items;
    expect(()=>storage.artifactRecoverPublication(foreign,publishedId,custody.inspectRecovery(owner,reserved.references.map(item=>item.reference.id)),randomUUID())).toThrow();
    expect(()=>storage.artifactRecoverPublication(owner,publishedId,[{id:reserved.references[0].reference.id,status:'uncertain'}],randomUUID())).toThrow(/incomplete|uncertain/i);
    expect(storage.artifactOperation(owner,publishedId)?.status).toBe('reserved');
    const acknowledged=custody.withCoordinationLease(()=>storage.artifactRecoverPublication(owner,publishedId,custody.inspectRecovery(owner,reserved.references.map(item=>item.reference.id)),recoveryId));
    expect(acknowledged.outcome).toBe('published');
    expect(custody.list(owner).items).toEqual(before);
    expect(storage.artifactOperation(owner,publishedId)?.status).toBe('published');
    expect(storage.artifactRecoveryReceipt(owner,recoveryId)).toMatchObject({targetType:'publication',targetId:publishedId,receipt:{outcome:'published'}});
    const missingId='before_file_commit';
    expect(()=>custody.putCoordinated(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(9),'application/octet-stream',{
      operationId:missingId,reserve:(refs,id)=>{storage.artifactReserve(owner,refs,id);throw new Error('Injected failure after reservation');},published:()=>{},
    },0,at)).toThrow(/uncertain/i);
    const missing=storage.artifactOperation(owner,missingId)!;
    expect(storage.artifactProtectedSnapshot(owner).has(missing.references[0].reference.id)).toBe(true);
    const gcPlan=custody.previewCleanupCoordinated(owner,{olderThanDays:0},()=>storage.artifactProtectedSnapshot(owner),at+1000);
    expect(()=>storage.artifactBeginCleanup(owner,randomUUID(),gcPlan)).toThrow(/uncertain artifact publication/i);
    const abandonedId=randomUUID();
    const abandoned=custody.withCoordinationLease(()=>storage.artifactRecoverPublication(owner,missingId,custody.inspectRecovery(owner,missing.references.map(item=>item.reference.id)),abandonedId));
    expect(abandoned.outcome).toBe('abandoned');
    expect(storage.artifactOperation(owner,missingId)?.status).toBe('abandoned');
    expect(storage.artifactProtectedSnapshot(owner).has(missing.references[0].reference.id)).toBe(false);
    expect(()=>storage.artifactRecoverPublication(owner,missingId,[{id:missing.references[0].reference.id,status:'missing'}],randomUUID())).toThrow(/no longer reserved/i);
    expect(()=>storage.artifactPublished(owner,missing.references.map(item=>item.reference),missingId)).toThrow();
    await storage.close();
    const reopened=new SqliteStorage(file);disposals.push(()=>reopened.close());
    expect(reopened.artifactRecoveryReceipt(owner,abandonedId)).toMatchObject({receipt:{outcome:'abandoned'}});
    expect(reopened.artifactOperationsPage(owner,'',1)).toMatchObject({items:[{operationId:missingId,status:'abandoned'}],nextCursor:missingId});
    await reopened.close();
    const damaged=new DatabaseSync(file);damaged.prepare("UPDATE artifact_recovery_receipts SET record=json_set(record,'$.outcome','forged') WHERE recovery_id=?").run(abandonedId);damaged.exec('PRAGMA journal_mode=DELETE');damaged.close();
    const corruptBytes=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/recovery receipt/);
    await disposed(file);expect(readFileSync(file)).toEqual(corruptBytes);
  });

  it('imports fresh IDs through one reservation and rolls back a faulted multi-item reserve',async()=>{
    const {root,file,storage,custody}=setup(),saved=await run(storage);
    const source=new ArtifactCustody(join(root,'source'));
    const a=source.put(owner,{runId:saved.id,nodeId:'source'},Uint8Array.of(1,2),'application/octet-stream',30,at);
    const b=source.put(owner,{runId:saved.id,nodeId:'source'},Uint8Array.of(3,4),'application/octet-stream',30,at+1);
    const bundle=source.export(owner,[{id:a.id,mode:'embedded'},{id:b.id,mode:'embedded'}],at+2);
    const fault=new DatabaseSync(file);disposals.push(()=>fault.close());
    fault.exec("CREATE TRIGGER reject_second_artifact BEFORE INSERT ON artifact_items WHEN NEW.operation_id='multi_fault' AND (SELECT count(*) FROM artifact_items WHERE operation_id=NEW.operation_id)>0 BEGIN SELECT RAISE(ABORT,'Injected second-item failure'); END;");
    const callbacks=(operationId:string)=>({operationId,reserve:(refs:readonly ArtifactReference[],id:string)=>{storage.artifactReserve(owner,refs,id);},published:(refs:readonly ArtifactReference[],id:string)=>{storage.artifactPublished(owner,refs,id);}});
    expect(()=>custody.importCoordinated(owner,{runId:saved.id,nodeId:'import'},bundle,{},callbacks('multi_fault'),30,at+3)).toThrow(/uncertain/i);
    expect(storage.artifactOperation(owner,'multi_fault')).toBeUndefined();
    expect(custody.list(owner).total).toBe(0);
    fault.exec('DROP TRIGGER reject_second_artifact');
    const refs=custody.importCoordinated(owner,{runId:saved.id,nodeId:'import'},bundle,{},callbacks('multi_ok'),30,at+3);
    expect(refs).toHaveLength(2);
    expect(refs.map(ref=>ref.id)).not.toContain(a.id);
    expect(refs.map(ref=>ref.id)).not.toContain(b.id);
    expect(storage.artifactOperation(owner,'multi_ok')?.references).toHaveLength(2);
    expect([...custody.readPage(owner,refs[0].id,0,2,at+4).bytes]).toEqual([1,2]);
  });

  it('leaves a crashed cleanup lease inspectable and refuses every run/state writer after reopen',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const ref=custody.put(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(3),'application/octet-stream',0,at);
    publish(storage,ref);storage.writeRun({...saved,outputs:{...saved.outputs,file_output:ref}});
    const token=randomUUID(),plan=custody.previewCleanupCoordinated(owner,{olderThanDays:0},()=>storage.artifactProtectedSnapshot(owner),at+1000);expect(storage.artifactBeginCleanup(owner,token,plan).has(ref.id)).toBe(false);
    await storage.close();
    const reopened=new SqliteStorage(file);disposals.push(()=>reopened.close());
    expect(reopened.artifactCleanupLease(owner)?.token).toBe(token);
    expect(()=>reopened.writeRun({...saved,updatedAt:new Date(at+1).toISOString()})).toThrow(/cleanup lease/i);
    expect(()=>reopened.write(reopened.read()!)).toThrow(/cleanup lease/i);
    expect(()=>reopened.writeWorkingState(reopened.readWorkingState()!)).toThrow(/cleanup lease/i);
    expect(()=>reopened.artifactReserve(owner,[ref],randomUUID())).toThrow(/cleanup lease/i);
    expect(reopened.artifactCleanupLease(owner)?.token).toBe(token);
    expect(custody.list(owner).items).toEqual([ref]);
  });

  it('reconciles only confirmed missing GC candidates after a crash, preserving parked bytes and partial evidence',async()=>{
    const {root,file,storage,custody}=setup(),completed=await run(storage),parked=await run(storage);
    const a=custody.put(owner,{runId:completed.id,nodeId:'file_output'},Uint8Array.of(1),'application/octet-stream',0,at);
    const b=custody.put(owner,{runId:completed.id,nodeId:'file_output'},Uint8Array.of(2),'application/octet-stream',0,at+1);
    const protectedRef=custody.put(owner,{runId:parked.id,nodeId:'parked_output'},Uint8Array.of(3),'application/octet-stream',0,at+2);
    for(const ref of [a,b,protectedRef])publish(storage,ref);
    storage.writeRun({...completed,outputs:{...completed.outputs,file_output:[a,b]}});
    storage.writeRun({...parked,state:'waiting',pending:'signal',outputs:{...parked.outputs,parked_output:protectedRef}});
    const policy={olderThanDays:0},plan=custody.previewCleanupCoordinated(owner,policy,()=>storage.artifactProtectedSnapshot(owner),at+1000);
    expect(plan.candidates.map(item=>item.id).sort()).toEqual([a.id,b.id].sort());
    const token=randomUUID();expect(storage.artifactBeginCleanup(owner,token,plan).has(protectedRef.id)).toBe(true);
    unlinkSync(artifactFile(root,a.id));
    await storage.close();
    const reopened=new SqliteStorage(file);disposals.push(()=>reopened.close());
    expect(reopened.artifactCleanupLease(owner)?.plan).toEqual(plan);
    const recoveryId=randomUUID();
    expect(()=>reopened.artifactRecoverCleanup(owner,token,[],randomUUID())).toThrow(/incomplete/i);
    expect(reopened.artifactCleanupLease(owner)?.token).toBe(token);
    const result=custody.withCoordinationLease(()=>reopened.artifactRecoverCleanup(owner,token,inspectAll(reopened,custody),recoveryId));
    expect(result).toMatchObject({outcome:'partial',retiredIds:[a.id],remainingIds:[b.id]});
    expect(reopened.artifactCleanupLease(owner)).toBeUndefined();
    expect(reopened.artifactRecoveryReceipt(owner,recoveryId)).toMatchObject({targetType:'cleanup',receipt:{outcome:'partial',plan}});
    expect(reopened.artifactProtectedSnapshot(owner).has(protectedRef.id)).toBe(true);
    expect(custody.inspectRecovery(owner,[protectedRef.id])).toEqual([{id:protectedRef.id,status:'published',reference:protectedRef}]);
    const ledger=new DatabaseSync(file,{readOnly:true});
    try{expect(ledger.prepare('SELECT status FROM artifact_items WHERE id=?').get(a.id)).toEqual({status:'retired'});expect(ledger.prepare('SELECT status FROM artifact_items WHERE id=?').get(b.id)).toEqual({status:'published'});}
    finally{ledger.close();}
    expect(custody.previewCleanupCoordinated(owner,policy,()=>reopened.artifactProtectedSnapshot(owner),at+1000).candidates.map(ref=>ref.id)).toEqual([b.id]);
    await reopened.close();
    const damaged=new DatabaseSync(file);
    const stored=damaged.prepare('SELECT record FROM artifact_recovery_receipts WHERE recovery_id=?').get(recoveryId) as {record:string};
    const altered=JSON.parse(stored.record) as {readback:Array<{id:string;status:string}>};
    altered.readback.find(item=>item.id===a.id)!.status='published';
    damaged.prepare('UPDATE artifact_recovery_receipts SET record=? WHERE recovery_id=?').run(JSON.stringify(altered),recoveryId);
    damaged.exec('PRAGMA journal_mode=DELETE');damaged.close();
    const corruptBytes=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/cleanup recovery readback/);
    await disposed(file);expect(readFileSync(file)).toEqual(corruptBytes);
  });

  it('keeps a GC lease blocked when a protected noncandidate is missing or readback is incomplete',async()=>{
    const {root,storage,custody}=setup(),completed=await run(storage),parked=await run(storage);
    const old=custody.put(owner,{runId:completed.id,nodeId:'file_output'},Uint8Array.of(1),'application/octet-stream',0,at);
    const active=custody.put(owner,{runId:parked.id,nodeId:'parked_output'},Uint8Array.of(2),'application/octet-stream',0,at+1);
    publish(storage,old);publish(storage,active);
    storage.writeRun({...completed,outputs:{...completed.outputs,file_output:old}});
    storage.writeRun({...parked,state:'waiting',pending:'signal',outputs:{...parked.outputs,parked_output:active}});
    const plan=custody.previewCleanupCoordinated(owner,{olderThanDays:0},()=>storage.artifactProtectedSnapshot(owner),at+1000),token=randomUUID();
    storage.artifactBeginCleanup(owner,token,plan);
    unlinkSync(artifactFile(root,active.id));
    const recoveryId=randomUUID();
    expect(()=>custody.withCoordinationLease(()=>storage.artifactRecoverCleanup(owner,token,inspectAll(storage,custody),recoveryId))).toThrow(/noncandidate|protected/i);
    expect(storage.artifactCleanupLease(owner)?.token).toBe(token);
    expect(storage.artifactRecoveryReceipt(owner,recoveryId)).toBeUndefined();
    expect(()=>storage.artifactRecoverCleanup(foreign,token,[],randomUUID())).toThrow();
    expect(storage.artifactCleanupLease(owner)?.token).toBe(token);
  });

  it('retires completed links only after confirmed filesystem cleanup and retains the receipt',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const ref=custody.put(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(7,8),'application/octet-stream',0,at);
    publish(storage,ref);storage.writeRun({...saved,outputs:{...saved.outputs,file_output:ref}});
    const policy={olderThanDays:0},token=randomUUID();
    const plan=custody.previewCleanupCoordinated(owner,policy,()=>storage.artifactProtectedSnapshot(owner),at+1000);
    expect(plan.candidates.map(item=>item.id)).toEqual([ref.id]);
    const receipt=custody.applyCleanupCoordinated(owner,policy,plan.planId,{
      begin:()=>storage.artifactBeginCleanup(owner,token,plan,new Date(at+1001).toISOString()),
      finish:confirmed=>{storage.artifactFinishCleanup(owner,token,confirmed);},
    },at+1001);
    expect(receipt.removed).toBe(1);
    expect(storage.artifactCleanupLease(owner)).toBeUndefined();
    expect(custody.list(owner).items).toEqual([]);
    storage.writeRun({...saved,updatedAt:new Date(at+2000).toISOString(),outputs:{...saved.outputs,file_output:ref}});
    expect(()=>storage.writeRun({...saved,outputs:{...saved.outputs,file_output:ref,another_node:ref}})).toThrow(/Retired artifact/);
    const ledger=new DatabaseSync(file,{readOnly:true});
    try{expect(ledger.prepare('SELECT status FROM artifact_items WHERE id=?').get(ref.id)).toEqual({status:'retired'});expect(ledger.prepare('SELECT active FROM artifact_links WHERE artifact_id=?').get(ref.id)).toEqual({active:0});expect(ledger.prepare('SELECT count(*) AS count FROM artifact_gc_receipts').get()).toEqual({count:1});}
    finally{ledger.close();}
  });

  it('refuses lifetime metadata growth but keeps admitted cleanup and receipts possible at the cap after restart',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const ref=custody.put(owner,{runId:saved.id,nodeId:'output'},Uint8Array.of(11),'application/octet-stream',0,at);
    publish(storage,ref,'live_operation');
    storage.writeRun({...saved,outputs:{...saved.outputs,output:ref}});
    // Populate legitimate terminal history through a separate SQLite writer.
    // No binary files are needed for abandoned reservations, and these rows
    // exercise the actual worker admission check, not a mocked quota method.
    const seed=new DatabaseSync(file);
    try{
      seed.exec('BEGIN IMMEDIATE');
      const op=seed.prepare("INSERT INTO artifact_operations(scope,operation_id,status,reference_count) VALUES (?,?,'abandoned',1)");
      const item=seed.prepare("INSERT INTO artifact_items(id,scope,operation_id,status,record) VALUES (?,?,?,'abandoned',?)");
      for(let index=0;index<4095;index++){
        const operationId=`historic_${index}`,old={...ref,id:randomUUID()};
        op.run(ref.ownerScope,operationId);item.run(old.id,ref.ownerScope,operationId,JSON.stringify(old));
      }
      seed.exec('COMMIT');
    }finally{seed.close();}
    expect(()=>storage.artifactReserve(owner,[{...ref,id:randomUUID()}],'beyond_cap')).toThrow(/metadata quota/i);
    expect(storage.artifactOperation(owner,'beyond_cap')).toBeUndefined();
    const policy={olderThanDays:0},plan=custody.previewCleanupCoordinated(owner,policy,()=>storage.artifactProtectedSnapshot(owner),at+1000);
    expect(plan.candidates.map(item=>item.id)).toEqual([ref.id]);
    const token=randomUUID();
    const receipt=custody.applyCleanupCoordinated(owner,policy,plan.planId,{
      begin:()=>storage.artifactBeginCleanup(owner,token,plan,new Date(at+1000).toISOString()),
      finish:result=>{storage.artifactFinishCleanup(owner,token,result);},
    },at+1000);
    expect(receipt.removed).toBe(1);
    await storage.close();
    const reopened=new SqliteStorage(file);disposals.push(()=>reopened.close());
    expect(reopened.artifactCleanupReceipt(owner,token)).toMatchObject({removed:1});
    expect(reopened.artifactOperation(owner,'live_operation')?.references[0].status).toBe('retired');
    expect(()=>reopened.artifactReserve(owner,[{...ref,id:randomUUID()}],'still_at_cap')).toThrow(/metadata quota/i);
    const inspect=new DatabaseSync(file,{readOnly:true});
    try{expect(inspect.prepare('SELECT count(*) AS n FROM artifact_gc_receipts').get()).toEqual({n:1});}
    finally{inspect.close();}
    for(let index=0;index<10;index++){
      const empty=custody.previewCleanupCoordinated(owner,policy,()=>reopened.artifactProtectedSnapshot(owner),at+2000+index);
      expect(empty.candidates).toEqual([]);
      expect(()=>reopened.artifactBeginCleanup(owner,randomUUID(),empty)).toThrow(/No cleanup candidates/);
    }
    const unchanged=new DatabaseSync(file,{readOnly:true});
    try{expect(unchanged.prepare('SELECT count(*) AS n FROM artifact_gc_receipts').get()).toEqual({n:1});expect(unchanged.prepare('SELECT count(*) AS n FROM artifact_recovery_receipts').get()).toEqual({n:0});}
    finally{unchanged.close();}
    await reopened.close();
    const corrupt=new DatabaseSync(file),extra={...ref,id:randomUUID()};
    corrupt.prepare("INSERT INTO artifact_operations(scope,operation_id,status,reference_count) VALUES (?,?,'abandoned',1)").run(ref.ownerScope,'over_limit_tamper');
    corrupt.prepare("INSERT INTO artifact_items(id,scope,operation_id,status,record) VALUES (?,?,?,'abandoned',?)").run(extra.id,ref.ownerScope,'over_limit_tamper',JSON.stringify(extra));
    corrupt.exec('PRAGMA journal_mode=DELETE');corrupt.close();
    const original=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/metadata quota/);
    await disposed(file);expect(readFileSync(file)).toEqual(original);
  },30_000);

  it('migrates an actual v4 memory store with a verified backup, and rejects corrupt v5 reference rows read-only',async()=>{
    const {root,file,storage}=setup();
    const memory=new MemoryCore(storage,{check:(id,version)=>id==='note'&&version===1});
    const invocation={owner,loopId:'research_loop',loopRevision:1,runId:'run_one',nodeId:'writer',grantGeneration:'grant_one',policy:{version:1 as const,enabled:true,nodes:{writer:{readPrefixes:['research'],writeScopes:[{prefix:'research',schemaId:'note',schemaVersion:1,retentionDays:30}],forgetPrefixes:['research']}}},assertAuthorized:()=>{}};
    memory.write(invocation,'research.note',{text:'held'},'mutation_one',at);
    const lookalike={kind:'loops-artifact',id:randomUUID(),sha256:'a'.repeat(64),mediaType:'application/octet-stream',bytes:3,ownerScope:'b'.repeat(64),runId:'legacy',nodeId:'upload',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+1000).toISOString()};
    memory.write(invocation,'research.lookalike',{text:'v4 placeholder'},'mutation_lookalike',at+1);
    await storage.close();
    const old=new DatabaseSync(file);
    old.exec('DROP TABLE artifact_memory_links; DROP TABLE artifact_memory_opaque; DROP TABLE artifact_links; DROP TABLE artifact_items; DROP TABLE artifact_operations; DROP TABLE artifact_gc; DROP TABLE artifact_gc_receipts; DROP TABLE artifact_recovery_receipts; PRAGMA user_version=4; PRAGMA journal_mode=DELETE;');
    const v4=JSON.parse((old.prepare("SELECT record FROM memory_records WHERE key='research.lookalike'").get() as {record:string}).record);
    v4.value={artifact:lookalike};v4.valueSha256=fingerprintJson(v4.value);
    old.prepare("UPDATE memory_records SET value_bytes=?,record=? WHERE key='research.lookalike'").run(Buffer.byteLength(JSON.stringify(v4.value)),JSON.stringify(v4));
    const before=old.prepare('SELECT * FROM memory_records').all();old.close();
    const upgraded=new SqliteStorage(file);disposals.push(()=>upgraded.close());
    const backupName=readdirSync(root).find(name=>name.startsWith('loops.sqlite.before-schema-5-')&&name.endsWith('.bak'));
    expect(backupName).toBeDefined();
    const backup=new DatabaseSync(join(root,backupName!),{readOnly:true});
    try{expect(backup.prepare('PRAGMA user_version').get()).toEqual({user_version:4});expect(backup.prepare('PRAGMA quick_check').get()).toEqual({quick_check:'ok'});expect(backup.prepare('SELECT * FROM memory_records').all()).toEqual(before);}
    finally{backup.close();}
    expect(upgraded.integrity()).toEqual([{integrity_check:'ok'}]);
    expect(new MemoryCore(upgraded,{check:(id,version)=>id==='note'&&version===1}).consume(invocation,'research.note',at+1).value).toEqual({text:'held'});
    expect(new MemoryCore(upgraded,{check:(id,version)=>id==='note'&&version===1}).consume(invocation,'research.lookalike',at+2).value).toEqual({artifact:lookalike});
    const migrated=new DatabaseSync(file,{readOnly:true});
    try{expect(migrated.prepare('SELECT count(*) AS n FROM artifact_memory_opaque').get()).toEqual({n:2});expect(migrated.prepare('SELECT count(*) AS n FROM artifact_memory_links').get()).toEqual({n:0});}
    finally{migrated.close();}
    expect(()=>new MemoryCore(upgraded,{check:(id,version)=>id==='note'&&version===1}).update(invocation,'research.lookalike',{artifact:lookalike},1,'mutation_rebind',at+3)).toThrow();
    new MemoryCore(upgraded,{check:(id,version)=>id==='note'&&version===1}).update(invocation,'research.lookalike',{text:'now v5'},1,'mutation_plain',at+4);
    const cleared=new DatabaseSync(file,{readOnly:true});
    try{expect(cleared.prepare("SELECT count(*) AS n FROM artifact_memory_opaque WHERE memory_key='research.lookalike'").get()).toEqual({n:0});}
    finally{cleared.close();}
    await upgraded.close();
    const corrupt=new DatabaseSync(file);corrupt.exec("INSERT INTO artifact_operations VALUES ('"+'a'.repeat(64)+"','00000000-0000-0000-0000-000000000000','reserved',1); PRAGMA journal_mode=DELETE;");corrupt.close();
    const bytes=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/reservation count/);
    await disposed(file);
    expect(readFileSync(file)).toEqual(bytes);
  });

  it('rejects a damaged artifact index and a link that no longer matches its run before writable admission',async()=>{
    const {file,storage,custody}=setup(),saved=await run(storage);
    const ref=custody.put(owner,{runId:saved.id,nodeId:'file_output'},Uint8Array.of(5),'application/octet-stream',0,at);
    publish(storage,ref);storage.writeRun({...saved,outputs:{...saved.outputs,file_output:ref}});await storage.close();
    const damaged=new DatabaseSync(file);damaged.exec('DROP INDEX artifact_links_item; PRAGMA journal_mode=DELETE;');damaged.close();
    const before=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/index artifact_links_item/);
    await disposed(file);expect(readFileSync(file)).toEqual(before);
    const repaired=new DatabaseSync(file);
    repaired.exec("CREATE INDEX artifact_links_item ON artifact_links(artifact_id,active); UPDATE runs SET record=json_remove(record,'$.outputs.file_output') WHERE id='"+saved.id+"'; PRAGMA journal_mode=DELETE;");repaired.close();
    const mismatch=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/run link/);
    await disposed(file);expect(readFileSync(file)).toEqual(mismatch);
  });
});

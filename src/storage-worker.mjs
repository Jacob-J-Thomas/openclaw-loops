import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync,backup} from 'node:sqlite';
import {chmodSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Only this worker opens the plugin database. The host database is never used.
let database;
let startupError;
let schemaVersion=0;
const currentSchemaVersion=4;
let writable=false;
const memoryName=/^[a-z][a-z0-9_-]{0,47}$/,memoryId=/^[a-zA-Z0-9_-]{1,128}$/,memoryDigest=/^[a-f0-9]{64}$/,memoryKey=/^[a-z][a-z0-9_.-]{0,63}$/;
const exactFields=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===fields.slice().sort().join(',');
const validTime=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const validKey=value=>typeof value==='string'&&memoryKey.test(value)&&!value.split('.').some(part=>!part||['__proto__','prototype','constructor'].includes(part));
const isJson=(value,depth=0)=>depth<=100&&(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||Array.isArray(value)&&value.every(item=>isJson(item,depth+1))||value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.entries(value).every(([key,item])=>!['__proto__','constructor','prototype'].includes(key)&&isJson(item,depth+1)));
const memoryFingerprint=value=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item)).digest('hex');
function validateMemoryProvenance(value,mutationId){
  if(!exactFields(value,['at','grantGeneration','loopRevision','mutationId','nodeId','operation','runId'])||!validTime(value.at)||!memoryId.test(value.grantGeneration)||!Number.isSafeInteger(value.loopRevision)||value.loopRevision<1||!memoryId.test(value.mutationId)||mutationId!==undefined&&value.mutationId!==mutationId||!memoryName.test(value.nodeId)||!['write','update','forget','retention','reset'].includes(value.operation)||!memoryId.test(value.runId))throw new Error('Invalid saved memory provenance.');
}
function validateMemoryRecord(record,scope,loopId,key){
  const fields=['createdAt','deleted','expiresAt','key','loopId','provenance','schemaId','schemaVersion','scope','updatedAt','version'];
  if(!record||typeof record!=='object'||typeof record.deleted!=='boolean'||!exactFields(record,record.deleted?fields:[...fields,'value','valueSha256'])||record.scope!==scope||record.loopId!==loopId||record.key!==key||!memoryDigest.test(scope)||!memoryName.test(loopId)||!validKey(key)||!Number.isSafeInteger(record.version)||record.version<1||!memoryName.test(record.schemaId)||!Number.isSafeInteger(record.schemaVersion)||record.schemaVersion<1||record.schemaVersion>1_000_000||!validTime(record.createdAt)||!validTime(record.updatedAt)||!validTime(record.expiresAt)||Date.parse(record.updatedAt)<Date.parse(record.createdAt)||Date.parse(record.expiresAt)<Date.parse(record.createdAt))throw new Error('Invalid saved memory record identity.');
  validateMemoryProvenance(record.provenance);
  if(record.updatedAt!==record.provenance.at)throw new Error('Invalid saved memory record time.');
  if(record.deleted)return 0;
  if(!isJson(record.value)||typeof record.valueSha256!=='string'||!memoryDigest.test(record.valueSha256)||memoryFingerprint(record.value)!==record.valueSha256)throw new Error('Invalid saved memory value digest.');
  return Buffer.byteLength(JSON.stringify(record.value));
}
function validateMemoryReceipt(receipt,scope,loopId,mutationId){
  if(!exactFields(receipt,['committedAt','deleted','key','loopId','mutationId','provenance','scope','version'])||receipt.scope!==scope||receipt.loopId!==loopId||receipt.mutationId!==mutationId||!memoryDigest.test(scope)||!memoryName.test(loopId)||!memoryId.test(mutationId)||!validKey(receipt.key)||!Number.isSafeInteger(receipt.version)||receipt.version<1||typeof receipt.deleted!=='boolean'||!validTime(receipt.committedAt))throw new Error('Invalid saved memory receipt identity.');
  validateMemoryProvenance(receipt.provenance,mutationId);
  if(receipt.committedAt!==receipt.provenance.at)throw new Error('Invalid saved memory receipt time.');
}
function validateMemoryStore(){
  const tables={memory_records:[['scope','TEXT',1],['loop_id','TEXT',2],['key','TEXT',3],['version','INTEGER',0],['deleted','INTEGER',0],['value_bytes','INTEGER',0],['record','TEXT',0]],memory_mutations:[['scope','TEXT',1],['loop_id','TEXT',2],['mutation_id','TEXT',3],['kind','TEXT',0],['receipt_count','INTEGER',0],['receipt_bytes','INTEGER',0]],memory_receipts:[['scope','TEXT',1],['loop_id','TEXT',2],['mutation_id','TEXT',3],['ordinal','INTEGER',4],['record','TEXT',0]]};
  for(const [name,expected] of Object.entries(tables)){
    const kind=database.prepare("SELECT type FROM sqlite_schema WHERE name=?").get(name)?.type;
    const columns=database.prepare(`PRAGMA table_info(${name})`).all();
    const indexes=database.prepare(`PRAGMA index_list(${name})`).all();
    if(kind!=='table'||JSON.stringify(columns.map(column=>[column.name,column.type,column.pk,Number(column.notnull)]))!==JSON.stringify(expected.map(([column,type,primary])=>[column,type,primary,1]))||!indexes.some(index=>index.origin==='pk'&&index.unique===1))throw new Error(`Invalid saved memory table or primary-key index: ${name}.`);
  }
  const foreign=database.prepare('PRAGMA foreign_key_list(memory_receipts)').all();
  if(JSON.stringify(foreign.map(row=>[row.id,row.seq,row.table,row.from,row.to,row.on_delete]))!==JSON.stringify([[0,0,'memory_mutations','scope','scope','RESTRICT'],[0,1,'memory_mutations','loop_id','loop_id','RESTRICT'],[0,2,'memory_mutations','mutation_id','mutation_id','RESTRICT']]))throw new Error('Invalid saved memory receipt foreign key.');
  if(database.prepare('PRAGMA foreign_key_check').get()||database.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Invalid saved memory table or index integrity.');
  for(const row of database.prepare('SELECT scope,loop_id,key,version,deleted,value_bytes,record FROM memory_records').iterate()){
    const record=JSON.parse(row.record),bytes=validateMemoryRecord(record,row.scope,row.loop_id,row.key);
    if(row.version!==record.version||row.deleted!==Number(record.deleted)||row.value_bytes!==bytes)throw new Error('Invalid saved memory record index.');
  }
  for(const row of database.prepare('SELECT scope,loop_id,mutation_id,kind,receipt_count,receipt_bytes FROM memory_mutations').iterate()){
    if(!memoryDigest.test(row.scope)||!memoryName.test(row.loop_id)||!memoryId.test(row.mutation_id)||!['effect','cleanup'].includes(row.kind)||!Number.isSafeInteger(row.receipt_count)||row.receipt_count<1||!Number.isSafeInteger(row.receipt_bytes)||row.receipt_bytes<1)throw new Error('Invalid saved memory mutation index.');
    let count=0,bytes=0;
    for(const receipt of database.prepare('SELECT ordinal,record FROM memory_receipts WHERE scope=? AND loop_id=? AND mutation_id=? ORDER BY ordinal').iterate(row.scope,row.loop_id,row.mutation_id)){
      if(receipt.ordinal!==count++)throw new Error('Invalid saved memory receipt order.');
      const value=JSON.parse(receipt.record);validateMemoryReceipt(value,row.scope,row.loop_id,row.mutation_id);
      if((['write','update'].includes(value.provenance.operation)?'effect':'cleanup')!==row.kind)throw new Error('Invalid saved memory mutation kind.');
      bytes+=Buffer.byteLength(receipt.record);
    }
    if(row.receipt_count!==count||row.receipt_bytes!==bytes)throw new Error('Invalid saved memory receipt count.');
  }
}
try{
if(existsSync(workerData.file)){
  // A writable connection can checkpoint a crashed WAL on close, even when
  // admission rejects it before any writer pragma. Read the WAL-aware version
  // through a read-only connection first; immutable mode would ignore its WAL.
  database=new DatabaseSync(workerData.file,{readOnly:true});
  schemaVersion=database.prepare('PRAGMA user_version').get().user_version;
  if(schemaVersion>currentSchemaVersion)throw new Error('The Loops database requires a newer plugin; restore a matching app/database backup.');
  const integrity=database.prepare('PRAGMA quick_check').get().quick_check;
  if(integrity!=='ok')throw new Error(`Loops database integrity check failed: ${integrity}`);
  if(schemaVersion===0){
    if(database.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get())throw new Error('Invalid unversioned Loops database schema.');
  }else{
      if(schemaVersion<4&&database.prepare("SELECT 1 FROM sqlite_schema WHERE name IN ('memory_records','memory_mutations','memory_receipts') LIMIT 1").get())throw new Error('Unexpected memory tables in an older Loops schema.');
      // Check required columns and JSON syntax without materializing cold history.
      // Schema 1 legitimately lacks the retired-admission table added by schema 2.
      const tables={metadata:'key,value',loops:'id,record',revisions:'loop_id,revision,definition',runs:'id,owner_key,state,created_at,record',admissions:'request_key,fingerprint,run_id',attempts:'run_id,sequence,node_id,state,evidence',outputs:'run_id,node_id,value',events:'sequence,run_id,state,at',...schemaVersion>=2?{retired_admissions:'request_key,record'}:{},...schemaVersion>=4?{memory_records:'scope,loop_id,key,version,deleted,value_bytes,record',memory_mutations:'scope,loop_id,mutation_id,kind,receipt_count,receipt_bytes',memory_receipts:'scope,loop_id,mutation_id,ordinal,record'}:{}};
      for(const [table,columns] of Object.entries(tables))database.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
      for(const [table,column] of Object.entries({metadata:'value',loops:'record',revisions:'definition',runs:'record',attempts:'evidence',outputs:'value',...schemaVersion>=2?{retired_admissions:'record'}:{},...schemaVersion>=4?{memory_records:'record',memory_receipts:'record'}:{}})){
        if(database.prepare(`SELECT 1 FROM ${table} WHERE NOT json_valid(${column}) LIMIT 1`).get())throw new Error(`Invalid saved JSON in Loops ${table}.`);
      }
      if(!database.prepare("SELECT 1 FROM metadata WHERE key='version'").get()){
        for(const table of Object.keys(tables))if(database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw new Error('Invalid Loops state: saved records have no format version.');
      }
      if(schemaVersion>=4)validateMemoryStore();
    }
}
}catch(error){startupError=error;}
const initialize=async()=>{
if(writable)throw new Error('Loops storage is already initialized.');
// The coordinator validates read-working with the existing typed state contract
// before sending initialize. Rejected restores never acquire a writable handle.
database?.close();
database=new DatabaseSync(workerData.file);
writable=true;
database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
if(schemaVersion>0&&schemaVersion<currentSchemaVersion){
  const destination=`${workerData.file}.before-schema-${currentSchemaVersion}-${Date.now()}.bak`;
  await backup(database,destination);chmodSync(destination,0o600);
  const snapshot=new DatabaseSync(destination,{readOnly:true});
  try{if(snapshot.prepare('PRAGMA quick_check').get().quick_check!=='ok'||snapshot.prepare('PRAGMA user_version').get().user_version!==schemaVersion)throw new Error('Pre-migration backup verification failed. The original schema has not been changed.');}finally{snapshot.close();}
}
// Schema 4 adds plugin-owned, owner-scoped memory with immutable mutation
// receipts. Older readers must not silently discard value or tombstone history.
try{database.exec(`
  BEGIN IMMEDIATE;
  CREATE TABLE IF NOT EXISTS memory_records(scope TEXT NOT NULL,loop_id TEXT NOT NULL,key TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),value_bytes INTEGER NOT NULL CHECK(value_bytes>=0),record TEXT NOT NULL CHECK(json_valid(record)),PRIMARY KEY(scope,loop_id,key));
  CREATE TABLE IF NOT EXISTS memory_mutations(scope TEXT NOT NULL,loop_id TEXT NOT NULL,mutation_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('effect','cleanup')),receipt_count INTEGER NOT NULL CHECK(receipt_count>0),receipt_bytes INTEGER NOT NULL CHECK(receipt_bytes>=0),PRIMARY KEY(scope,loop_id,mutation_id));
  CREATE TABLE IF NOT EXISTS memory_receipts(scope TEXT NOT NULL,loop_id TEXT NOT NULL,mutation_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=0),record TEXT NOT NULL CHECK(json_valid(record)),PRIMARY KEY(scope,loop_id,mutation_id,ordinal),FOREIGN KEY(scope,loop_id,mutation_id) REFERENCES memory_mutations(scope,loop_id,mutation_id) ON DELETE RESTRICT);
  CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS loops(id TEXT PRIMARY KEY, record TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS revisions(loop_id TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, PRIMARY KEY(loop_id,revision));
  CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS runs_owner_created ON runs(owner_key,created_at DESC,id);
  CREATE INDEX IF NOT EXISTS runs_owner_created_desc ON runs(owner_key,created_at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS runs_working ON runs(id) WHERE state IN ('running','queued') OR json_extract(record,'$.cleanupPending')=1;
  CREATE TABLE IF NOT EXISTS admissions(request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, run_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS retired_admissions(request_key TEXT PRIMARY KEY, record TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attempts(run_id TEXT NOT NULL, sequence INTEGER NOT NULL, node_id TEXT NOT NULL, state TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
  CREATE TABLE IF NOT EXISTS outputs(run_id TEXT NOT NULL, node_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(run_id,node_id));
  CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL);
  PRAGMA user_version=${currentSchemaVersion};
`);
validateMemoryStore();
const integrity=database.prepare('PRAGMA quick_check').get().quick_check;
if(integrity!=='ok')throw new Error(`Loops database integrity check failed: ${integrity}`);
database.exec('COMMIT');
}catch(error){if(database.isTransaction)database.exec('ROLLBACK');throw error;}
};
const port=workerData.port;
const read=()=>{
  const version=database.prepare("SELECT value FROM metadata WHERE key='version'").get();
  if(!version)return undefined;
  const retired=database.prepare('SELECT request_key,record FROM retired_admissions').all();
  return {version:JSON.parse(version.value),loops:Object.fromEntries(database.prepare('SELECT id,record FROM loops').all().map(row=>[row.id,JSON.parse(row.record)])),runs:Object.fromEntries(database.prepare('SELECT id,record FROM runs').all().map(row=>[row.id,JSON.parse(row.record)])),...retired.length?{retiredAdmissions:Object.fromEntries(retired.map(row=>[row.request_key,JSON.parse(row.record)]))}:{}};
};
const workingState=()=>{
  if(!writable&&schemaVersion===0)return undefined;
  const version=database.prepare("SELECT value FROM metadata WHERE key='version'").get();
  if(!version)return undefined;
  const loops=Object.fromEntries(database.prepare('SELECT id,record FROM loops').all().map(row=>[row.id,JSON.parse(row.record)]));
  // Imported POC history may contain an older pinned revision that the mutable
  // definition record lost. Preserve it without materializing historical outputs.
  for(const row of database.prepare(`SELECT DISTINCT json_extract(record,'$.definition') AS definition FROM runs
    WHERE json_extract(record,'$.testMode') IS NOT 1 AND NOT EXISTS
    (SELECT 1 FROM revisions WHERE loop_id=json_extract(runs.record,'$.definition.id') AND revision=json_extract(runs.record,'$.definition.revision'))`).all()){
    const definition=JSON.parse(row.definition),record=loops[definition.id];
    if(record){record.revisions??={[record.definition.revision]:record.definition};record.revisions[definition.revision]??=definition;}
  }
  return {version:JSON.parse(version.value),loops,runs:Object.fromEntries(database.prepare("SELECT id,record FROM runs WHERE state IN ('running','queued') OR json_extract(record,'$.cleanupPending')=1").all().map(row=>[row.id,JSON.parse(row.record)]))};
};
const summaryColumns="id,state,created_at AS createdAt,json_extract(record,'$.updatedAt') AS updatedAt,json_extract(record,'$.executions') AS executions,json_extract(record,'$.definition.slug') AS slug,json_extract(record,'$.definition.revision') AS revision";
const summaries=(owner,cursor,limit)=>database.prepare(`SELECT ${summaryColumns} FROM runs WHERE owner_key=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(owner,limit,cursor);
const history=({owner,cursor,limit})=>{
  const {total}=database.prepare('SELECT count(*) AS total FROM runs WHERE owner_key=?').get(owner);
  return {items:summaries(owner,cursor,limit),nextCursor:cursor+limit<total?cursor+limit:null,total};
};
const runMetadata=()=>database.prepare(`SELECT id,state,created_at AS createdAt,owner_key AS ownerKey,json_extract(record,'$.id') AS recordId,
  json_extract(record,'$.state') AS recordState,json_extract(record,'$.createdAt') AS recordCreatedAt,
  json_type(record,'$.cleanupPending') AS cleanupType,json_type(record,'$.parentRunId') AS parentType,
  json_type(record,'$.requestFingerprintVersion') AS fingerprintType,json_extract(record,'$.requestFingerprintVersion') AS requestFingerprintVersion,
  admissions.run_id AS admissionId,admissions.fingerprint AS admissionFingerprint,
  json_extract(record,'$.owner') AS owner,json_extract(record,'$.requestKey') AS requestKey,
  json_extract(record,'$.requestFingerprint') AS requestFingerprint,json_extract(record,'$.updatedAt') AS updatedAt,
  json_extract(record,'$.parentRunId') AS parentRunId,json_extract(record,'$.cleanupPending') AS cleanupPending FROM runs
  LEFT JOIN admissions ON admissions.request_key=json_extract(record,'$.requestKey')`).all().map(row=>{
    const {ownerKey,recordId,recordState,recordCreatedAt,cleanupType,parentType,fingerprintType,admissionId,admissionFingerprint,...record}=row,owner=JSON.parse(record.owner);
    if(recordId!==record.id||recordState!==record.state||recordCreatedAt!==record.createdAt||!owner||JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId])!==ownerKey||admissionId!==record.id||admissionFingerprint!==record.requestFingerprint)throw new Error('Invalid saved history metadata: its identity index is inconsistent.');
    if(cleanupType!==null&&!['true','false'].includes(cleanupType)||parentType!==null&&parentType!=='text')throw new Error('Invalid saved history metadata: recovery and cleanup fields have invalid types.');
    if(fingerprintType!==null&&(fingerprintType!=='integer'||record.requestFingerprintVersion!==2))throw new Error('Invalid saved history metadata: unsupported admission fingerprint version.');
    if(fingerprintType===null)delete record.requestFingerprintVersion;
    return {...record,owner,...record.parentRunId===null?{parentRunId:undefined}:{},cleanupPending:record.cleanupPending===1};
  });
const memoryConflict=()=>Object.assign(new Error('Memory compare-and-swap or mutation identity conflict.'),{code:'LOOPS_MEMORY_CONFLICT'});
const memoryQuota=()=>Object.assign(new Error('Memory quota exceeded.'),{code:'LOOPS_MEMORY_QUOTA'});
const memoryGet=({scope,loopId,key})=>{
  if(!memoryDigest.test(scope)||!memoryName.test(loopId)||!validKey(key))throw new Error('Invalid memory read identity.');
  const row=database.prepare('SELECT record FROM memory_records WHERE scope=? AND loop_id=? AND key=?').get(scope,loopId,key);
  return row?JSON.parse(row.record):undefined;
};
const memoryPage=({scope,loopId,prefix,cursor,limit})=>{
  if(!memoryDigest.test(scope)||!memoryName.test(loopId)||!validKey(prefix)||cursor!==undefined&&!validKey(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('Invalid memory page identity.');
  const child=`${prefix}.`,predicate='scope=? AND loop_id=? AND (key=? OR substr(key,1,?)=?)';
  const args=[scope,loopId,prefix,child.length,child];
  const {total}=database.prepare(`SELECT count(*) AS total FROM memory_records WHERE ${predicate}`).get(...args);
  const rows=database.prepare(`SELECT key,record FROM memory_records WHERE ${predicate} AND key>? ORDER BY key LIMIT ?`).all(...args,cursor??'',limit+1);
  const items=rows.slice(0,limit).map(row=>JSON.parse(row.record));
  return {items,nextCursor:rows.length>limit?rows[limit-1].key:null,total};
};
const memoryMutation=({scope,loopId,mutationId})=>{
  if(!memoryDigest.test(scope)||!memoryName.test(loopId)||!memoryId.test(mutationId))throw new Error('Invalid memory mutation identity.');
  const found=database.prepare('SELECT receipt_count FROM memory_mutations WHERE scope=? AND loop_id=? AND mutation_id=?').get(scope,loopId,mutationId);
  if(!found)return undefined;
  const receipts=database.prepare('SELECT record FROM memory_receipts WHERE scope=? AND loop_id=? AND mutation_id=? ORDER BY ordinal').all(scope,loopId,mutationId).map(row=>JSON.parse(row.record));
  if(receipts.length!==found.receipt_count)throw new Error('Invalid saved memory receipt count.');
  return receipts;
};
// Every effect receipt reserves one future cleanup receipt. At an effect quota
// boundary a value can still be explicitly forgotten without discarding the
// original receipt or allowing an unbounded cleanup ledger.
const CLEANUP_RECEIPT_RESERVE_BYTES=2048;
function memoryCommit({writes,mutationId}){
  if(!Array.isArray(writes)||writes.length<1||!memoryId.test(mutationId))throw new Error('Invalid memory batch.');
  const first=writes[0],scope=first?.scope,loopId=first?.loopId,budget=first?.budget;
  if(!memoryDigest.test(scope)||!memoryName.test(loopId)||!budget||!Number.isSafeInteger(budget.maxValueBytes)||budget.maxValueBytes<1||!Number.isSafeInteger(budget.maxKeys)||budget.maxKeys<1||!Number.isSafeInteger(budget.maxTotalBytes)||budget.maxTotalBytes<budget.maxValueBytes||!Number.isSafeInteger(budget.maxMutations)||budget.maxMutations<1||!Number.isSafeInteger(budget.maxReceiptBytes)||budget.maxReceiptBytes<1||writes.length>budget.maxKeys)throw new Error('Invalid memory batch budget.');
  const seen=new Set(),prepared=[];
  for(const write of writes){
    if(!write||write.scope!==scope||write.loopId!==loopId||write.mutationId!==mutationId||JSON.stringify(write.budget)!==JSON.stringify(budget)||!validKey(write.key)||seen.has(write.key)||!Number.isSafeInteger(write.expectedVersion)||write.expectedVersion<0||write.expectedVersion>=Number.MAX_SAFE_INTEGER)throw memoryConflict();
    seen.add(write.key);
    const record=write.next,bytes=validateMemoryRecord(record,scope,loopId,write.key);
    if(record.version!==write.expectedVersion+1||record.provenance.mutationId!==mutationId||record.deleted!==['forget','retention','reset'].includes(record.provenance.operation)||write.expectedVersion===0&&record.provenance.operation!=='write'||write.expectedVersion>0&&record.provenance.operation==='write')throw memoryConflict();
    if(bytes>budget.maxValueBytes)throw memoryQuota();
    const receipt={scope,loopId,key:write.key,version:record.version,deleted:record.deleted,mutationId,committedAt:record.updatedAt,provenance:record.provenance};
    prepared.push({write,record,bytes,receipt,receiptJson:JSON.stringify(receipt)});
  }
  const kind=['write','update'].includes(prepared[0].record.provenance.operation)?'effect':'cleanup';
  if(prepared.some(item=>(['write','update'].includes(item.record.provenance.operation)?'effect':'cleanup')!==kind))throw memoryConflict();
  database.exec('BEGIN IMMEDIATE');
  try{
    if(!database.prepare("SELECT 1 FROM metadata WHERE key='version'").get())throw new Error('Initialize Loops state before committing memory.');
    if(database.prepare('SELECT 1 FROM memory_mutations WHERE scope=? AND loop_id=? AND mutation_id=?').get(scope,loopId,mutationId))throw memoryConflict();
    const current=database.prepare('SELECT key,version,value_bytes,record FROM memory_records WHERE scope=? AND loop_id=? AND key=?');
    const usage=database.prepare('SELECT count(*) AS keys,coalesce(sum(value_bytes),0) AS bytes FROM memory_records WHERE scope=? AND loop_id=?').get(scope,loopId);
    let keys=usage.keys,totalBytes=usage.bytes;
    for(const item of prepared){
      const previous=current.get(scope,loopId,item.write.key);
      if((previous?.version??0)!==item.write.expectedVersion)throw memoryConflict();
      if(previous){
        const saved=JSON.parse(previous.record);
        if(validateMemoryRecord(saved,scope,loopId,item.write.key)!==previous.value_bytes)throw new Error('Invalid saved memory value index.');
        if(item.record.createdAt!==saved.createdAt||kind==='cleanup'&&saved.deleted)throw memoryConflict();
        totalBytes-=previous.value_bytes;
      }else keys++;
      totalBytes+=item.bytes;
    }
    if(keys>budget.maxKeys||totalBytes>budget.maxTotalBytes)throw memoryQuota();
    const receiptBytes=prepared.reduce((sum,item)=>sum+Buffer.byteLength(item.receiptJson),0);
    const metadata=database.prepare(`SELECT
      coalesce(sum(CASE WHEN kind='effect' THEN 1 ELSE 0 END),0) AS effects,
      coalesce(sum(CASE WHEN kind='effect' THEN receipt_count ELSE 0 END),0) AS effect_receipts,
      coalesce(sum(CASE WHEN kind='effect' THEN receipt_bytes ELSE 0 END),0) AS effect_bytes,
      coalesce(sum(CASE WHEN kind='cleanup' THEN 1 ELSE 0 END),0) AS cleanups,
      coalesce(sum(CASE WHEN kind='cleanup' THEN receipt_bytes ELSE 0 END),0) AS cleanup_bytes
      FROM memory_mutations WHERE scope=? AND loop_id=?`).get(scope,loopId);
    if(kind==='effect'&&(metadata.effects+1>budget.maxMutations||metadata.effect_bytes+receiptBytes>budget.maxReceiptBytes)||
      kind==='cleanup'&&(metadata.cleanups+1>metadata.effect_receipts||metadata.cleanup_bytes+receiptBytes>metadata.effect_receipts*CLEANUP_RECEIPT_RESERVE_BYTES))throw memoryQuota();
    for(const item of prepared)database.prepare('INSERT INTO memory_records(scope,loop_id,key,version,deleted,value_bytes,record) VALUES (?,?,?,?,?,?,?) ON CONFLICT(scope,loop_id,key) DO UPDATE SET version=excluded.version,deleted=excluded.deleted,value_bytes=excluded.value_bytes,record=excluded.record').run(scope,loopId,item.write.key,item.record.version,Number(item.record.deleted),item.bytes,JSON.stringify(item.record));
    database.prepare('INSERT INTO memory_mutations(scope,loop_id,mutation_id,kind,receipt_count,receipt_bytes) VALUES (?,?,?,?,?,?)').run(scope,loopId,mutationId,kind,prepared.length,receiptBytes);
    for(let ordinal=0;ordinal<prepared.length;ordinal++)database.prepare('INSERT INTO memory_receipts(scope,loop_id,mutation_id,ordinal,record) VALUES (?,?,?,?,?)').run(scope,loopId,mutationId,ordinal,prepared[ordinal].receiptJson);
    database.exec('COMMIT');
    return prepared.map(item=>item.receipt);
  }catch(error){if(database.isTransaction)database.exec('ROLLBACK');throw error;}
}
if(startupError){try{database?.close();}catch{/* Preserve the original startup failure. */}}
function write(next,mode='full'){
  const runOnly=mode==='run',working=mode==='working';
  database.exec('BEGIN IMMEDIATE');
  try{
    // The database is the committed baseline. Do not retain another copy of all
    // history in this worker or send old outputs back to JS just to compare them.
    if(runOnly&&!database.prepare("SELECT 1 FROM metadata WHERE key='version'").get())throw new Error('Initialize the Loops store before writing an execution checkpoint.');
    if(!runOnly){
    database.prepare("INSERT INTO metadata VALUES ('version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next.version));
    for(const [id,record] of Object.entries(next.loops)){
      const json=JSON.stringify(record);
      if(database.prepare('SELECT 1 FROM loops WHERE id=? AND record=?').get(id,json))continue;
      database.prepare('INSERT INTO loops VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(id,json);
      const definitions=Object.values(record.revisions??{[record.definition.revision]:record.definition});
      for(const definition of definitions){
        const json=JSON.stringify(definition);
        const previous=database.prepare('SELECT definition FROM revisions WHERE loop_id=? AND revision=?').get(id,definition.revision);
        if(previous&&previous.definition!==json)throw new Error(`Immutable revision conflict: ${id} revision ${definition.revision}`);
        if(!previous)database.prepare('INSERT INTO revisions VALUES (?,?,?)').run(id,definition.revision,json);
      }
    }
    for(const {id} of database.prepare('SELECT id FROM loops').all())if(!Object.hasOwn(next.loops,id))database.prepare('DELETE FROM loops WHERE id=?').run(id);
    }
    for(const [id,run] of runOnly?[[next.id,next]]:Object.entries(next.runs)){
      const json=JSON.stringify(run);
      const previous=database.prepare("SELECT state, record=? AS unchanged, COALESCE(json_extract(record,'$.requestFingerprintVersion'),1) AS fingerprintVersion FROM runs WHERE id=?").get(json,id);
      if(previous?.unchanged)continue;
      if(previous&&previous.fingerprintVersion!==(run.requestFingerprintVersion??1))throw new Error('Admission fingerprint contract is immutable.');
      const owner=JSON.stringify([run.owner.agentId,run.owner.sessionKey,run.owner.sessionId]);
      database.prepare('INSERT INTO runs VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_key=excluded.owner_key,state=excluded.state,created_at=excluded.created_at,record=excluded.record').run(id,owner,run.state,run.createdAt,json);
      const admission=database.prepare('SELECT run_id,fingerprint FROM admissions WHERE request_key=?').get(run.requestKey);
      if(admission&&(admission.run_id!==id||admission.fingerprint!==run.requestFingerprint))throw new Error('Admission identity conflict.');
      if(!admission)database.prepare('INSERT INTO admissions VALUES (?,?,?)').run(run.requestKey,run.requestFingerprint,id);
      for(let sequence=0;sequence<run.trace.length;sequence++){
        const attempt=run.trace[sequence];
        const evidence=JSON.stringify(attempt);
        if(database.prepare('SELECT 1 FROM attempts WHERE run_id=? AND sequence=? AND evidence=?').get(id,sequence,evidence))continue;
        database.prepare('INSERT INTO attempts VALUES (?,?,?,?,?) ON CONFLICT(run_id,sequence) DO UPDATE SET state=excluded.state,evidence=excluded.evidence').run(id,sequence,attempt.nodeId,attempt.state,evidence);
      }
      for(const [node,value] of Object.entries(run.outputs)){
        const output=JSON.stringify(value);
        if(database.prepare('SELECT 1 FROM outputs WHERE run_id=? AND node_id=? AND value=?').get(id,node,output))continue;
        database.prepare('INSERT INTO outputs VALUES (?,?,?) ON CONFLICT(run_id,node_id) DO UPDATE SET value=excluded.value').run(id,node,output);
      }
      if(!previous||previous.state!==run.state)database.prepare('INSERT INTO events(run_id,state,at) VALUES (?,?,?)').run(id,run.state,run.updatedAt);
    }
    if(!runOnly){
    for(const [key,retired] of Object.entries(next.retiredAdmissions??{})){
      const admission=database.prepare('SELECT run_id,fingerprint FROM admissions WHERE request_key=?').get(key);
      if(admission&&(admission.run_id!==retired.runId||admission.fingerprint!==retired.fingerprint))throw new Error('Retired admission identity conflict.');
      if(!admission)database.prepare('INSERT INTO admissions VALUES (?,?,?)').run(key,retired.fingerprint,retired.runId);
      const previous=database.prepare('SELECT record FROM retired_admissions WHERE request_key=?').get(key);
      if(previous&&previous.record!==JSON.stringify(retired))throw new Error('Retired admission is immutable.');
      if(!previous)database.prepare('INSERT INTO retired_admissions VALUES (?,?)').run(key,JSON.stringify(retired));
    }
    if(!working)for(const {request_key:key} of database.prepare('SELECT request_key FROM retired_admissions').all())if(!Object.hasOwn(next.retiredAdmissions??{},key))throw new Error('Retired admission identity cannot be removed.');
    const removed=working?Object.entries(next.retiredAdmissions??{}).map(([key,retired])=>({id:retired.runId,request_key:key})):
      database.prepare("SELECT id,json_extract(record,'$.requestKey') AS request_key FROM runs").all().filter(({id})=>!Object.hasOwn(next.runs,id));
    for(const {id,request_key:key} of removed){
      // Explicit retention is the only caller allowed to remove a run.
      if(!Object.hasOwn(next.retiredAdmissions??{},key))throw new Error('History removal requires a retained admission identity.');
      const current=database.prepare("SELECT json_extract(record,'$.requestKey') AS request_key FROM runs WHERE id=?").get(id);
      if(current&&current.request_key!==key)throw new Error('History removal admission identity conflict.');
      if(Object.hasOwn(next.runs,id))throw new Error('History removal cannot retain the same working run.');
      for(const table of ['attempts','outputs','events'])database.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(id);
      database.prepare('DELETE FROM runs WHERE id=?').run(id);
    }
    }
    database.exec('COMMIT');
  }catch(error){
    try{if(database.isTransaction)database.exec('ROLLBACK');}
    catch(rollbackError){
      // Never let readback present an uncommitted transaction as verified state.
      // SQLite can also roll back automatically (for example on SQLITE_FULL),
      // in which case a second ROLLBACK would hide the actual write failure.
      startupError=new Error('Storage rollback could not be verified. Restart and inspect the committed store before retrying.',{cause:new AggregateError([error,rollbackError])});
      try{database.close();}catch{/* Worker termination is the final cleanup. */}
      throw startupError;
    }
    throw error;
  }
}
parentPort.on('message',async message=>{
  let result;
  try{
    if(startupError)throw startupError;
    switch(message.operation){
      case 'initialize':await initialize();break;
      case 'read':result=read();break;
      case 'read-working':result=workingState();break;
      case 'read-run':{
        const row=database.prepare('SELECT record FROM runs WHERE id=? AND owner_key=?').get(message.payload.id,message.payload.owner);
        result=row?JSON.parse(row.record):undefined;break;
      }
      case 'find-admission':result=database.prepare('SELECT run_id AS id,fingerprint FROM admissions WHERE request_key=?').get(message.payload);break;
      case 'read-retired':{
        const row=database.prepare('SELECT record FROM retired_admissions WHERE request_key=?').get(message.payload);
        result=row?JSON.parse(row.record):undefined;break;
      }
      case 'run-metadata':result=runMetadata();break;
      case 'history':result=history(message.payload);break;
      case 'run-summaries':result=summaries(message.payload,0,-1);break;
      case 'has-open-runs':result=!!database.prepare("SELECT 1 FROM runs WHERE json_extract(record,'$.definition.id')=? AND (state NOT IN ('completed','failed','cancelled','interrupted') OR json_extract(record,'$.cleanupPending')=1) LIMIT 1").get(message.payload);break;
      case 'memory-get':result=memoryGet(message.payload);break;
      case 'memory-page':result=memoryPage(message.payload);break;
      case 'memory-mutation':result=memoryMutation(message.payload);break;
      case 'memory-commit':result=memoryCommit(message.payload);break;
      case 'write':write(message.payload);break;
      case 'write-working':write(message.payload,'working');break;
      case 'write-run':write(message.payload,'run');break;
      case 'backup':await backup(database,message.payload);result=message.payload;break;
      case 'integrity':result=database.prepare('PRAGMA integrity_check').all();break;
      case 'close':database.exec('PRAGMA wal_checkpoint(TRUNCATE)');database.close();break;
      default:throw new Error('Unknown storage operation.');
    }
    port.postMessage({ok:true,value:result});
  }catch(error){port.postMessage({ok:false,error:error instanceof Error?error.message:String(error),...typeof error?.errcode==='number'?{sqliteCode:error.errcode}:{},...typeof error?.code==='string'?{code:error.code}:{}});}
  finally{const signal=new Int32Array(message.signal);Atomics.store(signal,0,1);Atomics.notify(signal,0);}
});

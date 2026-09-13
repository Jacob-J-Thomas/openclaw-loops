import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync,backup} from 'node:sqlite';
import {chmodSync,existsSync} from 'node:fs';

// Only this worker opens the plugin database. The host database is never used.
let database;
let startupError;
let schemaVersion=0;
let writable=false;
try{
if(existsSync(workerData.file)){
  // A writable connection can checkpoint a crashed WAL on close, even when
  // admission rejects it before any writer pragma. Read the WAL-aware version
  // through a read-only connection first; immutable mode would ignore its WAL.
  database=new DatabaseSync(workerData.file,{readOnly:true});
  schemaVersion=database.prepare('PRAGMA user_version').get().user_version;
  if(schemaVersion>2)throw new Error('The Loops database requires a newer plugin; restore a matching app/database backup.');
  const integrity=database.prepare('PRAGMA quick_check').get().quick_check;
  if(integrity!=='ok')throw new Error(`Loops database integrity check failed: ${integrity}`);
  if(schemaVersion===0){
    if(database.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get())throw new Error('Invalid unversioned Loops database schema.');
  }else{
      // Check required columns and JSON syntax without materializing cold history.
      // Schema 1 legitimately lacks the retired-admission table added by schema 2.
      const tables={metadata:'key,value',loops:'id,record',revisions:'loop_id,revision,definition',runs:'id,owner_key,state,created_at,record',admissions:'request_key,fingerprint,run_id',attempts:'run_id,sequence,node_id,state,evidence',outputs:'run_id,node_id,value',events:'sequence,run_id,state,at',...schemaVersion>=2?{retired_admissions:'request_key,record'}:{}};
      for(const [table,columns] of Object.entries(tables))database.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
      for(const [table,column] of Object.entries({metadata:'value',loops:'record',revisions:'definition',runs:'record',attempts:'evidence',outputs:'value',...schemaVersion>=2?{retired_admissions:'record'}:{}})){
        if(database.prepare(`SELECT 1 FROM ${table} WHERE NOT json_valid(${column}) LIMIT 1`).get())throw new Error(`Invalid saved JSON in Loops ${table}.`);
      }
      if(!database.prepare("SELECT 1 FROM metadata WHERE key='version'").get()){
        for(const table of Object.keys(tables))if(database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw new Error('Invalid Loops state: saved records have no format version.');
      }
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
if(schemaVersion===1){
  const destination=`${workerData.file}.before-schema-2-${Date.now()}.bak`;
  await backup(database,destination);chmodSync(destination,0o600);
  const snapshot=new DatabaseSync(destination,{readOnly:true});
  try{if(snapshot.prepare('PRAGMA quick_check').get().quick_check!=='ok'||snapshot.prepare('PRAGMA user_version').get().user_version!==1)throw new Error('Pre-migration backup verification failed. The original schema has not been changed.');}finally{snapshot.close();}
}
database.exec(`
  BEGIN IMMEDIATE;
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
  PRAGMA user_version=2;
  COMMIT;
`);
const integrity=database.prepare('PRAGMA quick_check').get().quick_check;
if(integrity!=='ok')throw new Error(`Loops database integrity check failed: ${integrity}`);
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
  admissions.run_id AS admissionId,admissions.fingerprint AS admissionFingerprint,
  json_extract(record,'$.owner') AS owner,json_extract(record,'$.requestKey') AS requestKey,
  json_extract(record,'$.requestFingerprint') AS requestFingerprint,json_extract(record,'$.updatedAt') AS updatedAt,
  json_extract(record,'$.parentRunId') AS parentRunId,json_extract(record,'$.cleanupPending') AS cleanupPending FROM runs
  LEFT JOIN admissions ON admissions.request_key=json_extract(record,'$.requestKey')`).all().map(row=>{
    const {ownerKey,recordId,recordState,recordCreatedAt,cleanupType,parentType,admissionId,admissionFingerprint,...record}=row,owner=JSON.parse(record.owner);
    if(recordId!==record.id||recordState!==record.state||recordCreatedAt!==record.createdAt||!owner||JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId])!==ownerKey||admissionId!==record.id||admissionFingerprint!==record.requestFingerprint)throw new Error('Invalid saved history metadata: its identity index is inconsistent.');
    if(cleanupType!==null&&!['true','false'].includes(cleanupType)||parentType!==null&&parentType!=='text')throw new Error('Invalid saved history metadata: recovery and cleanup fields have invalid types.');
    return {...record,owner,...record.parentRunId===null?{parentRunId:undefined}:{},cleanupPending:record.cleanupPending===1};
  });
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
      const previous=database.prepare('SELECT state, record=? AS unchanged FROM runs WHERE id=?').get(json,id);
      if(previous?.unchanged)continue;
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

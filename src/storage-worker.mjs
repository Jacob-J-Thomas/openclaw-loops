import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync,backup} from 'node:sqlite';

// Only this worker opens the plugin database. The host database is never used.
let database;
let startupError;
try{
database=new DatabaseSync(workerData.file);
database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const schemaVersion=database.prepare('PRAGMA user_version').get().user_version;
if(schemaVersion>1)throw new Error('The Loops database requires a newer plugin; restore a matching app/database backup.');
database.exec(`
  CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS loops(id TEXT PRIMARY KEY, record TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS revisions(loop_id TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, PRIMARY KEY(loop_id,revision));
  CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS runs_owner_created ON runs(owner_key,created_at DESC,id);
  CREATE TABLE IF NOT EXISTS admissions(request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, run_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attempts(run_id TEXT NOT NULL, sequence INTEGER NOT NULL, node_id TEXT NOT NULL, state TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
  CREATE TABLE IF NOT EXISTS outputs(run_id TEXT NOT NULL, node_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(run_id,node_id));
  CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL);
  PRAGMA user_version=1;
`);
const integrity=database.prepare('PRAGMA quick_check').get().quick_check;
if(integrity!=='ok')throw new Error(`Loops database integrity check failed: ${integrity}`);
}catch(error){startupError=error instanceof Error?error.message:String(error);}
const port=workerData.port;
const read=()=>{
  const version=database.prepare("SELECT value FROM metadata WHERE key='version'").get();
  if(!version)return undefined;
  return {version:JSON.parse(version.value),loops:Object.fromEntries(database.prepare('SELECT id,record FROM loops').all().map(row=>[row.id,JSON.parse(row.record)])),runs:Object.fromEntries(database.prepare('SELECT id,record FROM runs').all().map(row=>[row.id,JSON.parse(row.record)]))};
};
let cached=startupError?undefined:read();
function write(next){
  database.exec('BEGIN IMMEDIATE');
  try{
    database.prepare("INSERT INTO metadata VALUES ('version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next.version));
    for(const [id,record] of Object.entries(next.loops)){
      if(JSON.stringify(record)===JSON.stringify(cached?.loops[id]))continue;
      database.prepare('INSERT INTO loops VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(id,JSON.stringify(record));
      const definitions=Object.values(record.revisions??{[record.definition.revision]:record.definition});
      for(const definition of definitions){
        const json=JSON.stringify(definition);
        const previous=database.prepare('SELECT definition FROM revisions WHERE loop_id=? AND revision=?').get(id,definition.revision);
        if(previous&&previous.definition!==json)throw new Error(`Immutable revision conflict: ${id} revision ${definition.revision}`);
        if(!previous)database.prepare('INSERT INTO revisions VALUES (?,?,?)').run(id,definition.revision,json);
      }
    }
    for(const id of Object.keys(cached?.loops??{}))if(!next.loops[id])database.prepare('DELETE FROM loops WHERE id=?').run(id);
    for(const [id,run] of Object.entries(next.runs)){
      const previous=cached?.runs[id];
      if(JSON.stringify(run)===JSON.stringify(previous))continue;
      const owner=JSON.stringify([run.owner.agentId,run.owner.sessionKey,run.owner.sessionId]);
      database.prepare('INSERT INTO runs VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_key=excluded.owner_key,state=excluded.state,created_at=excluded.created_at,record=excluded.record').run(id,owner,run.state,run.createdAt,JSON.stringify(run));
      const admission=database.prepare('SELECT run_id,fingerprint FROM admissions WHERE request_key=?').get(run.requestKey);
      if(admission&&(admission.run_id!==id||admission.fingerprint!==run.requestFingerprint))throw new Error('Admission identity conflict.');
      if(!admission)database.prepare('INSERT INTO admissions VALUES (?,?,?)').run(run.requestKey,run.requestFingerprint,id);
      for(let sequence=0;sequence<run.trace.length;sequence++){
        const attempt=run.trace[sequence];
        if(JSON.stringify(attempt)===JSON.stringify(previous?.trace[sequence]))continue;
        database.prepare('INSERT INTO attempts VALUES (?,?,?,?,?) ON CONFLICT(run_id,sequence) DO UPDATE SET state=excluded.state,evidence=excluded.evidence').run(id,sequence,attempt.nodeId,attempt.state,JSON.stringify(attempt));
      }
      for(const [node,value] of Object.entries(run.outputs)){
        if(JSON.stringify(value)===JSON.stringify(previous?.outputs[node]))continue;
        database.prepare('INSERT INTO outputs VALUES (?,?,?) ON CONFLICT(run_id,node_id) DO UPDATE SET value=excluded.value').run(id,node,JSON.stringify(value));
      }
      if(!previous||previous.state!==run.state)database.prepare('INSERT INTO events(run_id,state,at) VALUES (?,?,?)').run(id,run.state,run.updatedAt);
    }
    for(const id of Object.keys(cached?.runs??{}))if(!next.runs[id]){
      // Explicit retention is the only caller allowed to remove a run.
      for(const table of ['attempts','outputs','admissions','events'])database.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(id);
      database.prepare('DELETE FROM runs WHERE id=?').run(id);
    }
    database.exec('COMMIT');cached=next;
  }catch(error){database.exec('ROLLBACK');throw error;}
}
parentPort.on('message',async message=>{
  let result;
  try{
    if(startupError)throw new Error(startupError);
    switch(message.operation){
      case 'read':result=read();break;
      case 'write':write(message.payload);break;
      case 'backup':await backup(database,message.payload);result=message.payload;break;
      case 'integrity':result=database.prepare('PRAGMA integrity_check').all();break;
      case 'close':database.exec('PRAGMA wal_checkpoint(TRUNCATE)');database.close();break;
      default:throw new Error('Unknown storage operation.');
    }
    port.postMessage({ok:true,value:result});
  }catch(error){port.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}
  finally{const signal=new Int32Array(message.signal);Atomics.store(signal,0,1);Atomics.notify(signal,0);}
});

import {MessageChannel,receiveMessageOnPort,Worker,type MessagePort} from 'node:worker_threads';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {Storage,State,Run} from './engine.js';
import {parseDefinition} from './graph.js';
import {defaultBudgets} from './budgets.js';
// Policy changes must never make already-saved version 2 evidence unreadable.
const persistedBudgets={...defaultBudgets,definitionBytes:Number.MAX_SAFE_INTEGER};
import {Value} from 'typebox/value';
import {outputs} from './output-schemas.js';
import {RetiredAdmissionSchema} from './retention.js';

export function validateState(value:unknown):State{
  if(!value||typeof value!=='object'||!('version' in value)||value.version!==1||!('loops' in value)||!('runs' in value))throw new Error('Invalid or unsupported Loops state. The original store has been preserved.');
  const state=value as State;
  if(!state.loops||typeof state.loops!=='object'||Array.isArray(state.loops)||!state.runs||typeof state.runs!=='object'||Array.isArray(state.runs))throw new Error('Invalid Loops collections.');
  for(const [id,record] of Object.entries(state.loops)){
    if(!Value.Check(outputs.record,record))throw new Error(`Invalid saved loop structure: ${id}`);
    const definition=parseDefinition(record.definition,persistedBudgets);
    if(id!==definition.id||!Array.isArray(record.grants)||record.grants.some(cap=>!['llm','model-info'].includes(cap)))throw new Error(`Invalid saved loop: ${id}`);
    if(record.enabledRevision!==null&&(!Number.isInteger(record.enabledRevision)||record.enabledRevision<1))throw new Error(`Invalid publication: ${id}`);
    for(const [revision,version] of Object.entries(record.revisions??{})){
      parseDefinition(version,persistedBudgets);
      if(version.id!==id||String(version.revision)!==revision)throw new Error(`Invalid immutable revision: ${id}/${revision}`);
    }
    for(const revision of [record.enabledRevision,record.publishedRevision])if(revision!=null&&record.definition.revision!==revision&&!record.revisions?.[revision])throw new Error(`Missing published revision: ${id}/${revision}`);
  }
  for(const [id,run] of Object.entries(state.runs)){
    if(!Value.Check(outputs.completeRun,run))throw new Error(`Invalid saved run structure: ${id}`);
    parseDefinition(run.definition,persistedBudgets);
    if(id!==run.id||!run.owner?.agentId||!run.owner.sessionKey||!run.owner.sessionId||!Array.isArray(run.trace)||!run.outputs||!run.requestKey||!run.requestFingerprint||!['queued','running','completed','failed','waiting','review','cancelled','interrupted'].includes(run.state))throw new Error(`Invalid saved run: ${id}`);
  }
  if(state.retiredAdmissions!==undefined){
    if(!state.retiredAdmissions||typeof state.retiredAdmissions!=='object'||Array.isArray(state.retiredAdmissions))throw new Error('Invalid retired admissions.');
    for(const [key,retired] of Object.entries(state.retiredAdmissions))if(!/^[a-f0-9]{64}$/.test(key)||!Value.Check(RetiredAdmissionSchema,retired)||state.runs[retired.runId])throw new Error('Invalid retired admission identity.');
  }
  return state;
}

export class SqliteStorage implements Storage{
  private worker?:Worker;
  private port?:MessagePort;
  private closed=false;
  private broken=false;
  private lock:string;
  private lease?:DatabaseSync;
  private ownsPidLock=false;
  private disposal?:Promise<void>;
  private shutdown?:Promise<void>;
  constructor(readonly file:string,legacyFile?:string){
    mkdirSync(dirname(file),{recursive:true,mode:0o700});
    this.lock=`${file}.lock`;
    try{
      // The stable, empty lease file holds an OS-backed SQLite transaction for
      // this owner's lifetime. Never unlink it: PID checks alone allow two stale
      // lock reclaimers to remove each other's newly acquired directory.
      const lease=new DatabaseSync(`${file}.owner.sqlite`);
      try{
        chmodSync(`${file}.owner.sqlite`,0o600);
        lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
      }catch(error){
        lease.close();
        if(error instanceof Error&&'errcode' in error&&error.errcode===5)throw new Error('Loops store is already open by another storage owner.',{cause:error});
        throw error;
      }
      this.lease=lease;
      // Retain the PID marker to reject a still-running older plugin. Upgrade
      // and rollback must stop the previous Gateway before starting its peer.
      if(existsSync(this.lock)){
        let protocol:string|undefined;
        try{protocol=readFileSync(`${this.lock}/protocol`,'utf8');}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
        // For this protocol the acquired lease proves its old owner has stopped,
        // even if that owner's PID has since been reused by an unrelated process.
        if(protocol!=='sqlite-owner-v1'){
          let pid:number;
          try{pid=Number(readFileSync(`${this.lock}/pid`,'utf8'));}catch{throw new Error('Loops store lock is incomplete. Inspect the owning process before removing it.');}
          if(!Number.isInteger(pid)||pid<1)throw new Error('Loops store lock has an invalid owner.');
          try{process.kill(pid,0);throw new Error(`Loops store is already open by process ${pid}.`);}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ESRCH'))throw error;}
        }
        rmSync(this.lock,{recursive:true});
      }
      // Publish a complete marker atomically so a crash cannot leave an empty
      // directory that prevents the next owner from recovering a dead process.
      const staging=mkdtempSync(`${this.lock}.starting-`);
      try{
        writeFileSync(`${staging}/pid`,String(process.pid),{mode:0o600,flush:true});
        writeFileSync(`${staging}/protocol`,'sqlite-owner-v1',{mode:0o600,flush:true});
        renameSync(staging,this.lock);this.ownsPidLock=true;
      }finally{rmSync(staging,{recursive:true,force:true});}
      const {port1,port2}=new MessageChannel();this.port=port1;
      try{this.worker=new Worker(new URL('./storage-worker.mjs',import.meta.url),{workerData:{file,port:port2},transferList:[port2]});}
      catch(error){port2.close();throw error;}
      this.worker.unref();this.port.unref();
      this.worker.on('error',()=>{this.broken=true;});
      this.worker.on('exit',()=>{this.broken=true;});
      if(!this.read()&&legacyFile&&existsSync(legacyFile)){
        const legacy=validateState(JSON.parse(readFileSync(legacyFile,'utf8')));
        const backup=`${legacyFile}.before-sqlite-${Date.now()}.bak`;
        copyFileSync(legacyFile,backup);chmodSync(backup,0o600);
        this.write(legacy);
        if(JSON.stringify(this.read())!==JSON.stringify(legacy))throw new Error('Legacy migration verification failed; original JSON and backup are preserved.');
      }
      chmodSync(file,0o600);
    }catch(error){void this.dispose().catch(()=>{});throw error;}
  }
  private call<T>(operation:string,payload?:unknown):T{
    if(this.closed||this.broken||!this.worker||!this.port)throw new Error('Loops storage worker is unavailable. Restart the plugin after checking its store.');
    const signal=new SharedArrayBuffer(4);
    this.worker.postMessage({operation,payload,signal});
    // Existing synchronous authoring operations must not acknowledge uncommitted
    // changes. SQLite work is serialized in the worker; this bounded wait is the
    // commit barrier. No inference or host operation runs inside this barrier.
    if(Atomics.wait(new Int32Array(signal),0,0,30000)==='timed-out'){
      this.broken=true;throw new Error('Storage commit timed out. Its outcome is uncertain; restart and inspect before retrying.');
    }
    const response=receiveMessageOnPort(this.port)?.message as {ok:boolean;value:T;error?:string}|undefined;
    if(!response)throw new Error('Storage worker returned no response.');
    if(!response.ok)throw new Error(response.error??'Storage operation failed.');
    return response.value;
  }
  read(){const result=this.call<State|undefined>('read');return result?validateState(result):undefined;}
  write(state:State){this.call('write',state);}
  // Execution checkpoints send only their changed run. Authoring, migration and
  // retention still use one whole-state transaction for their coordinated edits.
  writeRun(run:Run){this.call('write-run',run);}
  backup(destination:string){return this.call<string>('backup',destination);}
  integrity(){return this.call<unknown>('integrity');}
  close():Promise<void>{
    if(!this.shutdown)this.shutdown=(async()=>{try{if(!this.closed&&!this.broken)this.call('close');}finally{await this.dispose();}})();
    return this.shutdown;
  }
  private dispose():Promise<void>{
    if(this.disposal)return this.disposal;
    this.closed=true;this.port?.close();
    this.disposal=(async()=>{
      // A timeout or failed close does not prove the worker stopped writing.
      // Keep ownership until physical termination, including constructor errors.
      if(this.worker)await this.worker.terminate();
      try{if(this.ownsPidLock)rmSync(this.lock,{recursive:true,force:true});}
      finally{this.lease?.close();this.lease=undefined;}
    })();
    return this.disposal;
  }
}

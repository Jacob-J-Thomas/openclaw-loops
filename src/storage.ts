import {MessageChannel,receiveMessageOnPort,Worker,type MessagePort} from 'node:worker_threads';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Storage,State} from './engine.js';
import {parseDefinition} from './graph.js';
import {Value} from 'typebox/value';
import {outputs} from './output-schemas.js';

export function validateState(value:unknown):State{
  if(!value||typeof value!=='object'||!('version' in value)||value.version!==1||!('loops' in value)||!('runs' in value))throw new Error('Invalid or unsupported Loops state. The original store has been preserved.');
  const state=value as State;
  if(!state.loops||typeof state.loops!=='object'||Array.isArray(state.loops)||!state.runs||typeof state.runs!=='object'||Array.isArray(state.runs))throw new Error('Invalid Loops collections.');
  for(const [id,record] of Object.entries(state.loops)){
    if(!Value.Check(outputs.record,record))throw new Error(`Invalid saved loop structure: ${id}`);
    const definition=parseDefinition(record.definition);
    if(id!==definition.id||!Array.isArray(record.grants)||record.grants.some(cap=>!['llm','model-info'].includes(cap)))throw new Error(`Invalid saved loop: ${id}`);
    if(record.enabledRevision!==null&&(!Number.isInteger(record.enabledRevision)||record.enabledRevision<1))throw new Error(`Invalid publication: ${id}`);
    for(const [revision,version] of Object.entries(record.revisions??{})){
      parseDefinition(version);
      if(version.id!==id||String(version.revision)!==revision)throw new Error(`Invalid immutable revision: ${id}/${revision}`);
    }
    for(const revision of [record.enabledRevision,record.publishedRevision])if(revision!=null&&record.definition.revision!==revision&&!record.revisions?.[revision])throw new Error(`Missing published revision: ${id}/${revision}`);
  }
  for(const [id,run] of Object.entries(state.runs)){
    if(!Value.Check(outputs.completeRun,run))throw new Error(`Invalid saved run structure: ${id}`);
    parseDefinition(run.definition);
    if(id!==run.id||!run.owner?.agentId||!run.owner.sessionKey||!run.owner.sessionId||!Array.isArray(run.trace)||!run.outputs||!run.requestKey||!run.requestFingerprint||!['queued','running','completed','failed','waiting','review','cancelled','interrupted'].includes(run.state))throw new Error(`Invalid saved run: ${id}`);
  }
  return state;
}

export class SqliteStorage implements Storage{
  private worker:Worker;
  private port:MessagePort;
  private closed=false;
  private broken=false;
  private lock:string;
  constructor(readonly file:string,legacyFile?:string){
    mkdirSync(dirname(file),{recursive:true,mode:0o700});
    this.lock=`${file}.lock`;
    if(existsSync(this.lock)){
      let pid:number;
      try{pid=Number(readFileSync(`${this.lock}/pid`,'utf8'));}catch{throw new Error('Loops store lock is incomplete. Inspect the owning process before removing it.');}
      if(!Number.isInteger(pid)||pid<1)throw new Error('Loops store lock has an invalid owner.');
      try{process.kill(pid,0);throw new Error(`Loops store is already open by process ${pid}.`);}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ESRCH'))throw error;}
      rmSync(this.lock,{recursive:true});
    }
    mkdirSync(this.lock,{mode:0o700});writeFileSync(`${this.lock}/pid`,String(process.pid),{mode:0o600,flush:true});
    const {port1,port2}=new MessageChannel();this.port=port1;
    this.worker=new Worker(new URL('./storage-worker.mjs',import.meta.url),{workerData:{file,port:port2},transferList:[port2]});
    this.worker.unref();this.port.unref();
    this.worker.on('error',()=>{this.broken=true;});
    try{
      if(!this.read()&&legacyFile&&existsSync(legacyFile)){
        const legacy=validateState(JSON.parse(readFileSync(legacyFile,'utf8')));
        const backup=`${legacyFile}.before-sqlite-${Date.now()}.bak`;
        copyFileSync(legacyFile,backup);chmodSync(backup,0o600);
        this.write(legacy);
        if(JSON.stringify(this.read())!==JSON.stringify(legacy))throw new Error('Legacy migration verification failed; original JSON and backup are preserved.');
      }
      chmodSync(file,0o600);
    }catch(error){this.dispose();throw error;}
  }
  private call<T>(operation:string,payload?:unknown):T{
    if(this.closed||this.broken)throw new Error('Loops storage worker is unavailable. Restart the plugin after checking its store.');
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
  backup(destination:string){return this.call<string>('backup',destination);}
  integrity(){return this.call<unknown>('integrity');}
  close(){if(this.closed)return;try{if(!this.broken)this.call('close');}finally{this.dispose();}}
  private dispose(){this.closed=true;this.port.close();void this.worker.terminate();rmSync(this.lock,{recursive:true,force:true});}
}

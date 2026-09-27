import {createHash, randomUUID} from 'node:crypto';
import {chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname,isAbsolute, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LoopError, requestError, storageError} from './errors.js';

// This store receives already-authorized bytes. A reference is an identifier,
// never an access grant or a filesystem path. The caller must recheck host
// authority on every operation and coordinate run-reference changes with GC.
export type ArtifactOwner = {agentId:string;sessionKey:string;sessionId:string};
export type ArtifactOrigin = {runId:string;nodeId:string};
export type ArtifactReference = {kind:'loops-artifact';id:string;sha256:string;mediaType:string;bytes:number;ownerScope:string;runId:string;nodeId:string;createdAt:string;expiresAt:string};
export type ArtifactPage = {reference:ArtifactReference;offset:number;bytes:Uint8Array;nextOffset:number|null};
export type PortableArtifact = {sourceId:string;sha256:string;mediaType:string;bytes:number;sourceRunId:string;sourceNodeId:string} & ({mode:'embedded';dataBase64:string}|{mode:'external'});
export type ArtifactBundle = {format:'loops-artifacts-v1';artifacts:PortableArtifact[]};
export type ArtifactBudget = {maxArtifactBytes:number;maxTotalBytes:number;maxArtifacts:number;maxPageBytes:number;maxBundleBytes:number};
export type CleanupPolicy = {olderThanDays?:number;keepLatest?:number};
export type CleanupPlan = {planId:string;candidates:ArtifactReference[];protected:{active:number;recent:number};total:number;bytes:number};
export type ArtifactPublishCoordination={operationId:string;reserve:(refs:readonly ArtifactReference[],operationId:string)=>void;published:(refs:readonly ArtifactReference[],operationId:string)=>void};
export type ArtifactCleanupCoordination={begin:()=>ReadonlySet<string>;finish:(receipt:CleanupPlan&{removed:number})=>void};
export type ArtifactRecoveryReadback={id:string;status:'published'|'staged'|'missing'|'uncertain';reference?:ArtifactReference};
// A complete two-file embedded bundle is about 22.4 MB (21.3 MiB) of Base64 JSON. The
// extra bounded room covers the 256-entry manifest and optional dependencies.
export const maxPortableImportTransportBytes=24*1024*1024;

const defaults:ArtifactBudget={maxArtifactBytes:8*1024*1024,maxTotalBytes:64*1024*1024,maxArtifacts:256,maxPageBytes:64*1024,maxBundleBytes:16*1024*1024};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const mime=/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const operationId=/^[a-zA-Z0-9_-]{1,128}$/;
const leaseNames=new Set(['.custody-owner.sqlite','.custody-owner.sqlite-journal','.custody-owner.sqlite-wal','.custody-owner.sqlite-shm']);
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const fail=(code:string,message:string,recovery='Inspect the artifact request and committed store before retrying.')=>requestError(message,code,recovery);
const corrupt=()=>new LoopError({code:'LOOPS_ARTIFACT_CORRUPT',message:'Artifact metadata or content failed validation.',phase:'storage',retryable:false,recovery:'Preserve the plugin-owned artifact store and restore a verified matching backup. Do not overwrite the affected evidence.'});
const uncertain=(cause:unknown)=>new LoopError({code:'LOOPS_ARTIFACT_UNCERTAIN',message:'Artifact commit or cleanup has an uncertain storage outcome.',phase:'storage',retryable:false,recovery:'Inspect the plugin-owned store and durable run references before any explicit retry.'},{cause});
const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const string=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length>0&&value.length<=max;
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const iso=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function ownerScope(owner:ArtifactOwner):string{
  if(!plain(owner)||Object.keys(owner).sort().join(',')!=='agentId,sessionId,sessionKey'||!string(owner.agentId)||!string(owner.sessionKey,1024)||!string(owner.sessionId,1024))throw fail('LOOPS_ARTIFACT_OWNER','Artifact owner is missing or invalid.');
  // JSON array framing prevents ambiguous concatenation of authority fields.
  return hash(JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId]));
}
function origin(value:ArtifactOrigin){if(!plain(value)||Object.keys(value).sort().join(',')!=='nodeId,runId'||!string(value.runId)||!string(value.nodeId))throw fail('LOOPS_ARTIFACT_ORIGIN','Artifact run/node provenance is invalid.');}
function timestamp(at:number){if(!integer(at,0,8640000000000000))throw fail('LOOPS_ARTIFACT_TIME','Artifact operation time is invalid.');}
function reference(value:unknown):asserts value is ArtifactReference{
  if(!plain(value)||Object.keys(value).sort().join(',')!=='bytes,createdAt,expiresAt,id,kind,mediaType,nodeId,ownerScope,runId,sha256'||
    value.kind!=='loops-artifact'||typeof value.id!=='string'||!uuid.test(value.id)||typeof value.sha256!=='string'||!digest.test(value.sha256)||
    typeof value.ownerScope!=='string'||!digest.test(value.ownerScope)||typeof value.mediaType!=='string'||!mime.test(value.mediaType)||
    !integer(value.bytes)||!string(value.runId)||!string(value.nodeId)||!iso(value.createdAt)||!iso(value.expiresAt)||Date.parse(value.expiresAt)<Date.parse(value.createdAt))throw corrupt();
}
function canonicalBase64(value:unknown,max:number):Uint8Array{
  if(typeof value!=='string'||value.length>Math.ceil(max/3)*4+4)throw corrupt();
  const bytes=Buffer.from(value,'base64');
  // Exact re-encoding is both a canonical spelling check and a bounded linear
  // replacement for a repeating-group regex that overflows on full-size files.
  if(bytes.length>max||bytes.toString('base64')!==value)throw corrupt();
  return bytes;
}
function checkedBytes(value:unknown,max:number):Uint8Array{
  if(!(value instanceof Uint8Array)||value.byteLength>max)throw fail('LOOPS_ARTIFACT_SIZE','Artifact bytes exceed the configured limit or are invalid.');
  return Uint8Array.from(value);
}
function fsyncDirectory(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function safeDirectory(path:string){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw corrupt();}
type Stored={reference:ArtifactReference;dataBase64:string};
type Located={record:Stored;path:string;fingerprint:string};

export class ArtifactCustody {
  readonly budget:ArtifactBudget;
  private leaseDepth=0;
  constructor(readonly root:string,budget:Partial<ArtifactBudget>={}){
    if(!isAbsolute(root))throw fail('LOOPS_ARTIFACT_ROOT','Artifact storage root must be an absolute, caller-owned path.');
    this.budget={...defaults,...budget};
    if(Object.values(this.budget).some(value=>!integer(value,1,Number.MAX_SAFE_INTEGER))||this.budget.maxBundleBytes<this.budget.maxArtifactBytes||this.budget.maxTotalBytes<this.budget.maxArtifactBytes)throw fail('LOOPS_ARTIFACT_BUDGET','Artifact custody limits are invalid.');
    try{mkdirSync(root,{recursive:true,mode:0o700});safeDirectory(root);}catch(error){throw storageError(error);}
  }
  private locked<T>(action:()=>T):T{
    if(this.leaseDepth>0){
      this.leaseDepth++;
      let nested:{ok:true;value:T}|{ok:false;error:unknown};
      try{nested={ok:true,value:action()};}catch(error){nested={ok:false,error};}
      this.leaseDepth--;
      if(!nested.ok)throw nested.error;
      return nested.value;
    }
    const legacyLock=join(this.root,'.custody-lock'),leasePath=join(this.root,'.custody-owner.sqlite');
    safeDirectory(this.root);
    // The legacy bare directory has no trustworthy owner identity. It must be
    // inspected explicitly; it cannot be reclaimed safely by a new protocol.
    if(existsSync(legacyLock))throw fail('LOOPS_ARTIFACT_BUSY','Artifact custody has an unresolved legacy lock.','Inspect the old owner before explicit recovery.');
    try{const stat=lstatSync(leasePath);if(!stat.isFile()||stat.isSymbolicLink())throw corrupt();}
    catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    let lease:DatabaseSync|undefined;
    try{
      lease=new DatabaseSync(leasePath);
      const stat=lstatSync(leasePath);if(!stat.isFile()||stat.isSymbolicLink())throw corrupt();
      chmodSync(leasePath,0o600);
      lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
    }catch(error){
      // Closing also releases a partially acquired transaction. Never unlink
      // this stable file: concurrent crash recoverers share its OS lock.
      try{lease?.close();}catch{throw uncertain(error);}
      if(error instanceof Error&&'errcode' in error&&error.errcode===5)throw fail('LOOPS_ARTIFACT_BUSY','Artifact custody is owned by another operation.','Wait for its OS-backed lease to be released.');
      throw error instanceof LoopError?error:storageError(error);
    }
    if(existsSync(legacyLock)){lease.close();throw fail('LOOPS_ARTIFACT_BUSY','Artifact custody has an unresolved legacy lock.','Inspect the old owner before explicit recovery.');}
    this.leaseDepth=1;
    let outcome:{ok:true;value:T}|{ok:false;error:unknown};
    try{outcome={ok:true,value:action()};}catch(error){outcome={ok:false,error};}
    this.leaseDepth=0;
    let releaseError:unknown;
    try{lease.exec('ROLLBACK');}catch(error){releaseError=error;}
    try{lease.close();}catch(error){releaseError=releaseError?new AggregateError([releaseError,error]):error;}
    if(releaseError)throw uncertain(outcome.ok?releaseError:new AggregateError([outcome.error,releaseError]));
    if(!outcome.ok)throw outcome.error;
    return outcome.value;
  }
  // A synchronous SQLite worker call can run inside this lease. No promise may
  // escape: the file lock must cover every nested file and durable-ref action.
  withCoordinationLease<T>(callback:()=>T):T{
    if(typeof callback!=='function')throw fail('LOOPS_ARTIFACT_COORDINATION','Artifact coordination callback is invalid.');
    return this.locked(()=>{const value=callback();
      if(value!==null&&typeof value==='object'&&'then' in value&&typeof value.then==='function')throw uncertain(new Error('Asynchronous artifact coordination is forbidden.'));
      return value;});
  }
  private checkPublish(coordination:ArtifactPublishCoordination){
    if(!coordination||typeof coordination!=='object'||typeof coordination.operationId!=='string'||!operationId.test(coordination.operationId)||
      typeof coordination.reserve!=='function'||typeof coordination.published!=='function')throw fail('LOOPS_ARTIFACT_COORDINATION','Artifact publication coordination is invalid.');
  }
  private syncCallback<T>(callback:()=>T):T{
    const result=callback();
    if(result!==null&&typeof result==='object'&&'then' in result&&typeof result.then==='function')throw uncertain(new Error('Asynchronous artifact coordination is forbidden.'));
    return result;
  }
  private readStored(path:string,id:string):Located{
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>Math.ceil(this.budget.maxArtifactBytes/3)*4+4096)throw corrupt();
    let parsed:unknown;const raw=readFileSync(path);
    try{parsed=JSON.parse(raw.toString('utf8'));}catch{throw corrupt();}
    if(!plain(parsed)||Object.keys(parsed).sort().join(',')!=='dataBase64,reference')throw corrupt();
    reference(parsed.reference);
    if(parsed.reference.id!==id)throw corrupt();
    const bytes=canonicalBase64(parsed.dataBase64,this.budget.maxArtifactBytes);
    if(bytes.length!==parsed.reference.bytes||hash(bytes)!==parsed.reference.sha256)throw corrupt();
    return {record:parsed as Stored,path,fingerprint:hash(raw)};
  }
  private inventory(ignoreStaging=false):Located[]{
    const entries:Located[]=[];
    for(const dir of readdirSync(this.root)){
      if(leaseNames.has(dir))continue;
      if(dir.startsWith('.staging-')){if(ignoreStaging)continue;throw uncertain(new Error('Unresolved artifact staging directory.'));}
      if(!/^batch-[a-f0-9-]{36}$/.test(dir)||!uuid.test(dir.slice(6)))throw corrupt();
      const directory=join(this.root,dir);safeDirectory(directory);
      for(const name of readdirSync(directory)){
        if(!/^artifact-[a-f0-9-]{36}\.json$/.test(name)||!uuid.test(name.slice(9,-5)))throw corrupt();
        entries.push(this.readStored(join(directory,name),name.slice(9,-5)));
        if(entries.length>this.budget.maxArtifacts)throw corrupt();
      }
    }
    const ids=entries.map(item=>item.record.reference.id);
    if(new Set(ids).size!==ids.length)throw corrupt();
    return entries;
  }
  private scoped(items:Located[],scope:string,id:string):Located{
    if(!uuid.test(id))throw fail('LOOPS_ARTIFACT_NOT_FOUND','Artifact was not found in this owner scope.');
    const item=items.find(item=>item.record.reference.id===id&&item.record.reference.ownerScope===scope);
    if(!item)throw fail('LOOPS_ARTIFACT_NOT_FOUND','Artifact was not found in this owner scope.');
    return item;
  }
  private commit(records:Stored[],existing:Located[],preserveStagingOnFailure=false){
    this.checkQuota(records,existing);
    const id=randomUUID(),stage=join(this.root,`.staging-${id}`),destination=join(this.root,`batch-${id}`);
    let committed=false;
    try{
      if(existsSync(stage)||existsSync(destination))throw corrupt();
      mkdirSync(stage,{mode:0o700});
      for(const record of records)writeFileSync(join(stage,`artifact-${record.reference.id}.json`),JSON.stringify(record),{mode:0o600,flag:'wx',flush:true});
      fsyncDirectory(stage);
      if(existsSync(destination))throw corrupt();
      renameSync(stage,destination);committed=true;fsyncDirectory(this.root);
    }catch(error){
      if(committed)throw uncertain(error);
      // A durable SQL reservation already exists for coordinated publication.
      // Keep even partially written staging for exact-ID recovery inspection.
      if(preserveStagingOnFailure)throw uncertain(error);
      try{if(existsSync(stage)){safeDirectory(stage);for(const name of readdirSync(stage))unlinkSync(join(stage,name));rmdirSync(stage);}}catch(cleanup){throw uncertain(new AggregateError([error,cleanup]));}
      throw storageError(error);
    }
  }
  private checkQuota(records:Stored[],existing:Located[]){
    const total=existing.reduce((sum,item)=>sum+item.record.reference.bytes,0)+records.reduce((sum,item)=>sum+item.reference.bytes,0);
    if(existing.length+records.length>this.budget.maxArtifacts||total>this.budget.maxTotalBytes)throw fail('LOOPS_ARTIFACT_QUOTA','Artifact custody quota would be exceeded.');
  }
  private makeRecord(scope:string,where:ArtifactOrigin,bytes:Uint8Array,mediaType:string,retentionDays:number,at:number):Stored{
    origin(where);
    if(typeof mediaType!=='string'||!mime.test(mediaType))throw fail('LOOPS_ARTIFACT_MIME','Artifact media type is invalid.');
    if(!integer(retentionDays,0,365000))throw fail('LOOPS_ARTIFACT_RETENTION','Artifact retention is invalid.');
    timestamp(at);
    const createdAt=new Date(at).toISOString(),expiresAt=new Date(at+retentionDays*86400000).toISOString();
    if(!iso(expiresAt))throw fail('LOOPS_ARTIFACT_RETENTION','Artifact expiry is outside the supported date range.');
    return {reference:{kind:'loops-artifact',id:randomUUID(),sha256:hash(bytes),mediaType,bytes:bytes.length,ownerScope:scope,runId:where.runId,nodeId:where.nodeId,createdAt,expiresAt},dataBase64:Buffer.from(bytes).toString('base64')};
  }
  put(owner:ArtifactOwner,where:ArtifactOrigin,input:Uint8Array,mediaType:string,retentionDays=30,at=Date.now()):ArtifactReference{
    const scope=ownerScope(owner),bytes=checkedBytes(input,this.budget.maxArtifactBytes);
    return this.locked(()=>{const existing=this.inventory(),record=this.makeRecord(scope,where,bytes,mediaType,retentionDays,at);this.commit([record],existing);return record.reference;});
  }
  putCoordinated(owner:ArtifactOwner,where:ArtifactOrigin,input:Uint8Array,mediaType:string,coordination:ArtifactPublishCoordination,retentionDays=30,at=Date.now()):ArtifactReference{
    this.checkPublish(coordination);
    const scope=ownerScope(owner),bytes=checkedBytes(input,this.budget.maxArtifactBytes);
    return this.withCoordinationLease(()=>{const existing=this.inventory(),record=this.makeRecord(scope,where,bytes,mediaType,retentionDays,at),refs=[record.reference];
      this.checkQuota([record],existing);
      try{this.syncCallback(()=>coordination.reserve(refs,coordination.operationId));}catch(error){throw uncertain(error);}
      try{this.commit([record],existing,true);this.syncCallback(()=>coordination.published(refs,coordination.operationId));}catch(error){throw uncertain(error);}
      return record.reference;
    });
  }
  readPage(owner:ArtifactOwner,id:string,offset=0,limit=this.budget.maxPageBytes,at=Date.now()):ArtifactPage{
    const scope=ownerScope(owner);
    timestamp(at);
    if(!integer(offset)||!integer(limit,1,this.budget.maxPageBytes))throw fail('LOOPS_ARTIFACT_PAGE','Artifact page bounds are invalid.');
    return this.locked(()=>{const item=this.scoped(this.inventory(true),scope,id),ref=item.record.reference;
      if(at>=Date.parse(ref.expiresAt))throw fail('LOOPS_ARTIFACT_EXPIRED','Artifact retention has expired.');
      if(offset>ref.bytes)throw fail('LOOPS_ARTIFACT_PAGE','Artifact page offset is invalid.');
      const data=canonicalBase64(item.record.dataBase64,this.budget.maxArtifactBytes),end=Math.min(ref.bytes,offset+limit);
      return {reference:ref,offset,bytes:data.slice(offset,end),nextOffset:end<ref.bytes?end:null};
    });
  }
  list(owner:ArtifactOwner,cursor=0,limit=50):{items:ArtifactReference[];nextCursor:number|null;total:number}{
    const scope=ownerScope(owner);
    if(!integer(cursor)||!integer(limit,1,100))throw fail('LOOPS_ARTIFACT_PAGE','Artifact metadata page bounds are invalid.');
    return this.locked(()=>{const items=this.inventory(true).map(item=>item.record.reference).filter(ref=>ref.ownerScope===scope).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));return {items:items.slice(cursor,cursor+limit),nextCursor:cursor+limit<items.length?cursor+limit:null,total:items.length};});
  }
  // The caller first checks current owner authority and obtains these exact IDs
  // from a durable SQL reservation. This readback never publishes, retries or
  // deletes an uncertain staging directory.
  inspectRecovery(owner:ArtifactOwner,reservedIds:readonly string[]):ArtifactRecoveryReadback[]{
    const scope=ownerScope(owner);
    if(!Array.isArray(reservedIds)||reservedIds.length<1||reservedIds.length>Math.min(this.budget.maxArtifacts,100)||reservedIds.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(reservedIds).size!==reservedIds.length)throw fail('LOOPS_ARTIFACT_RECOVERY','Artifact recovery requires bounded reserved IDs.');
    return this.withCoordinationLease(()=>{
      const published=new Map(this.inventory(true).map(item=>[item.record.reference.id,item.record.reference]));
      const staged=new Map<string,ArtifactRecoveryReadback>();
      const directories=readdirSync(this.root).filter(name=>name.startsWith('.staging-'));
      if(directories.length>this.budget.maxArtifacts)throw uncertain(new Error('Too many unresolved artifact staging directories.'));
      for(const name of directories){
        if(!uuid.test(name.slice(9)))throw uncertain(new Error('Invalid artifact staging identity.'));
        const directory=join(this.root,name);safeDirectory(directory);
        for(const id of reservedIds){
          const path=join(directory,`artifact-${id}.json`);
          try{lstatSync(path);}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')continue;throw uncertain(error);}
          let next:ArtifactRecoveryReadback;
          try{const item=this.readStored(path,id);next=item.record.reference.ownerScope===scope?{id,status:'staged',reference:item.record.reference}:{id,status:'uncertain'};}
          catch{next={id,status:'uncertain'};}
          staged.set(id,staged.has(id)?{id,status:'uncertain'}:next);
        }
      }
      return reservedIds.map(id=>{
        const committed=published.get(id),stage=staged.get(id);
        if(stage&&committed)return {id,status:'uncertain'};
        if(stage)return stage;
        if(committed?.ownerScope===scope)return {id,status:'published',reference:committed};
        return {id,status:'missing'};
      });
    });
  }
  export(owner:ArtifactOwner,selections:Array<{id:string;mode:'embedded'|'external'}>,at=Date.now()):ArtifactBundle{
    const scope=ownerScope(owner);
    timestamp(at);
    if(!Array.isArray(selections)||selections.length<1||selections.length>this.budget.maxArtifacts||selections.some(item=>!plain(item)||typeof item.id!=='string'||!uuid.test(item.id)||!['embedded','external'].includes(item.mode)||Object.keys(item).sort().join(',')!=='id,mode')||new Set(selections.map(item=>item.id)).size!==selections.length)throw fail('LOOPS_ARTIFACT_EXPORT','Artifact export selection is invalid.');
    return this.locked(()=>{const inventory=this.inventory(true),artifacts:PortableArtifact[]=[];let embeddedBytes=0;
      for(const selection of selections){
        const item=this.scoped(inventory,scope,selection.id),ref=item.record.reference;
        if(at>=Date.parse(ref.expiresAt))throw fail('LOOPS_ARTIFACT_EXPIRED','Artifact retention has expired.');
        const entry={sourceId:ref.id,sha256:ref.sha256,mediaType:ref.mediaType,bytes:ref.bytes,sourceRunId:ref.runId,sourceNodeId:ref.nodeId};
        if(selection.mode==='embedded'){embeddedBytes+=ref.bytes;if(embeddedBytes>this.budget.maxBundleBytes)throw fail('LOOPS_ARTIFACT_SIZE','Embedded export exceeds the bundle limit.');artifacts.push({...entry,mode:'embedded',dataBase64:item.record.dataBase64});}
        else artifacts.push({...entry,mode:'external'});
      }
      return {format:'loops-artifacts-v1',artifacts};
    });
  }
  import(owner:ArtifactOwner,where:ArtifactOrigin,bundle:ArtifactBundle,externalBytes:Readonly<Record<string,Uint8Array>>={},retentionDays=30,at=Date.now()):ArtifactReference[]{
    const scope=ownerScope(owner);origin(where);
    timestamp(at);
    const validated=this.validateImport(bundle,externalBytes);
    return this.locked(()=>{const existing=this.inventory(),records=validated.map(item=>this.makeRecord(scope,where,item.bytes,item.mediaType,retentionDays,at));this.commit(records,existing);return records.map(item=>item.reference);});
  }
  importCoordinated(owner:ArtifactOwner,where:ArtifactOrigin,bundle:ArtifactBundle,externalBytes:Readonly<Record<string,Uint8Array>>,coordination:ArtifactPublishCoordination,retentionDays=30,at=Date.now()):ArtifactReference[]{
    this.checkPublish(coordination);
    const scope=ownerScope(owner);origin(where);timestamp(at);
    const validated=this.validateImport(bundle,externalBytes);
    return this.withCoordinationLease(()=>{const existing=this.inventory(),records=validated.map(item=>this.makeRecord(scope,where,item.bytes,item.mediaType,retentionDays,at)),refs=records.map(item=>item.reference);
      this.checkQuota(records,existing);
      try{this.syncCallback(()=>coordination.reserve(refs,coordination.operationId));}catch(error){throw uncertain(error);}
      try{this.commit(records,existing,true);this.syncCallback(()=>coordination.published(refs,coordination.operationId));}catch(error){throw uncertain(error);}
      return refs;
    });
  }
  verifyImport(bundle:ArtifactBundle,externalBytes:Readonly<Record<string,Uint8Array>>):Array<{sha256:string;bytes:number;mediaType:string}>{
    return this.validateImport(bundle,externalBytes).map(item=>({sha256:hash(item.bytes),bytes:item.bytes.length,mediaType:item.mediaType}));
  }
  private validateImport(bundle:ArtifactBundle,externalBytes:Readonly<Record<string,Uint8Array>>):Array<{bytes:Uint8Array;mediaType:string}>{
    if(!plain(externalBytes))throw fail('LOOPS_ARTIFACT_IMPORT','External artifact dependencies are invalid.');
    if(!plain(bundle)||bundle.format!=='loops-artifacts-v1'||!Array.isArray(bundle.artifacts)||bundle.artifacts.length<1||bundle.artifacts.length>this.budget.maxArtifacts)throw fail('LOOPS_ARTIFACT_IMPORT','Artifact bundle is invalid.');
    const seen=new Set<string>(),validated:Array<{bytes:Uint8Array;mediaType:string}>=[];let total=0;
    for(const item of bundle.artifacts){
      if(!plain(item)||typeof item.sourceId!=='string'||!uuid.test(item.sourceId)||seen.has(item.sourceId)||typeof item.sha256!=='string'||!digest.test(item.sha256)||
        typeof item.mediaType!=='string'||!mime.test(item.mediaType)||!integer(item.bytes,0,this.budget.maxArtifactBytes)||!string(item.sourceRunId)||!string(item.sourceNodeId)||
        (item.mode!=='embedded'&&item.mode!=='external')||Object.keys(item).sort().join(',')!==(item.mode==='embedded'?'bytes,dataBase64,mediaType,mode,sha256,sourceId,sourceNodeId,sourceRunId':'bytes,mediaType,mode,sha256,sourceId,sourceNodeId,sourceRunId'))throw fail('LOOPS_ARTIFACT_IMPORT','Artifact bundle metadata is invalid.');
      seen.add(item.sourceId);total+=item.bytes;if(total>this.budget.maxBundleBytes)throw fail('LOOPS_ARTIFACT_SIZE','Artifact import exceeds the bundle limit.');
      let bytes:Uint8Array;
      if(item.mode==='embedded'){
        try{bytes=canonicalBase64(item.dataBase64,this.budget.maxArtifactBytes);}
        catch{throw fail('LOOPS_ARTIFACT_DEPENDENCY_CORRUPT','Embedded artifact bytes are invalid.');}
      }
      else {
        if(!own(externalBytes,item.sourceId))throw fail('LOOPS_ARTIFACT_DEPENDENCY_MISSING','An external artifact dependency is missing.','Supply verified bytes through the authorized caller boundary, then explicitly retry the import.');
        bytes=checkedBytes(externalBytes[item.sourceId],this.budget.maxArtifactBytes);
      }
      if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw fail('LOOPS_ARTIFACT_DEPENDENCY_CORRUPT','Artifact dependency digest or length does not match.');
      validated.push({bytes,mediaType:item.mediaType});
    }
    return validated;
  }
  previewCleanup(owner:ArtifactOwner,policy:CleanupPolicy,protectedIds:ReadonlySet<string>,at=Date.now()):CleanupPlan{
    const scope=ownerScope(owner);
    this.validateCleanup(policy,protectedIds,at);
    return this.locked(()=>this.plan(this.inventory(),scope,policy,protectedIds,at));
  }
  previewCleanupCoordinated(owner:ArtifactOwner,policy:CleanupPolicy,protectedSnapshot:()=>ReadonlySet<string>,at=Date.now()):CleanupPlan{
    ownerScope(owner);this.validateCleanup(policy,new Set(),at);
    if(typeof protectedSnapshot!=='function')throw fail('LOOPS_ARTIFACT_COORDINATION','Artifact protected snapshot callback is invalid.');
    return this.withCoordinationLease(()=>{
      let protectedIds:ReadonlySet<string>;
      try{protectedIds=this.syncCallback(protectedSnapshot);}catch(error){throw uncertain(error);}
      return this.previewCleanup(owner,policy,protectedIds,at);
    });
  }
  private validateCleanup(policy:CleanupPolicy,protectedIds:ReadonlySet<string>,at:number){
    timestamp(at);
    if(!plain(policy)||Object.keys(policy).some(key=>key!=='olderThanDays'&&key!=='keepLatest')||policy.olderThanDays===undefined&&policy.keepLatest===undefined||policy.olderThanDays!==undefined&&(!Number.isFinite(policy.olderThanDays)||policy.olderThanDays<0||policy.olderThanDays>365000)||policy.keepLatest!==undefined&&!integer(policy.keepLatest,0,this.budget.maxArtifacts)||
      !(protectedIds instanceof Set)||protectedIds.size>this.budget.maxArtifacts||[...protectedIds].some(id=>typeof id!=='string'||!uuid.test(id)))throw fail('LOOPS_ARTIFACT_RETENTION','Artifact cleanup policy or protected references are invalid.');
  }
  private plan(inventory:Located[],scope:string,policy:CleanupPolicy,protectedIds:ReadonlySet<string>,at:number):CleanupPlan{
    const ordered=inventory.map(item=>item.record.reference).filter(ref=>ref.ownerScope===scope).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    const candidates:ArtifactReference[]=[];const protectedCounts={active:0,recent:0};
    ordered.forEach((ref,index)=>{if(protectedIds.has(ref.id)){protectedCounts.active++;return;}
      if(index<(policy.keepLatest??0)||at<Date.parse(ref.expiresAt)&&at-Date.parse(ref.createdAt)<(policy.olderThanDays??0)*86400000){protectedCounts.recent++;return;}candidates.push(ref);});
    const bytes=candidates.reduce((sum,ref)=>sum+ref.bytes,0);
    const planId=hash(JSON.stringify({scope,policy,inventory:ordered.map(ref=>[ref.id,ref.sha256,ref.bytes,ref.createdAt,ref.expiresAt]),candidates:candidates.map(ref=>ref.id),protected:[...protectedIds].sort()}));
    return {planId,candidates,protected:protectedCounts,total:ordered.length,bytes};
  }
  applyCleanup(owner:ArtifactOwner,policy:CleanupPolicy,protectedIds:ReadonlySet<string>,expectedPlanId:string,at=Date.now()):CleanupPlan&{removed:number}{
    const scope=ownerScope(owner);
    this.validateCleanup(policy,protectedIds,at);
    if(typeof expectedPlanId!=='string'||!digest.test(expectedPlanId))throw fail('LOOPS_ARTIFACT_CLEANUP_CONFLICT','Artifact cleanup requires a current preview.');
    return this.locked(()=>{const inventory=this.inventory(),plan=this.plan(inventory,scope,policy,protectedIds,at);
      if(plan.planId!==expectedPlanId)throw fail('LOOPS_ARTIFACT_CLEANUP_CONFLICT','Artifact cleanup changed since preview. No files were removed.');
      let removed=0;
      try{const touched=new Set<string>();
        for(const ref of plan.candidates){const item=this.scoped(inventory,scope,ref.id),stat=lstatSync(item.path);
          if(!stat.isFile()||stat.isSymbolicLink()||hash(readFileSync(item.path))!==item.fingerprint)throw new Error('Artifact changed after cleanup preview.');
          unlinkSync(item.path);touched.add(dirname(item.path));removed++;}
        for(const directory of touched)fsyncDirectory(directory);
        fsyncDirectory(this.root);
        const remaining=new Set(this.inventory().map(item=>item.record.reference.id));
        if(plan.candidates.some(ref=>remaining.has(ref.id)))throw new Error('Artifact cleanup readback did not confirm removal.');}
      catch(error){throw new LoopError({code:'LOOPS_ARTIFACT_CLEANUP_PARTIAL',message:`Artifact cleanup stopped after removing ${removed} of ${plan.candidates.length} files.`,phase:'storage',retryable:false,recovery:'Inspect the remaining files and obtain a fresh cleanup preview. Removed files are not restored.'},{cause:error});}
      return {...plan,removed};
    });
  }
  applyCleanupCoordinated(owner:ArtifactOwner,policy:CleanupPolicy,expectedPlanId:string,coordination:ArtifactCleanupCoordination,at=Date.now()):CleanupPlan&{removed:number}{
    ownerScope(owner);this.validateCleanup(policy,new Set(),at);
    if(typeof expectedPlanId!=='string'||!digest.test(expectedPlanId)||!coordination||typeof coordination.begin!=='function'||typeof coordination.finish!=='function')throw fail('LOOPS_ARTIFACT_COORDINATION','Artifact cleanup coordination is invalid.');
    return this.withCoordinationLease(()=>{
      let protectedIds:ReadonlySet<string>;
      try{protectedIds=this.syncCallback(coordination.begin);}catch(error){throw uncertain(error);}
      let receipt:CleanupPlan&{removed:number};
      // A successful begin owns a durable SQL GC lease. Any subsequent failure
      // leaves that lease for explicit reconciliation, even if zero files moved.
      try{receipt=this.applyCleanup(owner,policy,protectedIds,expectedPlanId,at);}catch(error){throw uncertain(error);}
      try{this.syncCallback(()=>coordination.finish(receipt));}catch(error){throw uncertain(error);}
      return receipt;
    });
  }
}

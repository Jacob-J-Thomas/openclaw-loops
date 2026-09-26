import {createHash} from 'node:crypto';
import {LoopError,requestError} from './errors.js';
import {fingerprintJson} from './fingerprint.js';
import {isJson,type Json} from './node-values.js';
import {assertMemoryPolicy,memoryAccess,memoryPrefixAllowed,validMemoryKey,type MemoryPolicy,type MemoryOperation} from './memory-policy.js';

export type MemoryOwner={agentId:string;sessionKey:string;sessionId:string};
export type MemoryInvocation={owner:MemoryOwner;loopId:string;loopRevision:number;runId:string;nodeId:string;grantGeneration:string;policy?:MemoryPolicy;assertAuthorized:()=>void;signal?:AbortSignal};
export type MemoryProvenance={loopRevision:number;runId:string;nodeId:string;grantGeneration:string;mutationId:string;operation:'write'|'update'|'forget'|'retention'|'reset';at:string};
export type MemoryRecord={scope:string;loopId:string;key:string;version:number;deleted:boolean;schemaId:string;schemaVersion:number;value?:Json;valueSha256?:string;createdAt:string;updatedAt:string;expiresAt:string;provenance:MemoryProvenance};
export type MemoryReceipt={scope:string;loopId:string;key:string;version:number;deleted:boolean;mutationId:string;committedAt:string;provenance:MemoryProvenance};
export type MemoryPage={items:MemoryRecord[];nextCursor:string|null;total:number};
export type MemoryBudget={maxValueBytes:number;maxKeys:number;maxTotalBytes:number;maxSearchResults:number;maxSearchBytes:number;maxMutations:number;maxReceiptBytes:number};
export type MemoryWrite={scope:string;loopId:string;key:string;expectedVersion:number;next:MemoryRecord;mutationId:string;budget:MemoryBudget};
export type MemoryRemovalPlan={planId:string;mode:'retention'|'reset';prefix:string;candidates:Array<{key:string;version:number;valueSha256?:string}>;total:number};
export interface MemoryRepository {
  // One store owner must serialize these calls. commit/commitBatch atomically
  // enforce expected versions, unique mutation IDs, quotas and receipts.
  get(scope:string,loopId:string,key:string):MemoryRecord|undefined;
  page(scope:string,loopId:string,prefix:string,cursor:string|undefined,limit:number):MemoryPage;
  mutation(scope:string,loopId:string,mutationId:string):MemoryReceipt[]|undefined;
  commit(write:MemoryWrite):MemoryReceipt;
  commitBatch(writes:MemoryWrite[],mutationId:string):MemoryReceipt[];
}
export interface MemorySchemaValidator {check(schemaId:string,schemaVersion:number,value:Json):boolean}

const defaults:MemoryBudget={maxValueBytes:64*1024,maxKeys:256,maxTotalBytes:1024*1024,maxSearchResults:50,maxSearchBytes:128*1024,maxMutations:4096,maxReceiptBytes:2*1024*1024};
const name=/^[a-z][a-z0-9_-]{0,47}$/;
const id=/^[a-zA-Z0-9_-]{1,128}$/;
const digest=/^[a-f0-9]{64}$/;
const plain=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const iso=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const within=(key:string,prefix:string)=>key===prefix||key.startsWith(`${prefix}.`);
const uncertain=(mutationId:string,cause:unknown)=>new LoopError({code:'LOOPS_MEMORY_UNCERTAIN',message:`Memory mutation ${mutationId} has an uncertain outcome.`,phase:'storage',retryable:false,recovery:'Use the explicit mutation receipt lookup and inspect the key before deciding whether to retry. Do not automatically replay the effect.'},{cause});
const corrupt=()=>new LoopError({code:'LOOPS_MEMORY_CORRUPT',message:'Stored memory provenance or value failed validation.',phase:'storage',retryable:false,recovery:'Preserve the plugin-owned store and restore a matching verified backup. Do not replace the damaged record.'});
function scope(owner:MemoryOwner){
  if(!plain(owner)||Object.keys(owner).sort().join(',')!=='agentId,sessionId,sessionKey'||![owner.agentId,owner.sessionKey,owner.sessionId].every(value=>typeof value==='string'&&value.length>0&&value.length<=1024))throw requestError('Current memory owner is invalid.','LOOPS_MEMORY_OWNER');
  return hash(JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId]));
}
function assertInvocation(inv:MemoryInvocation){
  if(!plain(inv)||!name.test(inv.loopId)||!name.test(inv.nodeId)||!Number.isSafeInteger(inv.loopRevision)||inv.loopRevision<1||
    typeof inv.runId!=='string'||!id.test(inv.runId)||typeof inv.grantGeneration!=='string'||!id.test(inv.grantGeneration)||typeof inv.assertAuthorized!=='function')throw requestError('Current memory invocation is invalid.','LOOPS_MEMORY_INVOCATION');
  const ownerScope=scope(inv.owner);
  inv.assertAuthorized();
  if(inv.signal?.aborted)throw requestError('Memory operation was cancelled before commit.','LOOPS_MEMORY_CANCELLED');
  return ownerScope;
}
function assertRecord(value:unknown,expectedScope:string,loopId:string):asserts value is MemoryRecord{
  if(!plain(value)||Object.keys(value).sort().join(',')!==(value.deleted?'createdAt,deleted,expiresAt,key,loopId,provenance,schemaId,schemaVersion,scope,updatedAt,version':'createdAt,deleted,expiresAt,key,loopId,provenance,schemaId,schemaVersion,scope,updatedAt,value,valueSha256,version')||
    value.scope!==expectedScope||value.loopId!==loopId||!validMemoryKey(value.key)||!Number.isSafeInteger(value.version)||Number(value.version)<1||
    typeof value.deleted!=='boolean'||typeof value.schemaId!=='string'||!name.test(value.schemaId)||!Number.isSafeInteger(value.schemaVersion)||Number(value.schemaVersion)<1||
    !iso(value.createdAt)||!iso(value.updatedAt)||!iso(value.expiresAt)||Date.parse(value.updatedAt)<Date.parse(value.createdAt)||Date.parse(value.expiresAt)<Date.parse(value.createdAt)||
    !plain(value.provenance)||Object.keys(value.provenance).sort().join(',')!=='at,grantGeneration,loopRevision,mutationId,nodeId,operation,runId'||!Number.isSafeInteger(value.provenance.loopRevision)||Number(value.provenance.loopRevision)<1||
    typeof value.provenance.runId!=='string'||!id.test(value.provenance.runId)||typeof value.provenance.nodeId!=='string'||!name.test(value.provenance.nodeId)||
    typeof value.provenance.grantGeneration!=='string'||!id.test(value.provenance.grantGeneration)||
    typeof value.provenance.mutationId!=='string'||!id.test(value.provenance.mutationId)||!['write','update','forget','retention','reset'].includes(String(value.provenance.operation))||!iso(value.provenance.at)||
    (value.deleted?(value.value!==undefined||value.valueSha256!==undefined):(!isJson(value.value)||typeof value.valueSha256!=='string'||!digest.test(value.valueSha256)||fingerprintJson(value.value)!==value.valueSha256)))throw corrupt();
}
function copy<T>(value:T):T{return structuredClone(value);}
function time(at:number){if(!Number.isSafeInteger(at)||at<0||at>8640000000000000)throw requestError('Memory operation time is invalid.','LOOPS_MEMORY_TIME');return new Date(at).toISOString();}

export class MemoryCore {
  readonly budget:MemoryBudget;
  constructor(private readonly repository:MemoryRepository,private readonly schemas:MemorySchemaValidator,budget:Partial<MemoryBudget>={}){
    this.budget={...defaults,...budget};
    if(Object.values(this.budget).some(value=>!Number.isSafeInteger(value)||value<1)||this.budget.maxTotalBytes<this.budget.maxValueBytes)throw requestError('Memory limits are invalid.','LOOPS_MEMORY_BUDGET');
  }
  private access(inv:MemoryInvocation,operation:MemoryOperation,key:string){
    const ownerScope=assertInvocation(inv);
    memoryAccess(inv.policy,inv.nodeId,operation,key);
    return ownerScope;
  }
  private read(scope:string,loopId:string,key:string){const value=this.repository.get(scope,loopId,key);if(value){assertRecord(value,scope,loopId);
    if(value.value!==undefined&&(Buffer.byteLength(JSON.stringify(value.value))>this.budget.maxValueBytes||this.schemas.check(value.schemaId,value.schemaVersion,value.value)!==true))throw corrupt();}return value;}
  private visible(value:MemoryRecord|undefined,at:number){return value&&!value.deleted&&at<Date.parse(value.expiresAt);}
  consume(inv:MemoryInvocation,key:string,at=Date.now()):MemoryRecord{
    const ownerScope=this.access(inv,'consume',key);time(at);
    const value=this.read(ownerScope,inv.loopId,key);
    if(!this.visible(value,at))throw requestError('Memory key is absent or expired.','LOOPS_MEMORY_NOT_FOUND');
    return copy(value!);
  }
  inspect(inv:MemoryInvocation,key:string):Omit<MemoryRecord,'value'>{
    const ownerScope=this.access(inv,'inspect',key),record=this.read(ownerScope,inv.loopId,key);
    if(!record)throw requestError('Memory key is absent.','LOOPS_MEMORY_NOT_FOUND');
    const {value: _value,...metadata}=record;return copy(metadata);
  }
  search(inv:MemoryInvocation,prefix:string,cursor?:string,limit=20,at=Date.now()):{items:MemoryRecord[];nextCursor:string|null;total:number}{
    const ownerScope=assertInvocation(inv);memoryPrefixAllowed(inv.policy,inv.nodeId,'search',prefix);time(at);
    if(cursor!==undefined&&!validMemoryKey(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>this.budget.maxSearchResults)throw requestError('Memory search page is invalid.','LOOPS_MEMORY_PAGE');
    const page=this.repository.page(ownerScope,inv.loopId,prefix,cursor,limit);
    if(!page||!Array.isArray(page.items)||page.items.length>limit||!Number.isSafeInteger(page.total)||page.total<page.items.length||page.total>this.budget.maxKeys||
      page.nextCursor!==null&&page.nextCursor!==undefined&&!validMemoryKey(page.nextCursor))throw corrupt();
    let previous=cursor??'';
    for(const item of page.items){assertRecord(item,ownerScope,inv.loopId);if(!within(item.key,prefix)||item.key<=previous||item.value!==undefined&&(Buffer.byteLength(JSON.stringify(item.value))>this.budget.maxValueBytes||this.schemas.check(item.schemaId,item.schemaVersion,item.value)!==true))throw corrupt();previous=item.key;}
    if(page.nextCursor!==null&&page.nextCursor!==undefined&&page.nextCursor!==previous||page.items.length===0&&page.nextCursor!==null)throw corrupt();
    const visible=page.items.filter(item=>this.visible(item,at));
    if(Buffer.byteLength(JSON.stringify(visible))>this.budget.maxSearchBytes)throw requestError('Memory search page exceeds its byte limit.','LOOPS_MEMORY_PAGE');
    return {items:copy(visible),nextCursor:page.nextCursor??null,total:page.total};
  }
  private provenance(inv:MemoryInvocation,mutationId:string,operation:MemoryProvenance['operation'],at:number):MemoryProvenance{
    if(typeof mutationId!=='string'||!id.test(mutationId))throw requestError('Memory mutation ID is invalid.','LOOPS_MEMORY_MUTATION_ID');
    return {loopRevision:inv.loopRevision,runId:inv.runId,nodeId:inv.nodeId,grantGeneration:inv.grantGeneration,mutationId,operation,at:time(at)};
  }
  private receiptCheck(receipt:MemoryReceipt,record:MemoryRecord){
    if(!plain(receipt)||receipt.scope!==record.scope||receipt.loopId!==record.loopId||receipt.key!==record.key||receipt.version!==record.version||receipt.deleted!==record.deleted||receipt.mutationId!==record.provenance.mutationId||!iso(receipt.committedAt)||!plain(receipt.provenance)||fingerprintJson(receipt.provenance)!==fingerprintJson(record.provenance))throw corrupt();
    const saved=this.read(record.scope,record.loopId,record.key);
    if(!saved||saved.version!==record.version||saved.deleted!==record.deleted||fingerprintJson(saved.provenance)!==fingerprintJson(record.provenance)||saved.valueSha256!==record.valueSha256)throw corrupt();
  }
  private commit(inv:MemoryInvocation,record:MemoryRecord,expectedVersion:number):MemoryReceipt{
    // No await between this check and the synchronous CAS port. The engine
    // must provide the current grant assertion, not a copied imported grant.
    assertInvocation(inv);
    memoryAccess(inv.policy,inv.nodeId,record.provenance.operation,record.key);
    let receipt:MemoryReceipt;
    try{receipt=this.repository.commit({scope:record.scope,loopId:record.loopId,key:record.key,expectedVersion,next:copy(record),mutationId:record.provenance.mutationId,budget:this.budget});}
    catch(error){if(error instanceof LoopError&&['LOOPS_MEMORY_CONFLICT','LOOPS_MEMORY_QUOTA'].includes(error.code))throw error;throw uncertain(record.provenance.mutationId,error);}
    try{this.receiptCheck(receipt,record);}catch(error){throw uncertain(record.provenance.mutationId,error);}
    return copy(receipt);
  }
  write(inv:MemoryInvocation,key:string,value:Json,mutationId:string,at=Date.now()):MemoryReceipt{return this.save(inv,'write',key,value,0,mutationId,at);}
  update(inv:MemoryInvocation,key:string,value:Json,expectedVersion:number,mutationId:string,at=Date.now()):MemoryReceipt{return this.save(inv,'update',key,value,expectedVersion,mutationId,at);}
  private save(inv:MemoryInvocation,operation:'write'|'update',key:string,value:Json,expectedVersion:number,mutationId:string,at:number):MemoryReceipt{
    const ownerScope=this.access(inv,operation,key),date=time(at);
    if(!isJson(value)||!Number.isSafeInteger(expectedVersion)||expectedVersion<(operation==='write'?0:1))throw requestError('Memory value or expected revision is invalid.','LOOPS_MEMORY_VALUE');
    const scope=memoryAccess(inv.policy,inv.nodeId,operation,key)!;
    const encoded=JSON.stringify(value),bytes=Buffer.byteLength(encoded);
    if(bytes>this.budget.maxValueBytes)throw requestError('Memory value exceeds its byte limit.','LOOPS_MEMORY_SIZE');
    if(this.schemas.check(scope.schemaId,scope.schemaVersion,value)!==true)throw requestError('Memory JSON schema rejected the value.','LOOPS_MEMORY_SCHEMA');
    const previous=this.read(ownerScope,inv.loopId,key);
    if((previous?.version??0)!==expectedVersion)throw requestError('Memory key changed; reload before writing.','LOOPS_MEMORY_CONFLICT');
    if(previous&&at<Date.parse(previous.createdAt))throw requestError('Memory update time precedes its creation.','LOOPS_MEMORY_TIME');
    const expiresAt=time(at+scope.retentionDays*86400000);
    const next:MemoryRecord={scope:ownerScope,loopId:inv.loopId,key,version:expectedVersion+1,deleted:false,schemaId:scope.schemaId,schemaVersion:scope.schemaVersion,
      value:copy(value),valueSha256:fingerprintJson(value),createdAt:previous?.createdAt??date,updatedAt:date,expiresAt,
      provenance:this.provenance(inv,mutationId,operation,at)};
    return this.commit(inv,next,expectedVersion);
  }
  forget(inv:MemoryInvocation,key:string,expectedVersion:number,mutationId:string,at=Date.now()):MemoryReceipt{
    const ownerScope=this.access(inv,'forget',key),date=time(at),previous=this.read(ownerScope,inv.loopId,key);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||!previous||previous.version!==expectedVersion||previous.deleted)throw requestError('Memory key changed or was already removed.','LOOPS_MEMORY_CONFLICT');
    if(at<Date.parse(previous.createdAt))throw requestError('Memory removal time precedes its creation.','LOOPS_MEMORY_TIME');
    const next:MemoryRecord={scope:ownerScope,loopId:inv.loopId,key,version:expectedVersion+1,deleted:true,schemaId:previous.schemaId,schemaVersion:previous.schemaVersion,
      createdAt:previous.createdAt,updatedAt:date,expiresAt:previous.expiresAt,provenance:this.provenance(inv,mutationId,'forget',at)};
    return this.commit(inv,next,expectedVersion);
  }
  mutation(inv:MemoryInvocation,mutationId:string):MemoryReceipt[]|undefined{
    const ownerScope=assertInvocation(inv);
    if(typeof mutationId!=='string'||!id.test(mutationId))throw requestError('Memory mutation ID is invalid.','LOOPS_MEMORY_MUTATION_ID');
    if(!inv.policy||!inv.policy.enabled)throw requestError('Memory is disabled for this loop.','LOOPS_MEMORY_DISABLED');
    assertMemoryPolicy(inv.policy);
    const receipts=this.repository.mutation(ownerScope,inv.loopId,mutationId);
    if(!receipts)return undefined;
    if(!Array.isArray(receipts)||receipts.length<1||receipts.length>this.budget.maxKeys)throw corrupt();
    // A receipt is visible only through an authored current read/write/forget scope.
    const operations:MemoryOperation[]=['inspect','write','forget'];
    for(const receipt of receipts){
      if(!plain(receipt)||receipt.scope!==ownerScope||receipt.loopId!==inv.loopId||receipt.mutationId!==mutationId||!validMemoryKey(receipt.key)||!Number.isSafeInteger(receipt.version)||receipt.version<1||typeof receipt.deleted!=='boolean'||!iso(receipt.committedAt)||!plain(receipt.provenance)||receipt.provenance.mutationId!==mutationId)throw corrupt();
      if(!operations.some(operation=>{try{memoryAccess(inv.policy,inv.nodeId,operation,receipt.key);return true;}catch{return false;}}))throw requestError('Memory mutation is outside this node scope.','LOOPS_MEMORY_DENIED');
    }
    return copy(receipts);
  }
  removalPreview(inv:MemoryInvocation,prefix:string,mode:'retention'|'reset',at=Date.now()):MemoryRemovalPlan{
    const ownerScope=assertInvocation(inv);memoryPrefixAllowed(inv.policy,inv.nodeId,mode,prefix);time(at);
    const page=this.repository.page(ownerScope,inv.loopId,prefix,undefined,this.budget.maxKeys);
    if(!page||!Array.isArray(page.items)||page.items.length>this.budget.maxKeys||page.nextCursor!==null||page.total!==page.items.length)throw corrupt();
    let previous='';const candidates:MemoryRemovalPlan['candidates']=[];
    for(const item of page.items){assertRecord(item,ownerScope,inv.loopId);if(!within(item.key,prefix)||item.key<=previous||item.value!==undefined&&(Buffer.byteLength(JSON.stringify(item.value))>this.budget.maxValueBytes||this.schemas.check(item.schemaId,item.schemaVersion,item.value)!==true))throw corrupt();previous=item.key;
      if(!item.deleted&&(mode==='reset'||at>=Date.parse(item.expiresAt)))candidates.push({key:item.key,version:item.version,valueSha256:item.valueSha256});}
    const planId=fingerprintJson({ownerScope,loopId:inv.loopId,prefix,mode,inventory:page.items.map(item=>[item.key,item.version,item.valueSha256,item.expiresAt]),candidates});
    return {planId,mode,prefix,candidates,total:page.total};
  }
  applyRemoval(inv:MemoryInvocation,plan:MemoryRemovalPlan,mutationId:string,at=Date.now()):MemoryReceipt[]{
    if(!plain(plan)||typeof plan.planId!=='string'||!digest.test(plan.planId)||!['retention','reset'].includes(plan.mode))throw requestError('Memory removal requires a valid preview.','LOOPS_MEMORY_CONFLICT');
    const fresh=this.removalPreview(inv,plan.prefix,plan.mode,at);
    if(fresh.planId!==plan.planId)throw requestError('Memory removal changed since preview. No values were removed.','LOOPS_MEMORY_CONFLICT');
    const ownerScope=assertInvocation(inv),date=time(at),provenance=this.provenance(inv,mutationId,plan.mode,at);
    const writes:MemoryWrite[]=fresh.candidates.map(candidate=>{const previous=this.read(ownerScope,inv.loopId,candidate.key)!;
      if(at<Date.parse(previous.createdAt))throw requestError('Memory removal time precedes its creation.','LOOPS_MEMORY_TIME');
      const next:MemoryRecord={scope:ownerScope,loopId:inv.loopId,key:candidate.key,version:previous.version+1,deleted:true,schemaId:previous.schemaId,schemaVersion:previous.schemaVersion,
        createdAt:previous.createdAt,updatedAt:date,expiresAt:previous.expiresAt,provenance};
      return {scope:ownerScope,loopId:inv.loopId,key:candidate.key,expectedVersion:previous.version,next,mutationId,budget:this.budget};});
    if(writes.length===0)return [];
    assertInvocation(inv);
    let receipts:MemoryReceipt[];
    try{receipts=this.repository.commitBatch(writes,mutationId);}catch(error){if(error instanceof LoopError&&['LOOPS_MEMORY_CONFLICT','LOOPS_MEMORY_QUOTA'].includes(error.code))throw error;throw uncertain(mutationId,error);}
    try{if(!Array.isArray(receipts)||receipts.length!==writes.length)throw corrupt();for(let index=0;index<writes.length;index++)this.receiptCheck(receipts[index],writes[index].next);}
    catch(error){throw uncertain(mutationId,error);}
    return copy(receipts);
  }
}

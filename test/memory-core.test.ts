import {describe,expect,it} from 'vitest';
import {Type} from 'typebox';
import {Value} from 'typebox/value';
import {MemoryCore,type MemoryInvocation,type MemoryOwner,type MemoryReceipt,type MemoryRecord,type MemoryRepository,type MemoryWrite} from '../src/memory-core.js';
import {type MemoryPolicy} from '../src/memory-policy.js';
import {requestError} from '../src/errors.js';

const owner:MemoryOwner={agentId:'main',sessionKey:'agent:main:main',sessionId:'generation-one'};
const policy:MemoryPolicy={version:1,enabled:true,nodes:{
  writer:{readPrefixes:['research'],writeScopes:[{prefix:'research',schemaId:'note',schemaVersion:1,retentionDays:30}],forgetPrefixes:['research']},
  reader:{readPrefixes:['research'],writeScopes:[],forgetPrefixes:[]},
}};
const at=Date.parse('2026-09-24T00:00:00.000Z');
function invocation(overrides:Partial<MemoryInvocation>={}):MemoryInvocation{
  return {owner,loopId:'research_loop',loopRevision:3,runId:'run_one',nodeId:'writer',grantGeneration:'grant_one',policy,assertAuthorized:()=>{},...overrides};
}
class Repository implements MemoryRepository{
  readonly records=new Map<string,MemoryRecord>();
  readonly receipts=new Map<string,MemoryReceipt[]>();
  failAfterCommit=false;
  private recordKey(scope:string,loopId:string,key:string){return JSON.stringify([scope,loopId,key]);}
  private mutationKey(scope:string,loopId:string,mutationId:string){return JSON.stringify([scope,loopId,mutationId]);}
  get(scope:string,loopId:string,key:string){const value=this.records.get(this.recordKey(scope,loopId,key));return value&&structuredClone(value);}
  page(scope:string,loopId:string,prefix:string,cursor:string|undefined,limit:number){
    const items=[...this.records.values()].filter(item=>item.scope===scope&&item.loopId===loopId&&(item.key===prefix||item.key.startsWith(`${prefix}.`))).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
    const start=cursor===undefined?0:items.findIndex(item=>item.key>cursor);
    const rows=items.slice(start<0?items.length:start,(start<0?items.length:start)+limit);
    return {items:structuredClone(rows),nextCursor:rows.length&&start+limit<items.length?rows.at(-1)!.key:null,total:items.length};
  }
  mutation(scope:string,loopId:string,mutationId:string){const value=this.receipts.get(this.mutationKey(scope,loopId,mutationId));return value&&structuredClone(value);}
  commit(write:MemoryWrite){return this.commitBatch([write],write.mutationId)[0];}
  commitBatch(writes:MemoryWrite[],mutationId:string){
    if(!writes.length)throw Error('empty batch');
    const first=writes[0],key=this.mutationKey(first.scope,first.loopId,mutationId);
    if(this.receipts.has(key))throw requestError('Mutation ID was already used.','LOOPS_MEMORY_CONFLICT');
    for(const write of writes){
      const current=this.get(write.scope,write.loopId,write.key);
      if((current?.version??0)!==write.expectedVersion||write.next.version!==write.expectedVersion+1)throw requestError('Memory CAS conflict.','LOOPS_MEMORY_CONFLICT');
    }
    const next=new Map(this.records);
    for(const write of writes)next.set(this.recordKey(write.scope,write.loopId,write.key),structuredClone(write.next));
    const rows=[...next.values()].filter(item=>item.scope===first.scope&&item.loopId===first.loopId);
    if(rows.length>first.budget.maxKeys||rows.reduce((sum,item)=>sum+(item.value===undefined?0:Buffer.byteLength(JSON.stringify(item.value))),0)>first.budget.maxTotalBytes)throw requestError('Memory quota exceeded.','LOOPS_MEMORY_QUOTA');
    const receipts=writes.map(write=>({scope:write.scope,loopId:write.loopId,key:write.key,version:write.next.version,deleted:write.next.deleted,mutationId,committedAt:write.next.updatedAt,provenance:structuredClone(write.next.provenance)}));
    const prior=[...this.receipts.entries()].filter(([identity])=>{
      const [scope,loopId]=JSON.parse(identity) as string[];
      return scope===first.scope&&loopId===first.loopId;
    });
    const receiptBytes=prior.reduce((sum,[,rows])=>sum+Buffer.byteLength(JSON.stringify(rows)),0)+Buffer.byteLength(JSON.stringify(receipts));
    if(prior.length+1>first.budget.maxMutations||receiptBytes>first.budget.maxReceiptBytes)throw requestError('Memory receipt quota exceeded.','LOOPS_MEMORY_QUOTA');
    this.records.clear();for(const [id,record] of next)this.records.set(id,record);
    this.receipts.set(key,receipts);
    if(this.failAfterCommit){this.failAfterCommit=false;throw Error('reply lost after durable CAS');}
    return structuredClone(receipts);
  }
}
const schema=Type.Object({text:Type.String({minLength:1,maxLength:20})},{additionalProperties:false});
function core(repository=new Repository(),budget?:ConstructorParameters<typeof MemoryCore>[2]){
  const validator={check:(schemaId:string,schemaVersion:number,value:unknown)=>schemaId==='note'&&schemaVersion===1&&Value.Check(schema,value)};
  return {memory:new MemoryCore(repository,validator,budget),repository};
}

describe('opt-in memory core',()=>{
  it('is absent by default and denies un-authored, foreign and read-only operations',()=>{
    const {memory}=core();
    expect(()=>memory.consume(invocation({policy:undefined}),'research.note',at)).toThrow(/disabled/i);
    expect(()=>memory.write(invocation({policy:{version:1,enabled:false}}),'research.note',{text:'hi'},'mutation_one',at)).toThrow(/disabled/i);
    const written=memory.write(invocation(),'research.note',{text:'hello'},'mutation_one',at);
    expect(written.version).toBe(1);
    expect(()=>memory.consume(invocation({owner:{...owner,sessionId:'generation-two'}}),'research.note',at+1)).toThrow(/absent/i);
    expect(()=>memory.write(invocation({nodeId:'reader'}),'research.note',{text:'x'},'mutation_two',at+1)).toThrow(/not authored/i);
    expect(()=>memory.consume(invocation({nodeId:'writer'}),'private.note',at+1)).toThrow(/not authored/i);
    expect(()=>memory.write(invocation({policy:{...policy,credential:'forged'} as unknown as MemoryPolicy}),'research.note',{text:'x'},'mutation_two',at+1)).toThrow(/policy is invalid/i);
  });

  it('reads a prior run only in the same owner scope with deterministic, bounded search and provenance',()=>{
    const {memory,repository}=core();
    memory.write(invocation(),'research.alpha',{text:'A'},'mutation_a',at);
    memory.write(invocation(),'research.beta',{text:'B'},'mutation_b',at+1);
    const nextRun=invocation({runId:'run_two',nodeId:'reader'});
    const record=memory.consume(nextRun,'research.alpha',at+2);
    expect(record).toMatchObject({version:1,value:{text:'A'},provenance:{loopRevision:3,runId:'run_one',nodeId:'writer',grantGeneration:'grant_one',mutationId:'mutation_a'}});
    const page=memory.search(nextRun,'research',undefined,1,at+2);
    expect(page.items.map(item=>item.key)).toEqual(['research.alpha']);
    expect(page.nextCursor).toBe('research.alpha');
    expect(memory.search(nextRun,'research',page.nextCursor!,1,at+2).items.map(item=>item.key)).toEqual(['research.beta']);
    expect(()=>memory.search(nextRun,'research',undefined,51,at+2)).toThrow(/page/i);
    expect(memory.inspect(nextRun,'research.alpha')).not.toHaveProperty('value');
    expect(new MemoryCore(repository,{check:()=>true}).consume(nextRun,'research.alpha',at+2).value).toEqual({text:'A'});
  });

  it('enforces schema, byte limit, cancellation, current grant and compare-and-swap revisions',()=>{
    const {memory,repository}=core();
    expect(()=>memory.write(invocation(),'research.note',{text:''},'mutation_bad',at)).toThrow(/schema/i);
    expect(()=>memory.write(invocation(),'research.note',{text:'good'},'mutation_bad',at)).not.toThrow();
    expect(()=>memory.update(invocation(),'research.note',{text:'new'},0,'mutation_zero',at+1)).toThrow(/expected revision/i);
    expect(()=>memory.update(invocation(),'research.note',{text:'new'},2,'mutation_stale',at+1)).toThrow(/changed/i);
    const cancelled=new AbortController();cancelled.abort();
    expect(()=>memory.update(invocation({signal:cancelled.signal}),'research.note',{text:'new'},1,'mutation_cancelled',at+1)).toThrow(/cancelled/i);
    expect(()=>memory.update(invocation({assertAuthorized:()=>{throw requestError('Grant revoked.','LOOPS_RUN_REVOKED');}}),'research.note',{text:'new'},1,'mutation_revoked',at+1)).toThrow(/revoked/i);
    const updated=memory.update(invocation({runId:'run_two'}),'research.note',{text:'new'},1,'mutation_update',at+2);
    expect(updated.version).toBe(2);
    expect(memory.consume(invocation(),'research.note',at+3).value).toEqual({text:'new'});
    expect(repository.records.size).toBe(1);
    const small=core(new Repository(),{maxValueBytes:12,maxTotalBytes:100});
    expect(()=>small.memory.write(invocation(),'research.note',{text:'long text beyond limit'},'mutation_large',at)).toThrow(/byte limit/i);
    const paged=core(new Repository(),{maxSearchBytes:10});
    paged.memory.write(invocation(),'research.note',{text:'small'},'mutation_small',at);
    expect(()=>paged.memory.search(invocation(),'research',undefined,1,at+1)).toThrow(/byte limit/i);
    const quota=core(new Repository(),{maxKeys:1});
    quota.memory.write(invocation(),'research.one',{text:'one'},'mutation_one',at);
    expect(()=>quota.memory.write(invocation(),'research.two',{text:'two'},'mutation_two',at+1)).toThrow(/quota exceeded/i);
  });

  it('keeps explicit forget tombstones and supports receipt lookup after uncertain commit without replay',()=>{
    const {memory,repository}=core();
    memory.write(invocation(),'research.note',{text:'remember'},'mutation_create',at);
    repository.failAfterCommit=true;
    expect(()=>memory.forget(invocation(),'research.note',1,'mutation_forget',at+1)).toThrow(/uncertain outcome/i);
    expect(memory.mutation(invocation(),'mutation_forget')).toMatchObject([{version:2,deleted:true,mutationId:'mutation_forget'}]);
    expect(()=>memory.consume(invocation(),'research.note',at+2)).toThrow(/absent/i);
    expect(memory.inspect(invocation(),'research.note')).toMatchObject({version:2,deleted:true,provenance:{operation:'forget',runId:'run_one'}});
    expect(()=>memory.forget(invocation(),'research.note',1,'mutation_forget',at+2)).toThrow(/already removed|changed/i);
  });

  it('passes finite immutable receipt budgets to CAS and refuses silent pruning',()=>{
    const {memory,repository}=core(new Repository(),{maxMutations:1,maxReceiptBytes:2*1024*1024});
    memory.write(invocation(),'research.note',{text:'first'},'mutation_first',at);
    expect(()=>memory.update(invocation(),'research.note',{text:'second'},1,'mutation_second',at+1)).toThrow(/receipt quota exceeded/i);
    expect(memory.consume(invocation(),'research.note',at+2).value).toEqual({text:'first'});
    expect(memory.mutation(invocation(),'mutation_first')).toHaveLength(1);
    expect(memory.mutation(invocation(),'mutation_second')).toBeUndefined();
    expect(repository.receipts.size).toBe(1);
    const bytes=core(new Repository(),{maxReceiptBytes:32});
    expect(()=>bytes.memory.write(invocation(),'research.note',{text:'first'},'mutation_large_receipt',at)).toThrow(/receipt quota exceeded/i);
    expect(bytes.repository.records.size).toBe(0);
    expect(()=>core(new Repository(),{maxMutations:0})).toThrow(/limits are invalid/i);
  });

  it('previews and applies explicit retention/reset with transactional tombstones and stale-plan denial',()=>{
    const {memory}=core();
    memory.write(invocation(),'research.old',{text:'old'},'mutation_old',at);
    memory.write(invocation(),'research.new',{text:'new'},'mutation_new',at+1000);
    const expired=memory.removalPreview(invocation(),'research','retention',at+31*86400000);
    expect(expired.candidates).toHaveLength(2);
    const receipts=memory.applyRemoval(invocation(),expired,'mutation_retention',at+31*86400000+1);
    expect(receipts.map(item=>item.deleted)).toEqual([true,true]);
    expect(memory.mutation(invocation(),'mutation_retention')).toHaveLength(2);
    expect(memory.search(invocation(),'research',undefined,20,at+31*86400000+2).items).toEqual([]);
    memory.update(invocation(),'research.old',{text:'revived'},2,'mutation_revive',at+31*86400000+3);
    const reset=memory.removalPreview(invocation(),'research','reset',at+31*86400000+4);
    expect(reset.candidates.map(item=>item.key)).toEqual(['research.old']);
    memory.update(invocation(),'research.new',{text:'changed'},2,'mutation_change',at+31*86400000+5);
    expect(()=>memory.applyRemoval(invocation(),reset,'mutation_reset',at+31*86400000+6)).toThrow(/changed since preview/i);
    expect(memory.inspect(invocation(),'research.old').deleted).toBe(false);
  });
});

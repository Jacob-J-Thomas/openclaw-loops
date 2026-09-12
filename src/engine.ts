import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { bind, compare, display, isJson, parseDefinition, parseDefinitionContent, parseDefinitionPatch, validateGraph, validateInput, type BindingContext, type Capability, type Definition, type GraphNode, type Json } from './graph.js';
import { examples } from './examples.js';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {completionParameters,validateAdvanced,type InferenceSettings,type InferenceCapabilities} from './inference-settings.js';
import {LoopError,requestError,errorDetail,type LoopErrorData} from './errors.js';
import {resolveBudgets,legacyBudgets,type Budgets} from './budgets.js';
import {textPage} from './feature-json.js';
import {retentionCandidates,type RetentionPolicy,type RetentionResult,type RetiredAdmission} from './retention.js';

export type Actor={agentId:string;sessionKey:string;sessionId:string;source:'command'|'tool'|'session-action';requester?:string;human:boolean;canManage?:boolean;model?:string;reasoning?:string;authProfileId?:string;complete?:OpenClawPluginApi['runtime']['llm']['complete'];check:()=>void;signal?:AbortSignal};
export type Owner=Pick<Actor,'agentId'|'sessionKey'|'sessionId'>;
export type NodeEvidence={nodeId:string;kind:string;iteration?:number;state:'running'|'completed'|'waiting'|'review'|'failed'|'cancelled'|'interrupted';startedAt:string;endedAt?:string;output?:string;error?:string};
export type Run={id:string;requestKey:string;requestFingerprint:string;owner:Owner;source:Actor['source'];requester?:string;executionSettings?:Pick<Actor,'model'|'reasoning'|'authProfileId'>;cleanupPending?:boolean;parentRunId?:string;testMode?:boolean;definition:Definition;input:Record<string,Json>;state:'queued'|'running'|'completed'|'failed'|'waiting'|'review'|'cancelled'|'interrupted';cursor:string;outputs:Record<string,Json>;trace:NodeEvidence[];executions:number;activeMs:number;createdAt:string;updatedAt:string;result?:Json;error?:string;errorDetail?:LoopErrorData;pending?:string;uncertainty?:string;review?:{decision:'approve'|'reject';at:string;requester:string};};
export type LoopRecord={definition:Definition;enabledRevision:number|null;grants:Capability[];revisions?:Record<string,Definition>;publishedRevision?:number|null;revoked?:boolean;archived?:boolean;deletedAt?:string};
export type State={version:1;loops:Record<string,LoopRecord>;runs:Record<string,Run>;retiredAdmissions?:Record<string,RetiredAdmission>};
export interface Storage{read():State|undefined;write(state:State):void;close?():void}
export class FileStorage implements Storage{
  constructor(private file:string){}
  read(){return existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')) as State:undefined;}
  write(state:State){mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const temp=`${this.file}.${randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify(state),{mode:0o600,flush:true});renameSync(temp,this.file);}
}
export interface HostCapabilities{
  check(actor:Actor,capability:Capability):void;
  complete(actor:Actor,prompt:string,signal:AbortSignal,timeoutMs:number|undefined,settings?:InferenceSettings):Promise<Json>;
  capabilities?(actor:Actor,settings?:InferenceSettings):InferenceCapabilities;
  modelInfo(actor:Actor):Promise<Json>;
}
const now=()=>new Date().toISOString();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const ownerKey=(a:Owner)=>JSON.stringify([a.agentId,a.sessionKey,a.sessionId]);
const terminal=(r:Run)=>['completed','failed','cancelled','interrupted'].includes(r.state);
export class Engine{
  private cachedState!:State;
  private storageFailure?:LoopError;
  private get state(){if(this.storageFailure)throw this.storageFailure;return this.cachedState;}
  private set state(value:State){this.cachedState=value;}
  readonly budgets:Budgets;
  private queued=new Map<string,Actor>();
  private physical=new Map<string,Set<Promise<unknown>>>();
  private closing=false;
  private deadlines=new Map<string,number>();
  private active=new Map<string,{controller:AbortController;promise:Promise<Run>}>();
  constructor(private storage:Storage,private host:HostCapabilities,private options:{concurrency?:number;replyTimeoutMs?:number;onChange?:()=>void;budgets?:Partial<Budgets>}={}){
    this.budgets=resolveBudgets(options.budgets);
    this.state=storage.read()??{version:1,loops:Object.fromEntries(examples.map(d=>[d.id,{definition:{...structuredClone(d),revision:1},enabledRevision:null,grants:[]}])),runs:{}};
    if(this.state.version!==1)throw new Error('Unsupported state store version.');
    for(const record of Object.values(this.state.loops)){
      record.revisions??={[record.definition.revision]:structuredClone(record.definition)};
      record.publishedRevision??=record.enabledRevision;
    }
    for(const run of Object.values(this.state.runs)){const record=this.state.loops[run.definition.id];if(record&&!run.testMode)record.revisions![run.definition.revision]??=structuredClone(run.definition);}
    for(const r of Object.values(this.state.runs))if(r.state==='running'||r.state==='queued'){
      const uncertain=r.state!=='queued'&&(r.trace.some(t=>t.state==='running')||r.executions>0&&r.trace.length===0);
      r.state='interrupted';r.error=uncertain?'Gateway stopped during an attempt. Inspect its outcome before explicitly retrying.':'Gateway stopped at a committed checkpoint. Resume with checkpoint recovery.';
      if(uncertain)r.uncertainty='An in-flight host call may have completed; its outcome is unknown.';else delete r.uncertainty;
      delete r.cleanupPending;r.updatedAt=now();
      for(const t of r.trace)if(t.state==='running'){t.state='interrupted';t.endedAt=now();}
    }
    this.persist();
  }
  private persist(){
    if(this.storageFailure)throw this.storageFailure;
    try{this.storage.write(this.state);}catch(error){
      try{
        const committed=this.storage.read();
        if(committed){
          // Pumps hold Run references across host calls. Replacing only the
          // state map leaves them updating orphaned objects after rollback.
          for(const [id,run] of Object.entries(this.state.runs)){
            const previous=committed.runs[id];if(!previous)continue;
            for(const key of Object.keys(run))if(!Object.hasOwn(previous,key))Reflect.deleteProperty(run,key);
            Object.assign(run,previous);committed.runs[id]=run;
          }
          this.state=committed;
        }else throw new Error('The committed store is unavailable.',{cause:error});
      }catch(readError){
        this.storageFailure=new LoopError({code:'LOOPS_STORAGE_UNAVAILABLE',message:'The last storage commit could not be verified. Loops execution is stopped until the store is reopened.',phase:'storage',retryable:false,recovery:'Check storage health and restart the plugin. Inspect recovered attempts before retrying any uncertain effects.'},{cause:new AggregateError([error,readError],'Storage commit and verification failed.')});
        this.closing=true;this.queued.clear();
      }finally{for(const active of this.active.values())active.controller.abort(new Error('Storage commit failed; execution stopped.'));}
      throw this.storageFailure??error;
    }
    try{this.options.onChange?.();}catch{/* A disconnected subscriber cannot roll back a committed write. */}
  }
  private ensureHuman(actor:Actor){actor.check();if(!actor.human||actor.source==='tool')throw requestError('This operation requires an authenticated human in the Loops UI or an authorized human command.');}
  private ensureAuthor(actor:Actor){actor.check();if(actor.source!=='tool'&&!(actor.source==='session-action'&&(actor.human||actor.canManage)))throw requestError('Loop changes require an authorized agent tool or an operator with write access in the Loops UI.');}
  private own(actor:Actor,id:string){actor.check();const run=this.state.runs[id];if(!run||ownerKey(run.owner)!==ownerKey(actor))throw requestError('Run not found in this session.');return run;}
  private allowed(actor:Actor,d:Definition,record:LoopRecord|undefined){actor.check();if(!record||record.revoked)throw requestError('Loop permission revoked.');for(const c of d.capabilities){if(!record.grants.includes(c))throw requestError(`Loop permission revoked: ${c}`);this.host.check(actor,c);}}
  private allowedRun(actor:Actor,run:Run){if(run.testMode){this.ensureAuthor(actor);for(const capability of run.definition.capabilities)this.host.check(actor,capability);}else this.allowed(actor,run.definition,this.state.loops[run.definition.id]);}
  library(actor:Actor){actor.check();return Object.values(this.state.loops).filter(r=>!r.deletedAt&&!r.archived).map(r=>({id:r.definition.id,slug:r.definition.slug,name:r.definition.name,description:r.definition.description,revision:r.definition.revision,enabledRevision:r.enabledRevision,publishedRevision:r.publishedRevision??null,hasDraft:r.definition.revision!==r.publishedRevision,capabilities:r.definition.capabilities}));}
  private published(record:LoopRecord){return record.enabledRevision===null?undefined:record.revisions?.[record.enabledRevision]??(record.definition.revision===record.enabledRevision?record.definition:undefined);}
  list(actor:Actor){actor.check();return Object.values(this.state.loops).flatMap(r=>{try{const d=this.published(r);if(!d||r.deletedAt||r.archived)return [];this.allowed(actor,d,r);return [{id:d.id,slug:d.slug,name:d.name,description:d.description,revision:d.revision,inputSchema:d.inputSchema}];}catch{return [];}});}
  describe(actor:Actor,slug:string){const r=Object.values(this.state.loops).find(r=>this.published(r)?.slug===slug&&!r.deletedAt&&!r.archived);const d=r&&this.published(r);if(!r||!d)throw requestError('Enabled loop not found.');this.allowed(actor,d,r);return structuredClone(d);}
  load(actor:Actor,id:string){actor.check();const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');return structuredClone(r);}
  save(actor:Actor,value:unknown,expectedRevision:number,enabled=false){
    this.ensureAuthor(actor);return this.saveRevision(actor,value,expectedRevision,enabled);
  }
  create(actor:Actor,value:unknown,enabled=true){
    this.ensureAuthor(actor);const content=parseDefinitionContent(value,this.budgets);
    return this.saveRevision(actor,{...content,schemaVersion:2,id:`loop-${randomUUID()}`,revision:0},0,enabled);
  }
  edit(actor:Actor,id:string,expectedRevision:number,value:unknown,enabled?:boolean){
    this.ensureAuthor(actor);const previous=this.state.loops[id];if(!previous||previous.deletedAt)throw requestError('Loop not found.');
    const changes=parseDefinitionPatch(value,this.budgets);
    return this.saveRevision(actor,{...previous.definition,...changes},expectedRevision,enabled??previous.enabledRevision!==null);
  }
  delete(actor:Actor,id:string,expectedRevision:number){
    this.ensureAuthor(actor);const previous=this.state.loops[id];if(!previous||previous.deletedAt)throw requestError('Loop not found.');
    if(previous.definition.revision!==expectedRevision)throw requestError('Delete conflict: reload the current revision before deleting.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');
    if(Object.values(this.state.runs).some(r=>r.definition.id===id&&(!terminal(r)||this.active.has(r.id)||this.physical.has(r.id))))throw requestError('Cannot delete a loop with active or parked runs. Complete or cancel those runs first.');
    const deleted={id,slug:previous.definition.slug,revision:previous.definition.revision,deleted:true};
    previous.deletedAt=now();previous.enabledRevision=null;this.persist();return deleted;
  }
  private saveRevision(actor:Actor,value:unknown,expectedRevision:number,enabled:boolean,preservePublication=false){
    const d=parseDefinition(value,this.budgets);const previous=this.state.loops[d.id];
    if((previous?.definition.revision??0)!==expectedRevision||d.revision!==expectedRevision)throw requestError('Save conflict: reload the current revision before saving.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');
    if(previous?.deletedAt)throw requestError('Loop was deleted; recover it explicitly before editing.');
    if(Object.values(this.state.loops).some(r=>!r.deletedAt&&(r.definition.slug===d.slug||this.published(r)?.slug===d.slug)&&r.definition.id!==d.id))throw requestError('Another loop already uses that slug.');
    d.revision=expectedRevision+1;const issues=this.validate(actor,d).issues;
    // Validate and check the caller before committing either definition or grants.
    // A rejected publish leaves the previous revision and activation untouched.
    if(enabled)this.checkActivation(actor,d,issues);
    this.state.loops[d.id]={...previous,definition:d,revisions:{...previous?.revisions,[d.revision]:structuredClone(d)},publishedRevision:enabled?d.revision:previous?.publishedRevision??null,
      enabledRevision:enabled?d.revision:preservePublication?previous?.enabledRevision??null:null,revoked:enabled?false:previous?.revoked??false,
      grants:enabled?[...new Set([...(previous?.grants??[]),...d.capabilities])]:previous?.grants??[]};this.persist();
    return {record:structuredClone(this.state.loops[d.id]),issues};
  }
  private checkActivation(actor:Actor,d:Definition,issues=this.validate(actor,d).issues){
    parseDefinition(d,this.budgets);
    if(issues.length)throw requestError(`Cannot enable this revision: ${issues.map(i=>i.message).join(' ')} Save with enabled: false to keep a draft.`);
    for(const c of d.capabilities)this.host.check(actor,c);
  }
  enable(actor:Actor,id:string,revision:number,enabled:boolean,grants?:Capability[]){
    this.ensureAuthor(actor);const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');
    if(r.definition.revision!==revision)throw requestError('Revision changed; reload before changing activation.','LOOPS_REVISION_CONFLICT','Reload the current definition before changing activation.');
    if(enabled){this.checkActivation(actor,r.definition);if(grants&&r.definition.capabilities.some(c=>!grants.includes(c)))throw requestError('Enabling requires all declared loop capabilities.');r.grants=[...new Set([...r.grants,...r.definition.capabilities])];r.enabledRevision=revision;r.publishedRevision=revision;r.revoked=false;}else r.enabledRevision=null;
    this.persist();return structuredClone(r);
  }
  revoke(actor:Actor,id:string){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');r.enabledRevision=null;r.grants=[];r.revoked=true;this.persist();return structuredClone(r);}
  draft(actor:Actor,value:unknown,expectedRevision:number){this.ensureAuthor(actor);return this.saveRevision(actor,value,expectedRevision,false,true);}
  versions(actor:Actor,id:string){const record=this.load(actor,id);return Object.values(record.revisions??{}).sort((a,b)=>b.revision-a.revision).map(d=>({revision:d.revision,name:d.name,enabled:d.revision===record.enabledRevision,published:d.revision===record.publishedRevision,definition:d}));}
  publish(actor:Actor,id:string,revision:number,expectedRevision:number){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');if(r.definition.revision!==expectedRevision)throw requestError('Publish conflict: reload the current revision.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');const definition=r.revisions?.[revision];if(!definition)throw requestError('Revision not found.');this.checkActivation(actor,definition);r.enabledRevision=revision;r.publishedRevision=revision;r.revoked=false;r.grants=[...new Set([...r.grants,...definition.capabilities])];this.persist();return structuredClone(r);}
  restore(actor:Actor,id:string,revision:number,expectedRevision:number){this.ensureAuthor(actor);const record=this.load(actor,id);const definition=record.revisions?.[revision];if(!definition)throw requestError('Revision not found.');return this.saveRevision(actor,{...definition,revision:expectedRevision},expectedRevision,false,true);}
  archive(actor:Actor,id:string,expectedRevision:number,archived:boolean){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');if(r.definition.revision!==expectedRevision)throw requestError('Archive conflict: reload the current revision.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');r.archived=archived;if(archived)r.enabledRevision=null;this.persist();return structuredClone(r);}
  deleted(actor:Actor){this.ensureAuthor(actor);return Object.values(this.state.loops).filter(r=>r.deletedAt||r.archived).map(r=>({id:r.definition.id,slug:r.definition.slug,revision:r.definition.revision,...r.deletedAt?{deletedAt:r.deletedAt}:{},archived:r.archived??false}));}
  recover(actor:Actor,id:string,expectedRevision:number){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r)throw requestError('Loop not found.');if(r.definition.revision!==expectedRevision)throw requestError('Recovery conflict: reload the current revision.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');if(Object.values(this.state.loops).some(other=>other!==r&&!other.deletedAt&&other.definition.slug===r.definition.slug))throw requestError('Slug is already in use; restore to a new loop instead.');delete r.deletedAt;r.archived=false;r.enabledRevision=null;this.persist();return structuredClone(r);}
  output(actor:Actor,id:string,nodeId?:string,offset=0,limit=8000){const run=this.own(actor,id);const value=nodeId===undefined?run.result:run.outputs[nodeId];if(value===undefined)throw requestError('Output not found.');return {runId:id,nodeId:nodeId??null,...textPage(display(value),offset,limit),format:typeof value==='string'?'text':'json'};}
  history(actor:Actor,cursor=0,limit=100){if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>1000)throw requestError('History page requires a nonnegative cursor and limit 1–1000.');const rows=this.runs(actor);return {items:rows.slice(cursor,cursor+limit),nextCursor:cursor+limit<rows.length?cursor+limit:null,total:rows.length};}
  retention(actor:Actor,policy:RetentionPolicy,applyPlanId?:string):RetentionResult{
    this.ensureAuthor(actor);
    const all=Object.values(this.state.runs),owner=ownerKey(actor);
    const plan=retentionCandidates(all.filter(run=>ownerKey(run.owner)===owner),policy,new Set([...this.active.keys(),...this.physical.keys()]),new Set(all.flatMap(run=>run.parentRunId?[run.parentRunId]:[])));
    const planId=hash(canonical({owner,policy,candidates:plan.candidates}));
    if(applyPlanId!==undefined){
      if(applyPlanId!==planId)throw requestError('History cleanup changed since preview. Preview again before applying. No history has been deleted.','LOOPS_RETENTION_CONFLICT');
      if(plan.candidates.length){
        const retiredAt=now();this.state.retiredAdmissions??={};
        for(const {id} of plan.candidates){const run=this.state.runs[id];this.state.retiredAdmissions[run.requestKey]={runId:id,fingerprint:run.requestFingerprint,owner:run.owner,retiredAt};delete this.state.runs[id];}
        this.persist();
      }
    }
    return {planId,policy:structuredClone(policy),...plan,applied:applyPlanId!==undefined};
  }
  private rejectRetiredAdmission(key:string,fingerprint:string){
    const retired=this.state.retiredAdmissions?.[key];if(!retired)return;
    if(retired.fingerprint!==fingerprint)throw requestError('Request ID conflict: this admission belongs to deliberately removed history.');
    throw new LoopError({code:'LOOPS_HISTORY_REMOVED',message:`Run ${retired.runId} was deliberately removed from history. This request ID will not execute again.`,phase:'admission',retryable:false,recovery:'Use a new request ID only for an intentional new execution.'});
  }
  runs(actor:Actor){actor.check();return Object.values(this.state.runs).filter(r=>ownerKey(r.owner)===ownerKey(actor)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>({id:r.id,slug:r.definition.slug,revision:r.definition.revision,state:r.state,createdAt:r.createdAt,updatedAt:r.updatedAt,executions:r.executions}));}
  status(actor:Actor,id:string){const run=structuredClone(this.own(actor,id));if(terminal(run)&&(this.active.has(id)||this.physical.has(id)))run.cleanupPending=true;return run;}
  async run(actor:Actor,slug:string,input:unknown,requestId:string):Promise<Run>{
    return this.admit(actor,slug,input,requestId);
  }
  async test(actor:Actor,value:unknown,input:unknown,requestId:string){this.ensureAuthor(actor);const definition=parseDefinition(value,this.budgets);return this.admit(actor,definition.slug,input,requestId,definition);}
  private async admit(actor:Actor,slug:string,input:unknown,requestId:string,draft?:Definition):Promise<Run>{
    actor.check();if(!requestId||requestId.length>200)throw requestError('A stable request ID of at most 200 characters is required.');
    const requestKey=hash(ownerKey(actor)+':'+requestId);const fingerprint=hash(canonical({slug,input,...draft?{draft}:{}}));
    this.rejectRetiredAdmission(requestKey,fingerprint);
    const prior=Object.values(this.state.runs).find(r=>r.requestKey===requestKey);
    if(prior){if(prior.requestFingerprint!==fingerprint)throw requestError('Request ID conflict: input changed.');return this.status(actor,prior.id);}
    const definition=draft??this.describe(actor,slug);const issues=this.validate(actor,definition).issues;if(issues.length)throw requestError(issues.map(i=>i.message).join(' '));
    const checkedInput=validateInput(definition,input,this.budgets);
    const run:Run={id:randomUUID(),requestKey,requestFingerprint:fingerprint,owner:{agentId:actor.agentId,sessionKey:actor.sessionKey,sessionId:actor.sessionId},source:actor.source,...actor.requester?{requester:actor.requester}:{},definition,executionSettings:{...actor.model?{model:actor.model}:{},...actor.reasoning?{reasoning:actor.reasoning}:{},...actor.authProfileId?{authProfileId:actor.authProfileId}:{}},input:checkedInput,state:'running',cursor:definition.nodes.find(n=>n.kind==='input')!.id,outputs:{},trace:[],executions:0,activeMs:0,createdAt:now(),updatedAt:now()};
    if(draft)run.testMode=true;
    this.state.runs[run.id]=run;this.persist();return this.dispatch(actor,run);
  }
  async retry(actor:Actor,id:string,mode:'checkpoint'|'retry-node'|'restart',requestId:string){
    const previous=this.own(actor,id);if(!['failed','interrupted','cancelled'].includes(previous.state))throw requestError('Only failed, interrupted or cancelled runs can be recovered.');
    if(this.active.has(id)||this.physical.has(id))throw requestError('Wait for physical execution cleanup before recovery.');
    this.allowedRun(actor,previous);
    if(!requestId||requestId.length>200)throw requestError('Recovery requires an admission request ID of at most 200 characters.');
    const key=hash(ownerKey(actor)+':'+requestId),fingerprint=hash(canonical({parentRunId:id,mode}));this.rejectRetiredAdmission(key,fingerprint);const prior=Object.values(this.state.runs).find(r=>r.requestKey===key);
    if(prior){if(prior.requestFingerprint!==fingerprint)throw requestError('Request ID conflict.');return this.status(actor,prior.id);}
    if(mode==='checkpoint'&&(previous.uncertainty||previous.trace.some(t=>['running','interrupted','cancelled','failed'].includes(t.state))))throw requestError('The current attempt is not a committed checkpoint. Inspect its outcome, then explicitly retry the node or restart.');
    const run:Run={...structuredClone(previous),id:randomUUID(),requestKey:key,requestFingerprint:fingerprint,parentRunId:id,state:'running',createdAt:now(),updatedAt:now(),trace:[],activeMs:0,executions:0};
    delete run.error;delete run.errorDetail;delete run.uncertainty;delete run.pending;delete run.result;delete run.cleanupPending;
    if(mode==='restart'){run.outputs={};run.cursor=run.definition.nodes.find(n=>n.kind==='input')!.id;}else delete run.outputs[run.cursor];
    this.state.runs[run.id]=run;this.persist();return this.dispatch(actor,run);
  }
  async resume(actor:Actor,id:string){const r=this.own(actor,id);if(r.state!=='waiting')throw requestError(r.state==='review'?'A human review requires Approve or Reject; Continue cannot approve it.':'Only a manual Wait can be continued.');this.allowedRun(actor,r);const checkpoint=r.trace.at(-1);if(checkpoint){checkpoint.state='completed';checkpoint.endedAt=now();}r.state='running';delete r.pending;r.cursor=this.next(r,r.cursor,'next');this.persist();return this.dispatch(actor,r);}
  async review(actor:Actor,id:string,decision:'approve'|'reject'){
    this.ensureHuman(actor);const r=this.own(actor,id);if(r.state!=='review')throw requestError('Run is not awaiting human review.');this.allowedRun(actor,r);
    r.review={decision,at:now(),requester:actor.requester??'authenticated-operator'};const checkpoint=r.trace.at(-1);if(checkpoint){checkpoint.state='completed';checkpoint.endedAt=now();}r.state='running';delete r.pending;
    r.outputs[r.cursor]={decision};r.cursor=this.next(r,r.cursor,decision);this.persist();return this.dispatch(actor,r);
  }
  cancel(actor:Actor,id:string){const r=this.own(actor,id);if(terminal(r))return this.status(actor,id);r.state='cancelled';this.queued.delete(id);r.updatedAt=now();delete r.pending;if(this.active.has(id))r.uncertainty='Cancellation requested during execution; a dispatched host call may have completed.';this.active.get(id)?.controller.abort(new Error('Run cancelled.'));for(const t of r.trace)if(['running','waiting','review'].includes(t.state)){t.state='cancelled';t.endedAt=now();}this.persist();return this.status(actor,id);}
  async close(){
    this.closing=true;this.queued.clear();
    try{
      for(const [id,active] of this.active){const r=this.cachedState.runs[id];r.state='interrupted';r.error='Gateway service stopped during execution.';r.uncertainty='A dispatched host call may have completed.';active.controller.abort(new Error(r.error));}
      if(!this.storageFailure)this.persist();
    }finally{
      await Promise.allSettled([...this.active.values()].map(x=>x.promise));
      this.storage.close?.();
    }
  }
  private next(r:Run,id:string,port:string){const next=r.definition.edges.find(e=>e.source===id&&e.port===port)?.target;if(!next)throw new Error(`Missing ${port} edge from ${id}.`);return next;}
  private checkpoint(r:Run){r.updatedAt=now();this.persist();}
  private occupied(){return new Set([...this.active.keys(),...this.physical.keys()]).size;}
  private drain(){if(this.closing)return;for(const [id,actor] of this.queued){if(this.occupied()>=(this.options.concurrency??1))break;this.queued.delete(id);const run=this.state.runs[id];if(run?.state==='queued')void this.dispatch(actor,run).catch(()=>{});}}
  private trackPhysical(id:string,promise:Promise<unknown>){const pending=this.physical.get(id)??new Set();pending.add(promise);this.physical.set(id,pending);const run=this.state.runs[id];const cleanup=()=>{pending.delete(promise);if(!pending.size){this.physical.delete(id);if(run.cleanupPending){run.cleanupPending=false;if(!this.closing)this.checkpoint(run);}this.drain();}};void promise.then(cleanup,cleanup).catch(()=>{});}

  private async dispatch(actor:Actor,r:Run):Promise<Run>{
    if(this.active.has(r.id))return structuredClone(r);
    if(this.closing)throw new Error('Loops service is stopping.');
    if(this.occupied()>=(this.options.concurrency??1)){r.state='queued';this.queued.set(r.id,actor);this.checkpoint(r);return structuredClone(r);}
    r.state='running';this.checkpoint(r);
    actor={...actor,...r.executionSettings};
    const controller=new AbortController();const remaining=r.definition.limits.timeoutMs===undefined?undefined:r.definition.limits.timeoutMs-r.activeMs;
    const signal=actor.signal?AbortSignal.any([controller.signal,actor.signal]):controller.signal;
    if(remaining!==undefined)this.deadlines.set(r.id,Date.now()+remaining);
    const timeout=remaining===undefined?undefined:setTimeout(()=>controller.abort(new Error('Execution timeout exceeded.')),Math.max(0,remaining));
    const started=Date.now();const promise=this.pump(actor,r,signal).finally(()=>{clearTimeout(timeout);this.deadlines.delete(r.id);r.activeMs+=Date.now()-started;this.active.delete(r.id);if(this.physical.has(r.id))r.cleanupPending=true;this.checkpoint(r);this.drain();});
    this.active.set(r.id,{controller,promise});
    // The service keeps ownership of slow work; callers receive an inspectable
    // running handle instead of holding a chat/RPC request until the deadline.
    let replyTimer:ReturnType<typeof setTimeout>|undefined;
    const replyDeadline=new Promise<void>(resolve=>{replyTimer=setTimeout(resolve,this.options.replyTimeoutMs??10000);});
    void promise.catch(()=>{}); // A storage failure must not become an unhandled rejection after replying.
    try{await Promise.race([promise,replyDeadline]);}finally{clearTimeout(replyTimer);}
    return structuredClone(r);
  }
  private async pump(actor:Actor,r:Run,signal:AbortSignal):Promise<Run>{
    const ctx:BindingContext={input:r.input,nodes:r.outputs};
    try{while(r.state==='running'){
      signal.throwIfAborted();this.allowedRun(actor,r);
      const n=r.definition.nodes.find(n=>n.id===r.cursor);if(!n)throw new Error('Execution cursor is invalid.');
      const evidence=this.begin(r,n);let result:Json={};let port='next';
      switch(n.kind){
        case'input':result={fields:Object.keys(r.input)};break;
        case'inference':result=await this.infer(actor,r,n,ctx,signal);break;
        case'action':this.host.check(actor,n.capability);result=await this.host.modelInfo(actor);break;
        case'condition':{const passed=compare(n.predicate,ctx,r.definition.schemaVersion);result={value:passed};port=passed?'true':'false';break;}
        case'repeat':{
          let succeeded=false,last:Json={},iteration=0;
          for(iteration=1;iteration<=n.maxIterations;iteration++){
            signal.throwIfAborted();this.allowedRun(actor,r);ctx.repeat={index:iteration};
            const inference=n.body[0],condition=n.body[1];const infEvidence=this.begin(r,inference,iteration);
            last=await this.infer(actor,r,inference,ctx,signal);signal.throwIfAborted();this.finish(r,infEvidence,last);r.outputs[inference.id]=last;
            const testEvidence=this.begin(r,condition,iteration);succeeded=compare(condition.predicate,ctx,r.definition.schemaVersion);this.finish(r,testEvidence,{value:succeeded});
            if(succeeded)break;
          }
          delete ctx.repeat;result={...(last as Record<string,Json>),succeeded,iterations:Math.min(iteration,n.maxIterations),exhausted:!succeeded};break;
        }
        case'wait':this.finish(r,evidence,bind(n.message,ctx));r.state='waiting';r.pending=evidence.output;evidence.state='waiting';break;
        case'review':this.finish(r,evidence,bind(n.proposal,ctx));r.state='review';r.pending=evidence.output;evidence.state='review';break;
        case'return':r.result=bind(n.value,ctx);result=r.result;r.state='completed';break;
        case'fail':throw new Error(display(bind(n.reason,ctx)));
      }
      signal.throwIfAborted();if(terminal(r)&&r.state!=='completed')break;
      this.allowedRun(actor,r);
      if(evidence.state==='running')this.finish(r,evidence,result);else evidence.endedAt=now();
      r.outputs[n.id]=result;
      if(r.state==='running')r.cursor=this.next(r,n.id,port);
      this.checkpoint(r);
    }}catch(error){
      delete r.pending;delete r.result;
      if(r.state!=='cancelled'&&r.state!=='interrupted'){r.state='failed';r.errorDetail=errorDetail(error,{phase:'execution',nodeId:r.trace.findLast(t=>t.state==='running')?.nodeId,model:actor.model});r.error=r.errorDetail.message;}
      if(signal.aborted&&!r.uncertainty)r.uncertainty='A dispatched host call may have completed; this run will not replay it.';
      for(const t of r.trace)if(t.state==='running'){t.state=r.state==='cancelled'?'cancelled':r.state==='interrupted'?'interrupted':'failed';t.error=r.error??'Cancelled';t.endedAt=now();}
      this.checkpoint(r);
    }
    return r;
  }
  private begin(r:Run,n:{id:string;kind:string},iteration?:number){if(r.executions>=r.definition.limits.maxExecutions)throw new Error('Total node-execution budget exhausted.');r.executions++;const e:NodeEvidence={nodeId:n.id,kind:n.kind,state:'running',startedAt:now(),...iteration?{iteration}:{}};r.trace.push(e);this.checkpoint(r);return e;}
  private finish(r:Run,e:NodeEvidence,result:Json){const output=display(result);if(Buffer.byteLength(output)>r.definition.limits.maxOutputBytes)throw new Error(`Output-size limit exceeded at ${e.nodeId}.`);if(r.definition.schemaVersion===1&&r.trace.reduce((size,t)=>size+Buffer.byteLength(t.output??''),0)+Buffer.byteLength(output)>48000)throw new Error('Run evidence output budget exceeded.');e.output=output;e.state='completed';e.endedAt=now();}
  private async infer(actor:Actor,r:Run,n:Extract<GraphNode,{kind:'inference'}>,ctx:BindingContext,signal:AbortSignal):Promise<Json>{
    this.allowedRun(actor,r);this.host.check(actor,'llm');
    const prompt=display(bind(n.prompt,ctx));if(Buffer.byteLength(prompt)>(r.definition.schemaVersion===1?legacyBudgets.promptBytes:this.budgets.promptBytes))throw new Error('Rendered prompt exceeds the transport budget.');
    const issues=validateAdvanced(n.advanced,this.capabilities(actor,n).parameters);if(issues.length)throw new Error(issues.join(' '));
    const settings:InferenceSettings={...n.model?{model:n.model}:{},...n.agentId?{agentId:n.agentId}:{},...n.reasoning?{reasoning:n.reasoning}:{},...n.advanced?{advanced:n.advanced}:{}};
    const deadline=this.deadlines.get(r.id);
    const remaining=deadline===undefined?undefined:deadline-Date.now();
    if(remaining!==undefined&&remaining<=0)throw new Error('Execution timeout exceeded.');
    const completion=this.host.complete(actor,prompt,signal,remaining,settings);
    this.trackPhysical(r.id,completion);
    let stop:()=>void=()=>{};
    const aborted=new Promise<never>((_,reject)=>{const abort=()=>reject(signal.reason??new Error('Aborted'));stop=()=>signal.removeEventListener('abort',abort);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
    const response=await Promise.race([completion,aborted]).finally(stop) as Record<string,Json>;
    if(typeof response.text!=='string')throw new Error('Host completion returned no text.');
    if(n.output==='json'){
      const value:unknown=JSON.parse(response.text);if(r.definition.schemaVersion===1&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>16||Object.values(value).some(v=>v!==null&&!['string','boolean','number'].includes(typeof v))))throw new Error('Structured output must be a flat JSON object with at most 16 scalar fields.');
      if(!isJson(value))throw new Error('Structured output must contain valid JSON without unsafe keys or excessive nesting.');
      response.value=value;
    }
    return response;
  }
  capabilities(actor:Actor,settings:InferenceSettings={}){actor.check();const inference=this.host.capabilities?.(actor,settings)??{...(settings.model??actor.model)?{model:settings.model??actor.model}:{},configured:'unknown' as const,authorized:'unknown' as const,available:'unknown' as const,parameters:completionParameters(),notes:[]};return {...inference,budgets:{...this.budgets},concurrency:this.options.concurrency??1};}
  validate(actor:Actor,value:unknown){actor.check();const definition=parseDefinition(value,this.budgets);const issues=validateGraph(definition);for(const node of definition.nodes.flatMap(n=>n.kind==='repeat'?[...n.body]:[n]))if(node.kind==='inference')for(const message of validateAdvanced(node.advanced,this.capabilities(actor,node).parameters))issues.push({nodeId:node.id,message});return {valid:issues.length===0,issues};}
}

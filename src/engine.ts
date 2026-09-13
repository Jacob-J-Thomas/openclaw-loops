import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { bind, compare, display, isJson, parseDefinition, parseDefinitionContent, parseDefinitionPatch, validateGraph, validateInput, type BindingContext, type Capability, type Definition, type GraphNode, type Json } from './graph.js';
import { examples } from './examples.js';
import {nodeContract,childNodes,type NodeExecutionContext} from './node-contracts.js';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {completionParameters,validateAdvanced,type InferenceSettings,type InferenceCapabilities} from './inference-settings.js';
import {LoopError,requestError,executionError,errorDetail,type LoopErrorData} from './errors.js';
import {resolveBudgets,legacyBudgets,type Budgets} from './budgets.js';
import {textPage} from './feature-json.js';
import {retentionCandidates,type RetentionPolicy,type RetentionResult,type RetiredAdmission} from './retention.js';
import {DocumentStore} from './document-store.js';
import {type DocumentLinks, type MaintenancePolicy, type TransportRelease, emptyDocumentLinks} from './document-maintenance.js';
import {fingerprintJson} from './fingerprint.js';

export type Actor={agentId:string;sessionKey:string;sessionId:string;source:'command'|'tool'|'session-action';requester?:string;human:boolean;canManage?:boolean;model?:string;reasoning?:string;authProfileId?:string;complete?:OpenClawPluginApi['runtime']['llm']['complete'];check:()=>void;signal?:AbortSignal};
export type Owner=Pick<Actor,'agentId'|'sessionKey'|'sessionId'>;
export type NodeEvidence={nodeId:string;kind:string;iteration?:number;state:'running'|'completed'|'waiting'|'review'|'failed'|'cancelled'|'interrupted';startedAt:string;endedAt?:string;output?:string;error?:string};
export type Run={id:string;requestKey:string;requestFingerprint:string;requestFingerprintVersion?:2;owner:Owner;source:Actor['source'];requester?:string;executionSettings?:Pick<Actor,'model'|'reasoning'|'authProfileId'>;cleanupPending?:boolean;parentRunId?:string;testMode?:boolean;grantGeneration?:string;definition:Definition;input:Record<string,Json>;state:'queued'|'running'|'completed'|'failed'|'waiting'|'review'|'cancelled'|'interrupted';cursor:string;outputs:Record<string,Json>;trace:NodeEvidence[];executions:number;activeMs:number;createdAt:string;updatedAt:string;result?:Json;error?:string;errorDetail?:LoopErrorData;pending?:string;uncertainty?:string;review?:{decision:'approve'|'reject';at:string;requester:string};};
export type LoopRecord={definition:Definition;enabledRevision:number|null;grants:Capability[];grantGeneration?:string;revisions?:Record<string,Definition>;publishedRevision?:number|null;revoked?:boolean;archived?:boolean;deletedAt?:string};
const legacyGrantGeneration='legacy';
export type LibraryQuery={view?:'active'|'runnable'|'recoverable';search?:string;cursor?:string;limit?:number};
export type State={version:1;loops:Record<string,LoopRecord>;runs:Record<string,Run>;retiredAdmissions?:Record<string,RetiredAdmission>};
export type RunSummary=Pick<Run,'id'|'state'|'createdAt'|'updatedAt'|'executions'>&{slug:string;revision:number};
export type RunMetadata=Pick<Run,'id'|'owner'|'requestKey'|'requestFingerprint'|'requestFingerprintVersion'|'state'|'createdAt'|'updatedAt'|'parentRunId'|'cleanupPending'>;
// Indexed stores keep historical outputs on disk. The working state is an
// explicitly partial run set; merging it must never delete omitted history.
export interface IndexedRunStorage{
  readWorkingState():State|undefined;
  writeWorkingState(state:State):void;
  writeRun(run:Run):void;
  readRun(id:string,ownerKey:string):Run|undefined;
  findAdmission(key:string):{id:string;fingerprint:string}|undefined;
  readRetiredAdmission(key:string):RetiredAdmission|undefined;
  runMetadata():RunMetadata[];
  history(ownerKey:string,cursor:number,limit:number):{items:RunSummary[];nextCursor:number|null;total:number};
  runSummaries(ownerKey:string):RunSummary[];
  hasOpenRuns(loopId:string):boolean;
}
export interface Storage{read():State|undefined;write(state:State):void;writeRun?(run:Run):void;readonly indexed?:IndexedRunStorage;close?():void|Promise<void>}
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
const retainedFingerprint=(run:Run)=>run.parentRunId?undefined:fingerprintJson({slug:run.definition.slug,input:run.input,...run.testMode?{draft:run.definition}:{}});
const terminal=(r:Run)=>['completed','failed','cancelled','interrupted'].includes(r.state);
export class Engine{
  private documents?:DocumentStore;
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
  constructor(private storage:Storage,private host:HostCapabilities,private options:{concurrency?:number;replyTimeoutMs?:number;onChange?:()=>void;budgets?:Partial<Budgets>;documentDirectory?:string;retainActor?:(actor:Actor)=>void;releaseActor?:(actor:Actor)=>void}={}){
    this.budgets=resolveBudgets(options.budgets);
    this.state=(storage.indexed?storage.indexed.readWorkingState():storage.read())??{version:1,loops:Object.fromEntries(examples.map(d=>[d.id,{definition:{...structuredClone(d),revision:1},enabledRevision:null,grants:[]}])),runs:{}};
    if(this.state.version!==1)throw new Error('Unsupported state store version.');
    for(const record of Object.values(this.state.loops)){
      record.revisions??={[record.definition.revision]:structuredClone(record.definition)};
      record.publishedRevision??=record.enabledRevision;
      // Older runs have an implicit legacy grant. A currently revoked legacy
      // loop must not regain those grants when its publication is re-enabled.
      record.grantGeneration??=record.revoked?randomUUID():legacyGrantGeneration;
    }
    for(const run of Object.values(this.state.runs)){const record=this.state.loops[run.definition.id];if(record&&!run.testMode)record.revisions![run.definition.revision]??=structuredClone(run.definition);}
    for(const r of Object.values(this.state.runs)){
      const settling=r.cleanupPending===true;
      if(settling){
        // This flag describes promises owned by the old process, not a durable
        // host receipt. A restarted worker cannot keep waiting on those promises.
        delete r.cleanupPending;r.updatedAt=now();
        r.uncertainty??='Gateway stopped before physical cleanup was confirmed. The external outcome is unknown; inspect it before explicit recovery.';
      }
      if(r.state==='running'||r.state==='queued'){
        const uncertain=settling||r.state!=='queued'&&(r.trace.some(t=>t.state==='running')||r.executions>0&&r.trace.length===0);
        r.state='interrupted';r.error=uncertain?'Gateway stopped during an attempt. Inspect its outcome before explicitly retrying.':'Gateway stopped at a committed checkpoint. Resume with checkpoint recovery.';
        if(uncertain)r.uncertainty='An in-flight host call may have completed; its outcome is unknown.';else delete r.uncertainty;
        r.updatedAt=now();
        for(const t of r.trace)if(t.state==='running'){t.state='interrupted';t.endedAt=now();}
      }
    }
    this.persist();
  }
  private persist(run?:Run){
    if(this.storageFailure)throw this.storageFailure;
    try{
      if(run&&this.storage.indexed)this.storage.indexed.writeRun(run);
      else if(run&&this.storage.writeRun)this.storage.writeRun(run);
      else if(this.storage.indexed)this.storage.indexed.writeWorkingState(this.state);
      else this.storage.write(this.state);
    }catch(error){
      try{
        const committed=this.storage.indexed?this.storage.indexed.readWorkingState():this.storage.read();
        if(committed){
          // Pumps hold Run references across host calls. Replacing only the
          // state map leaves them updating orphaned objects after rollback.
          for(const [id,run] of Object.entries(this.state.runs)){
            const previous=committed.runs[id]??this.storage.indexed?.readRun(id,ownerKey(run.owner));if(!previous)continue;
            for(const key of Object.keys(run))if(!Object.hasOwn(previous,key))Reflect.deleteProperty(run,key);
            Object.assign(run,previous);committed.runs[id]=run;
          }
          this.state=committed;
        }else throw new Error('The committed store is unavailable.',{cause:error});
      }catch(readError){
        this.storageFailure=new LoopError({code:'LOOPS_STORAGE_UNAVAILABLE',message:'The last storage commit could not be verified. Loops execution is stopped until the store is reopened.',phase:'storage',retryable:false,recovery:'Check storage health and restart the plugin. Inspect recovered attempts before retrying any uncertain effects.'},{cause:new AggregateError([error,readError],'Storage commit and verification failed.')});
        this.closing=true;this.clearQueued();
      }finally{for(const active of this.active.values())active.controller.abort(new Error('Storage commit failed; execution stopped.'));}
      throw this.storageFailure??error;
    }
    if(this.storage.indexed){
      if(run)this.state.runs[run.id]=run;
      // A pump or physical cleanup can still hold a completed Run reference.
      // Release it only once no live execution owns it; parked runs reload on use.
      for(const [id,saved] of Object.entries(this.state.runs))if(!this.active.has(id)&&!this.physical.has(id)&&!this.queued.has(id)&&!['running','queued'].includes(saved.state))delete this.state.runs[id];
      delete this.state.retiredAdmissions;
    }
    try{this.options.onChange?.();}catch{/* A disconnected subscriber cannot roll back a committed write. */}
  }
  private ensureHuman(actor:Actor){actor.check();if(!actor.human||actor.source==='tool')throw requestError('This operation requires an authenticated human in the Loops UI or an authorized human command.');}
  private documentStore(actor:Actor){
    actor.check();
    if(!this.options.documentDirectory)throw requestError('Loops document storage is unavailable.','LOOPS_SERVICE_UNAVAILABLE');
    return this.documents??=new DocumentStore(this.options.documentDirectory,Math.max(this.budgets.definitionBytes,this.budgets.inputBytes)*2);
  }
  documentWrap(actor:Actor,value:unknown,links:DocumentLinks={...emptyDocumentLinks(),unknown:true}){return this.documentStore(actor).wrap(actor,value,links);}
  documentSnapshot(actor:Actor,value:unknown,links:DocumentLinks={...emptyDocumentLinks(),unknown:true}){return this.documentStore(actor).snapshot(actor,value,links);}
  documentRead(actor:Actor,id:string,offset?:number,limit?:number,readerId?:string){return this.documentStore(actor).read(actor,id,offset,limit,readerId);}
  documentAcquire(actor:Actor,id:string){return this.documentStore(actor).acquire(actor,id);}
  documentRelease(actor:Actor,id:string,readerId:string){return this.documentStore(actor).release(actor,{kind:'reader',documentId:id,readerId});}
  documentUse(actor:Actor,reference:Parameters<DocumentStore['use']>[1]){return this.documentStore(actor).use(actor,reference);}
  documentFinishUse(actor:Actor,id:string,readerId:string|undefined,links:DocumentLinks){return this.documentStore(actor).finishUse(actor,id,readerId,links);}
  maintenance(actor:Actor,policy:MaintenancePolicy,applyPlanId?:string){
    this.ensureAuthor(actor);
    const runs=this.storage.indexed?.runMetadata()??Object.values(this.state.runs);
    return this.documentStore(actor).maintenance(actor,policy,{runs:new Set(runs.map(run=>run.id)),loops:new Set(Object.keys(this.state.loops))},applyPlanId);
  }
  transportRelease(actor:Actor,input:TransportRelease){this.ensureAuthor(actor);return this.documentStore(actor).release(actor,input);}
  documentUpload(actor:Actor,input:Parameters<DocumentStore['upload']>[1]){return this.documentStore(actor).upload(actor,input);}
  documentResolve(actor:Actor,reference:Parameters<DocumentStore['resolve']>[1]){return this.documentStore(actor).resolve(actor,reference);}
  private ensureAuthor(actor:Actor){actor.check();if(actor.source!=='tool'&&!((actor.source==='session-action'||actor.source==='command')&&(actor.human||actor.canManage)))throw requestError('Loop changes require an authorized agent tool or an operator with write access through the Loops UI or a command.');}
  private own(actor:Actor,id:string){
    actor.check();const run=this.state.runs[id]??this.storage.indexed?.readRun(id,ownerKey(actor));if(!run||ownerKey(run.owner)!==ownerKey(actor))throw requestError('Run not found in this session.');
    // Older full restarts copied a parent's decision into a fresh pending review.
    // Repair cold records on authorized access without scanning historical outputs.
    // Earlier review nodes can legitimately have decisions in a multi-review run.
    if(run.state==='review'&&run.review&&!run.definition.nodes.some(node=>{
      const output=run.outputs[node.id];return node.kind==='review'&&output&&typeof output==='object'&&!Array.isArray(output)&&(output.decision==='approve'||output.decision==='reject');
    })){
      delete run.review;this.persist(run);
    }
    return run;
  }
  private allowed(actor:Actor,d:Definition,record:LoopRecord|undefined){actor.check();if(!record||record.revoked)throw requestError('Loop permission revoked.');for(const c of d.capabilities){if(!record.grants.includes(c))throw requestError(`Loop permission revoked: ${c}`);this.host.check(actor,c);}}
  private allowedRun(actor:Actor,run:Run){
    if(run.testMode){this.ensureAuthor(actor);for(const capability of run.definition.capabilities)this.host.check(actor,capability);}
    else{
      const record=this.state.loops[run.definition.id];this.allowed(actor,run.definition,record);
      if((run.grantGeneration??legacyGrantGeneration)!==(record.grantGeneration??legacyGrantGeneration))throw requestError('This run\'s loop grant was revoked. Re-enabling the loop authorizes new admissions.','LOOPS_RUN_REVOKED','Cancel a parked run, then explicitly retry or restart it under current loop and host permissions, or start a new run. The original admission remains revoked.');
    }
  }
  library(actor:Actor){actor.check();return Object.values(this.state.loops).filter(r=>!r.deletedAt&&!r.archived).map(r=>({id:r.definition.id,slug:r.definition.slug,name:r.definition.name,description:r.definition.description,revision:r.definition.revision,enabledRevision:r.enabledRevision,publishedRevision:r.publishedRevision??null,hasDraft:r.definition.revision!==r.publishedRevision,capabilities:r.definition.capabilities}));}
  browse(actor:Actor,query:LibraryQuery={}){
    actor.check();const {view='active',search='',limit=50,cursor}=query;
    if(!['active','runnable','recoverable'].includes(view)||typeof search!=='string'||search.length>500||!Number.isSafeInteger(limit)||limit<1||limit>1000||cursor!==undefined&&(typeof cursor!=='string'||cursor.length<1||cursor.length>512))throw requestError('Library browsing requires a valid view, search up to 500 characters, limit 1–1000, and an opaque cursor from the previous page.');
    if(view==='recoverable')this.ensureAuthor(actor);
    const term=search.trim().toLowerCase();
    const rows=Object.values(this.state.loops).flatMap(record=>{
      const hidden=Boolean(record.deletedAt||record.archived);
      if(view==='recoverable'?!hidden:hidden)return [];
      const definition=view==='runnable'?this.published(record):record.definition;if(!definition)return [];
      if(view==='runnable'){try{this.allowed(actor,definition,record);}catch{return [];}}
      if(term&&!`${definition.name} ${definition.slug} ${definition.description}`.toLowerCase().includes(term))return [];
      return [{record,definition}];
    }).sort((a,b)=>a.definition.id<b.definition.id?-1:a.definition.id>b.definition.id?1:0);
    actor.check();
    const version=hash(canonical({owner:ownerKey(actor),view,term,rows:rows.map(({record,definition})=>[definition.id,definition.revision,record.definition.revision,record.enabledRevision,record.publishedRevision??null,record.archived??false,record.deletedAt??null])}));
    let offset=0;
    if(cursor!==undefined){
      let saved:unknown;try{saved=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{throw requestError('Invalid library cursor. Start browsing from the first page.');}
      if(!saved||typeof saved!=='object'||!('offset' in saved)||typeof saved.offset!=='number'||!Number.isSafeInteger(saved.offset)||saved.offset<0||!('version' in saved)||typeof saved.version!=='string')throw requestError('Invalid library cursor. Start browsing from the first page.');
      if(saved.version!==version)throw requestError('Library changed since this page was read. Start browsing from the first page.','LOOPS_LIBRARY_CHANGED','Omit cursor and keep the same search and view to refresh the library. No definitions or running work were changed.');
      offset=saved.offset;if(offset>rows.length)throw requestError('Invalid library cursor offset. Start browsing from the first page.');
    }
    const items=rows.slice(offset,offset+limit).map(({record:r,definition:d})=>({id:d.id,slug:d.slug,name:d.name,description:d.description,revision:d.revision,enabledRevision:r.enabledRevision,publishedRevision:r.publishedRevision??null,hasDraft:r.definition.revision!==r.publishedRevision,capabilities:[...d.capabilities],archived:r.archived??false,...r.deletedAt?{deletedAt:r.deletedAt}:{}}));
    const nextCursor=offset+limit<rows.length?Buffer.from(JSON.stringify({version,offset:offset+limit})).toString('base64url'):null;
    return {items,nextCursor,total:rows.length,offset};
  }
  private published(record:LoopRecord){return record.enabledRevision===null?undefined:record.revisions?.[record.enabledRevision]??(record.definition.revision===record.enabledRevision?record.definition:undefined);}
  private assertSlugAvailable(id:string,slug:string){
    if(Object.values(this.state.loops).some(record=>record.definition.id!==id&&!record.deletedAt&&(record.definition.slug===slug||this.published(record)?.slug===slug)))throw requestError('Another loop already uses that slug.','LOOPS_SLUG_CONFLICT','Resolve the other loop\'s current draft or enabled publication using this slug, then explicitly retry. No saved state was changed.');
  }
  list(actor:Actor){actor.check();return Object.values(this.state.loops).flatMap(r=>{try{const d=this.published(r);if(!d||r.deletedAt||r.archived)return [];this.allowed(actor,d,r);return [{id:d.id,slug:d.slug,name:d.name,description:d.description,revision:d.revision,inputSchema:d.inputSchema}];}catch{return [];}});}
  describe(actor:Actor,slug:string){
    actor.check();const matches=Object.values(this.state.loops).filter(record=>this.published(record)?.slug===slug&&!record.deletedAt&&!record.archived);
    if(matches.length>1)throw requestError('More than one enabled loop uses this slug; invocation is ambiguous.','LOOPS_AMBIGUOUS_SLUG','Inspect the conflicting loops by ID and explicitly disable or republish one with a different slug. Existing pinned runs remain inspectable and controllable by their run IDs.');
    const r=matches[0],d=r&&this.published(r);if(!r||!d)throw requestError('Enabled loop not found.');this.allowed(actor,d,r);return structuredClone(d);
  }
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
    if(this.storage.indexed?.hasOpenRuns(id)||Object.values(this.state.runs).some(r=>r.definition.id===id&&(!terminal(r)||this.active.has(r.id)||this.physical.has(r.id))))throw requestError('Cannot delete a loop with active or parked runs. Complete or cancel those runs first.');
    const deleted={id,slug:previous.definition.slug,revision:previous.definition.revision,deleted:true};
    previous.deletedAt=now();previous.enabledRevision=null;this.persist();return deleted;
  }
  private saveRevision(actor:Actor,value:unknown,expectedRevision:number,enabled:boolean,preservePublication=false){
    const d=parseDefinition(value,this.budgets);const previous=this.state.loops[d.id];
    if((previous?.definition.revision??0)!==expectedRevision||d.revision!==expectedRevision)throw requestError('Save conflict: reload the current revision before saving.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');
    if(previous?.deletedAt)throw requestError('Loop was deleted; recover it explicitly before editing.');
    this.assertSlugAvailable(d.id,d.slug);
    d.revision=expectedRevision+1;const issues=this.validate(actor,d).issues;
    // Validate and check the caller before committing either definition or grants.
    // A rejected publish leaves the previous revision and activation untouched.
    if(enabled)this.checkActivation(actor,d,issues);
    this.state.loops[d.id]={...previous,definition:d,grantGeneration:previous?.grantGeneration??randomUUID(),revisions:{...previous?.revisions,[d.revision]:structuredClone(d)},publishedRevision:enabled?d.revision:previous?.publishedRevision??null,
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
    if(enabled){this.assertSlugAvailable(id,r.definition.slug);this.checkActivation(actor,r.definition);if(grants&&r.definition.capabilities.some(c=>!grants.includes(c)))throw requestError('Enabling requires all declared loop capabilities.');r.grants=[...new Set([...r.grants,...r.definition.capabilities])];r.enabledRevision=revision;r.publishedRevision=revision;r.revoked=false;}else r.enabledRevision=null;
    this.persist();return structuredClone(r);
  }
  revoke(actor:Actor,id:string){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');r.enabledRevision=null;r.grants=[];r.revoked=true;r.grantGeneration=randomUUID();this.persist();return structuredClone(r);}
  draft(actor:Actor,value:unknown,expectedRevision:number){this.ensureAuthor(actor);return this.saveRevision(actor,value,expectedRevision,false,true);}
  versions(actor:Actor,id:string){const record=this.load(actor,id);return Object.values(record.revisions??{}).sort((a,b)=>b.revision-a.revision).map(d=>({revision:d.revision,name:d.name,enabled:d.revision===record.enabledRevision,published:d.revision===record.publishedRevision,definition:d}));}
  publish(actor:Actor,id:string,revision:number,expectedRevision:number){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');if(r.definition.revision!==expectedRevision)throw requestError('Publish conflict: reload the current revision.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');const definition=r.revisions?.[revision];if(!definition)throw requestError('Revision not found.');this.assertSlugAvailable(id,definition.slug);this.checkActivation(actor,definition);r.enabledRevision=revision;r.publishedRevision=revision;r.revoked=false;r.grants=[...new Set([...r.grants,...definition.capabilities])];this.persist();return structuredClone(r);}
  restore(actor:Actor,id:string,revision:number,expectedRevision:number){this.ensureAuthor(actor);const record=this.load(actor,id);const definition=record.revisions?.[revision];if(!definition)throw requestError('Revision not found.');return this.saveRevision(actor,{...definition,revision:expectedRevision},expectedRevision,false,true);}
  archive(actor:Actor,id:string,expectedRevision:number,archived:boolean){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r||r.deletedAt)throw requestError('Loop not found.');if(r.definition.revision!==expectedRevision)throw requestError('Archive conflict: reload the current revision.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');r.archived=archived;if(archived)r.enabledRevision=null;this.persist();return structuredClone(r);}
  deleted(actor:Actor){this.ensureAuthor(actor);return Object.values(this.state.loops).filter(r=>r.deletedAt||r.archived).map(r=>({id:r.definition.id,slug:r.definition.slug,revision:r.definition.revision,...r.deletedAt?{deletedAt:r.deletedAt}:{},archived:r.archived??false}));}
  recover(actor:Actor,id:string,expectedRevision:number){this.ensureAuthor(actor);const r=this.state.loops[id];if(!r)throw requestError('Loop not found.');if(r.definition.revision!==expectedRevision)throw requestError('Recovery conflict: reload the current revision.','LOOPS_REVISION_CONFLICT','Reload the current definition, then merge or retry against its current revision.');this.assertSlugAvailable(id,r.definition.slug);delete r.deletedAt;r.archived=false;r.enabledRevision=null;this.persist();return structuredClone(r);}
  output(actor:Actor,id:string,nodeId?:string,offset=0,limit=8000){const run=this.own(actor,id);const value=nodeId===undefined?run.result:run.outputs[nodeId];if(value===undefined)throw requestError('Output not found.');return {runId:id,nodeId:nodeId??null,...textPage(display(value),offset,limit),format:typeof value==='string'?'text':'json'};}
  history(actor:Actor,cursor=0,limit=100){actor.check();if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>1000)throw requestError('History page requires a nonnegative cursor and limit 1–1000.');if(this.storage.indexed)return this.storage.indexed.history(ownerKey(actor),cursor,limit);const rows=this.runs(actor);return {items:rows.slice(cursor,cursor+limit),nextCursor:cursor+limit<rows.length?cursor+limit:null,total:rows.length};}
  retention(actor:Actor,policy:RetentionPolicy,applyPlanId?:string):RetentionResult{
    this.ensureAuthor(actor);
    const all=this.storage.indexed?.runMetadata()??Object.values(this.state.runs),owner=ownerKey(actor);
    const plan=retentionCandidates(all.filter(run=>ownerKey(run.owner)===owner),policy,new Set([...this.active.keys(),...this.physical.keys()]),new Set(all.flatMap(run=>run.parentRunId?[run.parentRunId]:[])));
    const planId=hash(canonical({owner,policy,candidates:plan.candidates}));
    if(applyPlanId!==undefined){
      if(applyPlanId!==planId)throw requestError('History cleanup changed since preview. Preview again before applying. No history has been deleted.','LOOPS_RETENTION_CONFLICT');
      if(plan.candidates.length){
        const retiredAt=now();
        const byId=new Map(all.map(run=>[run.id,run]));
        // Resolve legacy comparison evidence before changing working memory.
        // A failed cold read must leave both history and tombstones untouched.
        const retired=plan.candidates.map(({id})=>{
          const run=byId.get(id)!,canonicalFingerprint=run.requestFingerprintVersion===undefined&&!run.parentRunId?retainedFingerprint(this.own(actor,id)):undefined;
          return {key:run.requestKey,record:{runId:id,fingerprint:run.requestFingerprint,owner:run.owner,retiredAt,...run.requestFingerprintVersion?{fingerprintVersion:run.requestFingerprintVersion}:{},...canonicalFingerprint?{canonicalFingerprint}:{}}};
        });
        this.state.retiredAdmissions??={};
        for(const {key,record} of retired){this.state.retiredAdmissions[key]=record;delete this.state.runs[record.runId];}
        this.persist();
      }
    }
    return {planId,policy:structuredClone(policy),...plan,applied:applyPlanId!==undefined};
  }
  private rejectRetiredAdmission(key:string,value:unknown,fingerprint:string){
    const retired=this.state.retiredAdmissions?.[key]??this.storage.indexed?.readRetiredAdmission(key);if(!retired)return;
    if(retired.fingerprint!==fingerprint&&retired.canonicalFingerprint!==fingerprint&&retired.fingerprint!==fingerprintJson(value,1))throw requestError('Request ID conflict: this admission belongs to deliberately removed history.');
    throw new LoopError({code:'LOOPS_HISTORY_REMOVED',message:`Run ${retired.runId} was deliberately removed from history. This request ID will not execute again.`,phase:'admission',retryable:false,recovery:'Use a new request ID only for an intentional new execution.'});
  }
  runs(actor:Actor){actor.check();if(this.storage.indexed)return this.storage.indexed.runSummaries(ownerKey(actor));return Object.values(this.state.runs).filter(r=>ownerKey(r.owner)===ownerKey(actor)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).map(r=>({id:r.id,slug:r.definition.slug,revision:r.definition.revision,state:r.state,createdAt:r.createdAt,updatedAt:r.updatedAt,executions:r.executions}));}
  status(actor:Actor,id:string){const run=structuredClone(this.own(actor,id));if(terminal(run)&&(this.active.has(id)||this.physical.has(id)))run.cleanupPending=true;return run;}
  async run(actor:Actor,slug:string,input:unknown,requestId:string):Promise<Run>{
    return this.admit(actor,slug,input,requestId);
  }
  async test(actor:Actor,value:unknown,input:unknown,requestId:string){this.ensureAuthor(actor);const definition=parseDefinition(value,this.budgets);return this.admit(actor,definition.slug,input,requestId,definition);}
  private async admit(actor:Actor,slug:string,input:unknown,requestId:string,draft?:Definition):Promise<Run>{
    actor.check();if(!requestId||requestId.length>200)throw requestError('A stable request ID of at most 200 characters is required.');
    const requestKey=hash(ownerKey(actor)+':'+requestId),value={slug,input,...draft?{draft}:{}},fingerprint=fingerprintJson(value);
    this.rejectRetiredAdmission(requestKey,value,fingerprint);
    const prior=this.admission(requestKey);
    if(prior){
      const run=this.status(actor,prior.id);
      if(prior.fingerprint!==fingerprint&&prior.fingerprint!==fingerprintJson(value,1)&&
        (run.requestFingerprintVersion!==undefined||retainedFingerprint(run)!==fingerprint))throw requestError('Request ID conflict: input changed.');
      return run;
    }
    const definition=draft??this.describe(actor,slug);const issues=this.validate(actor,definition).issues;if(issues.length)throw requestError(issues.map(i=>i.message).join(' '));
    const checkedInput=validateInput(definition,input,this.budgets);
    const run:Run={id:randomUUID(),requestKey,requestFingerprint:fingerprint,requestFingerprintVersion:2,owner:{agentId:actor.agentId,sessionKey:actor.sessionKey,sessionId:actor.sessionId},source:actor.source,...actor.requester?{requester:actor.requester}:{},definition,executionSettings:{...actor.model?{model:actor.model}:{},...actor.reasoning?{reasoning:actor.reasoning}:{},...actor.authProfileId?{authProfileId:actor.authProfileId}:{}},input:checkedInput,state:'running',cursor:definition.nodes.find(n=>n.kind==='input')!.id,outputs:{},trace:[],executions:0,activeMs:0,createdAt:now(),updatedAt:now()};
    if(draft)run.testMode=true;else run.grantGeneration=this.state.loops[definition.id].grantGeneration??legacyGrantGeneration;
    this.state.runs[run.id]=run;this.persist(run);return this.dispatch(actor,run);
  }
  async retry(actor:Actor,id:string,mode:'checkpoint'|'retry-node'|'restart',requestId:string){
    const previous=this.own(actor,id);if(!['failed','interrupted','cancelled'].includes(previous.state))throw requestError('Only failed, interrupted or cancelled runs can be recovered.');
    if(this.active.has(id)||this.physical.has(id))throw requestError('Wait for physical execution cleanup before recovery.');
    // Recovery is an explicit new admission. Recheck current grants and host
    // authority without reviving the original run's revoked generation.
    if(previous.testMode)this.allowedRun(actor,previous);else this.allowed(actor,previous.definition,this.state.loops[previous.definition.id]);
    if(!requestId||requestId.length>200)throw requestError('Recovery requires an admission request ID of at most 200 characters.');
    const key=hash(ownerKey(actor)+':'+requestId),value={parentRunId:id,mode},fingerprint=fingerprintJson(value);this.rejectRetiredAdmission(key,value,fingerprint);const prior=this.admission(key);
    if(prior){if(prior.fingerprint!==fingerprint&&prior.fingerprint!==fingerprintJson(value,1))throw requestError('Request ID conflict.');return this.status(actor,prior.id);}
    if(mode==='checkpoint'&&(previous.uncertainty||previous.trace.some(t=>['running','interrupted','cancelled','failed'].includes(t.state))))throw requestError('The current attempt is not a committed checkpoint. Inspect its outcome, then explicitly retry the node or restart.');
    const run:Run={...structuredClone(previous),id:randomUUID(),requestKey:key,requestFingerprint:fingerprint,requestFingerprintVersion:2,parentRunId:id,state:'running',createdAt:now(),updatedAt:now(),trace:[],activeMs:0,executions:0};
    if(!run.testMode)run.grantGeneration=this.state.loops[run.definition.id].grantGeneration??legacyGrantGeneration;
    delete run.error;delete run.errorDetail;delete run.uncertainty;delete run.pending;delete run.result;delete run.cleanupPending;
    if(mode==='restart'){run.outputs={};delete run.review;run.cursor=run.definition.nodes.find(n=>n.kind==='input')!.id;}else delete run.outputs[run.cursor];
    this.state.runs[run.id]=run;this.persist(run);return this.dispatch(actor,run);
  }
  private admission(key:string){
    if(this.storage.indexed)return this.storage.indexed.findAdmission(key);
    const run=Object.values(this.state.runs).find(r=>r.requestKey===key);
    return run?{id:run.id,fingerprint:run.requestFingerprint}:undefined;
  }
  async resume(actor:Actor,id:string){const r=this.own(actor,id);if(r.state!=='waiting')throw requestError(r.state==='review'?'A human review requires Approve or Reject; Continue cannot approve it.':'Only a manual Wait can be continued.');this.allowedRun(actor,r);const checkpoint=r.trace.at(-1);if(checkpoint){checkpoint.state='completed';checkpoint.endedAt=now();}r.state='running';delete r.pending;r.cursor=this.next(r,r.cursor,'next');this.persist(r);return this.dispatch(actor,r);}
  async review(actor:Actor,id:string,decision:'approve'|'reject'){
    this.ensureHuman(actor);const r=this.own(actor,id);if(r.state!=='review')throw requestError('Run is not awaiting human review.');this.allowedRun(actor,r);
    r.review={decision,at:now(),requester:actor.requester??'authenticated-operator'};const checkpoint=r.trace.at(-1);if(checkpoint){checkpoint.state='completed';checkpoint.endedAt=now();}r.state='running';delete r.pending;
    r.outputs[r.cursor]={decision};r.cursor=this.next(r,r.cursor,decision);this.persist(r);return this.dispatch(actor,r);
  }
  cancel(actor:Actor,id:string){const r=this.own(actor,id);if(terminal(r))return this.status(actor,id);r.state='cancelled';this.dropQueued(id);r.updatedAt=now();delete r.pending;if(this.active.has(id))r.uncertainty='Cancellation requested during execution; a dispatched host call may have completed.';this.active.get(id)?.controller.abort(new Error('Run cancelled.'));for(const t of r.trace)if(['running','waiting','review'].includes(t.state)){t.state='cancelled';t.endedAt=now();}this.persist(r);return this.status(actor,id);}
  async close(){
    this.closing=true;this.clearQueued();
    try{
      for(const [id,active] of this.active){const r=this.cachedState.runs[id];r.state='interrupted';r.error='Gateway service stopped during execution.';r.uncertainty='A dispatched host call may have completed.';active.controller.abort(new Error(r.error));}
      if(!this.storageFailure)this.persist();
    }finally{
      await Promise.allSettled([...this.active.values()].map(x=>x.promise));
      await this.storage.close?.();
    }
  }
  private next(r:Run,id:string,port:string){const next=r.definition.edges.find(e=>e.source===id&&e.port===port)?.target;if(!next)throw executionError(`Missing ${port} edge from ${id}.`,'LOOPS_INVALID_GRAPH');return next;}
  private checkpoint(r:Run){r.updatedAt=now();this.persist(r);}
  private occupied(){return new Set([...this.active.keys(),...this.physical.keys()]).size;}
  private dropQueued(id:string){const actor=this.queued.get(id);this.queued.delete(id);if(actor)this.options.releaseActor?.(actor);}
  private clearQueued(){for(const id of this.queued.keys())this.dropQueued(id);}
  private drain(){if(this.closing)return;for(const [id,actor] of this.queued){if(this.occupied()>=(this.options.concurrency??1))break;this.queued.delete(id);try{const run=this.state.runs[id];if(run?.state==='queued')void this.dispatch(actor,run).catch(()=>{});}finally{this.options.releaseActor?.(actor);}}}
  private trackPhysical(id:string,promise:Promise<unknown>){const pending=this.physical.get(id)??new Set();pending.add(promise);this.physical.set(id,pending);const run=this.state.runs[id];const cleanup=()=>{pending.delete(promise);if(!pending.size){this.physical.delete(id);if(run.cleanupPending){run.cleanupPending=false;if(!this.closing)this.checkpoint(run);}this.drain();}};void promise.then(cleanup,cleanup).catch(()=>{});}

  private async dispatch(actor:Actor,r:Run):Promise<Run>{
    if(this.active.has(r.id))return structuredClone(r);
    if(this.closing)throw requestError('Loops service is stopping.','LOOPS_SERVICE_UNAVAILABLE');
    if(this.occupied()>=(this.options.concurrency??1)){r.state='queued';this.queued.set(r.id,actor);this.options.retainActor?.(actor);try{this.checkpoint(r);}catch(error){this.dropQueued(r.id);throw error;}return structuredClone(r);}
    r.state='running';this.checkpoint(r);
    actor={...actor,...r.executionSettings};
    const controller=new AbortController();const remaining=r.definition.limits.timeoutMs===undefined?undefined:r.definition.limits.timeoutMs-r.activeMs;
    const signal=actor.signal?AbortSignal.any([controller.signal,actor.signal]):controller.signal;
    if(remaining!==undefined)this.deadlines.set(r.id,Date.now()+remaining);
    const timeout=remaining===undefined?undefined:setTimeout(()=>controller.abort(executionError('Execution timeout exceeded.','LOOPS_TIMEOUT','Inspect the interrupted attempt before explicitly retrying. A timed-out host request may have completed.')),Math.max(0,remaining));
    this.options.retainActor?.(actor);
    const started=Date.now();const promise=this.pump(actor,r,signal).finally(()=>{try{clearTimeout(timeout);this.deadlines.delete(r.id);r.activeMs+=Date.now()-started;this.active.delete(r.id);if(this.physical.has(r.id))r.cleanupPending=true;this.checkpoint(r);this.drain();}finally{this.options.releaseActor?.(actor);}});
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
      const n=r.definition.nodes.find(n=>n.id===r.cursor);if(!n)throw executionError('Execution cursor is invalid.','LOOPS_INVALID_GRAPH');
      const evidence=this.begin(r,n);
      const contextFor=(iteration?:number):BindingContext=>iteration===undefined?ctx:{...ctx,repeat:{index:iteration}};
      const execution:NodeExecutionContext={
        signal,input:r.input,bind:template=>bind(template,ctx),compare:(predicate,iteration)=>compare(predicate,contextFor(iteration),r.definition.schemaVersion),
        infer:(node,iteration)=>this.infer(actor,r,node,contextFor(iteration),signal),modelInfo:()=>this.host.modelInfo(actor),
        requireCapability:capability=>this.host.check(actor,capability),checkAuthority:()=>this.allowedRun(actor,r),
        begin:(node,iteration)=>{this.begin(r,node,iteration);return r.trace.length-1;},
        finish:(sequence,output)=>this.finish(r,r.trace[sequence],output),setOutput:(id,output)=>{r.outputs[id]=output;},
      };
      const dispatched=nodeContract(n.kind).execute(n,execution);
      const outcome=dispatched instanceof Promise?await dispatched:dispatched;
      const result=outcome.output,port=outcome.port??'next';
      if(outcome.park){this.finish(r,evidence,outcome.park.value);r.state=outcome.park.state;r.pending=evidence.output;evidence.state=outcome.park.state;}
      if(outcome.returned){r.result=result;r.state='completed';}
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
  private begin(r:Run,n:{id:string;kind:string},iteration?:number){if(r.executions>=r.definition.limits.maxExecutions)throw executionError('Total node-execution budget exhausted.','LOOPS_BUDGET_EXHAUSTED');r.executions++;const e:NodeEvidence={nodeId:n.id,kind:n.kind,state:'running',startedAt:now(),...iteration?{iteration}:{}};r.trace.push(e);this.checkpoint(r);return e;}
  private finish(r:Run,e:NodeEvidence,result:Json){const output=display(result);if(Buffer.byteLength(output)>r.definition.limits.maxOutputBytes)throw executionError(`Output-size limit exceeded at ${e.nodeId}.`,'LOOPS_OUTPUT_LIMIT');if(r.definition.schemaVersion===1&&r.trace.reduce((size,t)=>size+Buffer.byteLength(t.output??''),0)+Buffer.byteLength(output)>48000)throw executionError('Run evidence output budget exceeded.','LOOPS_OUTPUT_LIMIT');e.output=output;e.state='completed';e.endedAt=now();}
  private async infer(actor:Actor,r:Run,n:Extract<GraphNode,{kind:'inference'}>,ctx:BindingContext,signal:AbortSignal):Promise<Json>{
    try{
    this.allowedRun(actor,r);this.host.check(actor,'llm');
    const prompt=display(bind(n.prompt,ctx));if(Buffer.byteLength(prompt)>(r.definition.schemaVersion===1?legacyBudgets.promptBytes:this.budgets.promptBytes))throw executionError('Rendered prompt exceeds the transport budget.','LOOPS_PROMPT_LIMIT');
    const issues=validateAdvanced(n.advanced,this.capabilities(actor,n).parameters);if(issues.length)throw executionError(issues.join(' '),'UNSUPPORTED_INFERENCE_SETTINGS');
    const settings:InferenceSettings={...n.model?{model:n.model}:{},...n.agentId?{agentId:n.agentId}:{},...n.reasoning?{reasoning:n.reasoning}:{},...n.advanced?{advanced:n.advanced}:{}};
    const deadline=this.deadlines.get(r.id);
    const remaining=deadline===undefined?undefined:deadline-Date.now();
    if(remaining!==undefined&&remaining<=0)throw executionError('Execution timeout exceeded.','LOOPS_TIMEOUT');
    const completion=this.host.complete(actor,prompt,signal,remaining,settings);
    this.trackPhysical(r.id,completion);
    let stop:()=>void=()=>{};
    const aborted=new Promise<never>((_,reject)=>{const abort=()=>reject(signal.reason??new Error('Aborted'));stop=()=>signal.removeEventListener('abort',abort);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
    const response=await Promise.race([completion,aborted]).finally(stop) as Record<string,Json>;
    if(typeof response.text!=='string')throw executionError('Host completion returned no text.','LOOPS_OUTPUT_INVALID');
    if(n.output==='json'){
      let value:unknown;try{value=JSON.parse(response.text);}catch{throw executionError('The model output is not valid JSON.','LOOPS_OUTPUT_INVALID');}
      if(r.definition.schemaVersion===1&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>16||Object.values(value).some(v=>v!==null&&!['string','boolean','number'].includes(typeof v))))throw executionError('Structured output must be a flat JSON object with at most 16 scalar fields.','LOOPS_OUTPUT_INVALID');
      if(!isJson(value))throw executionError('Structured output must contain valid JSON without unsafe keys or excessive nesting.','LOOPS_OUTPUT_INVALID');
      response.value=value;
    }
    return response;
    }catch(error){throw new LoopError(errorDetail(error,{phase:'inference',nodeId:n.id,model:n.model??actor.model}),{cause:error});}
  }
  capabilities(actor:Actor,settings:InferenceSettings={}){actor.check();const inference=this.host.capabilities?.(actor,settings)??{...(settings.model??actor.model)?{model:settings.model??actor.model}:{},configured:'unknown' as const,authorized:'unknown' as const,available:'unknown' as const,parameters:completionParameters(),notes:[]};return {...inference,budgets:{...this.budgets},concurrency:this.options.concurrency??1};}
  validate(actor:Actor,value:unknown){actor.check();const definition=parseDefinition(value,this.budgets);const issues=validateGraph(definition);for(const node of definition.nodes.flatMap(n=>[n,...childNodes(n)]))if(node.kind==='inference')for(const message of validateAdvanced(node.advanced,this.capabilities(actor,node).parameters))issues.push({nodeId:node.id,message});return {valid:issues.length===0,issues};}
}

import { join } from 'node:path';
import { defineFeaturePlugin, type FeatureHandlers, type FeatureInvocationContext } from 'openclaw/plugin-sdk/feature-plugin';
import {Value} from 'typebox/value';
import { contract } from './contract.js';
import {wireContract, uploadFields, UploadReferenceSchema,DocumentPageSchema} from './wire-contract.js';
import {parsePluginConfig,pluginConfigSchema,resolveBudgets} from './budgets.js';
import type { Actor } from './engine.js';
import { EngineService } from './engine-service.js';
import { createBridge } from './openclaw.js';
import {commandHelp,parseCommandInvocation,commandReply,commandPage} from './commands.js';
import {receipt,describe} from './receipts.js';
import {LoopError,requestError,errorDetail,safeFailure,formatFailure} from './errors.js';
import {outputs} from './output-schemas.js';
import {fitsToolReply,toolPage} from './tool-replies.js';
import {documentLinks} from './document-links.js';
import {emptyDocumentLinks} from './document-maintenance.js';

// OpenClaw may evaluate the external plugin for more than one registry scope.
// Keep one plugin-owned executor per state directory in this Gateway process.
// Only service.start creates it; tool registration cannot start a competing store.
const runtimeKey=Symbol.for('openclaw-loops-poc.executor.v2');
const scope=globalThis as typeof globalThis & {[runtimeKey]?:Map<string,EngineService>};
const engines=scope[runtimeKey]??=new Map<string,EngineService>();
const plugin=defineFeaturePlugin({contract:wireContract,name:'Loops',description:'Inspectable, bounded loops shared by native UI and chat.',setup(api,events){
  const config=parsePluginConfig(api.pluginConfig),budgets=resolveBudgets(config.budgets);
  const bridge=createBridge(api);const stateFile=join(api.runtime.state.resolveStateDir(),'loops-poc','state.json');
  const service=()=>{const engine=engines.get(stateFile);if(!engine)throw requestError('Loops service has not started in this Gateway.','LOOPS_SERVICE_UNAVAILABLE','Start or restart the enabled Loops plugin in this Gateway before trying again.');return engine;};
  api.registerService({id:'loops-poc-store',async start(){
    const existing=engines.get(stateFile);if(existing)return existing.ready;
    const engine=new EngineService({file:join(api.runtime.state.resolveStateDir(),'loops-poc','loops.sqlite'),legacyFile:stateFile,budgets,concurrency:config.maxConcurrentRuns??1},bridge.host,()=>events.emit('changed',{}));
    engines.set(stateFile,engine);
    try{await engine.ready;}catch(error){try{await engine.close();}catch{/* Readiness already carries the startup failure. */}finally{if(engines.get(stateFile)===engine)engines.delete(stateFile);}throw error;}
  },async stop(){
    const engine=engines.get(stateFile);
    try{await engine?.close();}finally{if(engines.get(stateFile)===engine)engines.delete(stateFile);}
  }});
  api.registerCommand({name:'loops',description:'Author, manage and execute loops. Use /loops help for operations and arguments.',acceptsArgs:true,requireAuth:true,requiredScopes:['operator.write'],
    agentPromptGuidance:['Loops tools provide full loop lifecycle control on user request. Use loops_browse to search and page through saved loops, including drafts, runnable publications and recoverable records. Follow nextCursor until null. loops_library remains compatible; use loops_read for a complete definition. loops_create creates enabled loops by default; set enabled:false only when a draft is wanted. loops_edit preserves activation by default and accepts enabled:true/false to publish or save a draft. loops_enable enables or disables any valid saved revision without a human-only activation step; loops_revoke also stops future host actions in parked runs. Use loops_delete for requested deletion. Read the current revision before changing existing loops and reload on a conflict. To invoke a requested loop, use loops_list/loops_describe then actually call loops_run with the required inputs. If the requested loop is disabled, read and enable it as part of the request to run it, unless the user asks to keep it disabled. Report the actual result or pending/failed state; use loops_status for long-running results. A graph containing an explicit Human review node still pauses for that human decision. If tools are deferred, search for the specific loops_* tool using host discovery. Never claim loops are unavailable just because loops_list is empty. Never simulate calls or edit the plugin store directly.'],
    async handler(command){try{
      const context:FeatureInvocationContext={source:'command',command,api},actor=bridge.actor(context);
      const parsed=parseCommandInvocation(command,Math.max(budgets.definitionBytes,budgets.inputBytes)*2);
      if(parsed.kind==='help'){
        const help=commandHelp(parsed.operation);
        const text=await commandReply(help,value=>service().invoke('documentSnapshot',actor,value,documentLinks('help',{},value)));
        actor.check();return {text};
      }
      const operation=wireContract.operations[parsed.operation];
      if(operation.kind==='action'&&!actor.canManage)throw requestError('This command requires an operator with write access.','HOST_POLICY_DENIED');
      const handler=wireHandlers[parsed.operation] as (input:unknown,context:FeatureInvocationContext)=>unknown;
      const result=await handler(parsed.input,context);
      if(!Value.Check(operation.output,result))throw new Error('Operation output does not match its Loops schema.');
      const value=parsed.operation==='document'&&Value.Check(DocumentPageSchema,result)?commandPage(result):
        parsed.operation==='output'&&Value.Check(outputs.output,result)?commandPage(result):result;
      const text=await commandReply(value,value=>service().invoke('documentSnapshot',actor,value,documentLinks(parsed.operation,parsed.input,value)),parsed.format);
      actor.check();return {text};
    }catch(error){return {text:`Loops ${formatFailure(errorDetail(error,{phase:'operation'}))}`};}}
  });
  const handlers:FeatureHandlers<typeof contract> = {
    browse:(p,c)=>service().invoke('browse',bridge.actor(c),p),
    retention:(p,c)=>service().invoke('retention',bridge.actor(c),p.policy,p.applyPlanId),
    maintenance:(p,c)=>service().invoke('maintenance',bridge.actor(c),p.policy,p.applyPlanId),
    transport_release:(p,c)=>service().invoke('transportRelease',bridge.actor(c),p),
    test:async(p,c)=>receipt(await service().invoke('test',bridge.actor(c),p.definition,p.input,p.requestId??(c.source==='tool'?`tool:${c.toolCallId}`:(()=>{throw requestError('requestId is required.');})()))),retry:async(p,c)=>receipt(await service().invoke('retry',bridge.actor(c),p.runId,p.mode,p.requestId??(c.source==='tool'?`tool:${c.toolCallId}`:(()=>{throw requestError('requestId is required.');})()))),
    draft:(p,c)=>service().invoke('draft',bridge.actor(c),p.definition,p.expectedRevision),versions:(p,c)=>service().invoke('versions',bridge.actor(c),p.id),publish:(p,c)=>service().invoke('publish',bridge.actor(c),p.id,p.revision,p.expectedRevision),restore:(p,c)=>service().invoke('restore',bridge.actor(c),p.id,p.revision,p.expectedRevision),archive:(p,c)=>service().invoke('archive',bridge.actor(c),p.id,p.expectedRevision,p.archived),deleted:(_,c)=>service().invoke('deleted',bridge.actor(c)),recover:(p,c)=>service().invoke('recover',bridge.actor(c),p.id,p.expectedRevision),output:(p,c)=>service().invoke('output',bridge.actor(c),p.runId,p.nodeId,p.offset,p.limit),history:(p,c)=>service().invoke('history',bridge.actor(c),p.cursor,p.limit),
    capabilities:(p,c)=>service().invoke('capabilities',bridge.actor(c),p),validate:(p,c)=>service().invoke('validate',bridge.actor(c),p.definition),
    list:(_,c)=>service().invoke('list',bridge.actor(c)),describe:async(p,c)=>describe(await service().invoke('describe',bridge.actor(c),p.slug)),
    run:async(p,c)=>{if(p.input!==undefined&&p.text!==undefined)throw requestError('Supply input or the text shortcut, not both.');return receipt(await service().invoke('run',bridge.actor(c),p.slug,p.input??(p.text===undefined?{}:{text:p.text}),p.requestId??(c.source==='tool'?`tool:${c.toolCallId}`:(()=>{throw requestError('requestId is required for UI execution.');})())));},
    status:async(p,c)=>receipt(await service().invoke('status',bridge.actor(c),p.runId)),resume:async(p,c)=>receipt(await service().invoke('resume',bridge.actor(c),p.runId)),cancel:async(p,c)=>receipt(await service().invoke('cancel',bridge.actor(c),p.runId)),
    library:(_,c)=>service().invoke('library',bridge.actor(c)),load:(p,c)=>service().invoke('load',bridge.actor(c),p.id),save:(p,c)=>service().invoke('save',bridge.actor(c),p.definition,p.expectedRevision,p.enabled),
    create:(p,c)=>service().invoke('create',bridge.actor(c),p.definition,p.enabled),edit:(p,c)=>service().invoke('edit',bridge.actor(c),p.id,p.expectedRevision,p.changes,p.enabled),delete:(p,c)=>service().invoke('delete',bridge.actor(c),p.id,p.expectedRevision),
    enable:(p,c)=>service().invoke('enable',bridge.actor(c),p.id,p.revision,p.enabled,p.grants),revoke:(p,c)=>service().invoke('revoke',bridge.actor(c),p.id),runs:(_,c)=>service().invoke('runs',bridge.actor(c)),inspect:(p,c)=>service().invoke('status',bridge.actor(c),p.runId),review:async(p,c)=>receipt(await service().invoke('review',bridge.actor(c),p.runId,p.decision)),
  };
  const safely=async<T>(name:string,context:FeatureInvocationContext,handler:(actor:Actor)=>T|Promise<T>)=>{
    let actor:Actor|undefined;
    try{
      actor=bridge.actor(context);
      const result=await handler(actor);actor.check();return result;
    }catch(error){
      // Recheck a constructed actor before publishing a known failure. A lost
      // session supersedes a stale operation failure, but unexpected errors
      // still cross the host boundary as masked failures.
      let failure:unknown=error;
      try{actor?.check();}catch(current){failure=current;}
      if(!(failure instanceof LoopError))throw failure;
      return {kind:'loops-error' as const,operation:name,error:safeFailure(failure)};
    }
  };
  const wrapped=Object.fromEntries(Object.entries(handlers).map(([name,handler])=>[name,(input:unknown,context:FeatureInvocationContext)=>safely(name,context,async actor=>{
    const payload=structuredClone(input) as Record<string,unknown>;
    const uses:Array<{documentId:string;readerId?:string}>=[];let dispatched=false,finished=false;
    try{
      for(const field of uploadFields[name as keyof typeof uploadFields]??[])if(Value.Check(UploadReferenceSchema,payload[field])){
        const use=await service().invoke('documentUse',actor,payload[field]);uses.push(use);payload[field]=use.value;
      }
      const operation=contract.operations[name as keyof typeof contract.operations];
      if(!Value.Check(operation.input,payload))throw requestError('Uploaded or inline input does not match the operation schema.');
      dispatched=true;
      const result=await (handler as (input:unknown,context:FeatureInvocationContext)=>unknown)(payload,context);
      if(!Value.Check(operation.output,result))throw new Error('Operation output does not match its Loops schema.');
      actor.check();
      const links=documentLinks(name,payload,result);
      for(const use of uses)await service().invoke('documentFinishUse',actor,use.documentId,use.readerId,links);
      finished=true;
      const tool='tool' in operation?operation.tool.name:undefined;
      const value=context.source==='tool'&&tool&&name==='output'&&Value.Check(outputs.output,result)?toolPage(result,tool):result;
      const output=await service().invoke('documentWrap',actor,value,links);
      return context.source==='tool'&&tool&&!fitsToolReply(output,tool)?service().invoke('documentSnapshot',actor,output,documentLinks(name,payload,output)):output;
    }catch(error){
      if(!finished)for(const use of uses){
        try{await service().invoke('documentFinishUse',actor,use.documentId,use.readerId,{...emptyDocumentLinks(),unknown:dispatched});}
        catch{/* Keep the durable reservation if finalizing its provenance fails. Preserve the original operation error. */}
      }
      throw error;
    }
  })])) as FeatureHandlers<typeof wireContract>;
  const wireHandlers:FeatureHandlers<typeof wireContract>={...wrapped,
    document:(p,c)=>safely('document',c,async actor=>{const page=await service().invoke('documentRead',actor,p.documentId,p.offset,p.limit,p.readerId);return c.source==='tool'?toolPage(page,'loops_document'):page;}),
    document_acquire:(p,c)=>safely('document_acquire',c,actor=>service().invoke('documentAcquire',actor,p.documentId)),
    document_release:(p,c)=>safely('document_release',c,actor=>service().invoke('documentRelease',actor,p.documentId,p.readerId)),
    upload:(p,c)=>safely('upload',c,actor=>service().invoke('documentUpload',actor,p)),
  };
  return wireHandlers;
}});
Object.assign(plugin.configSchema.jsonSchema??={},pluginConfigSchema);
plugin.configSchema.parse=parsePluginConfig;
export default plugin;

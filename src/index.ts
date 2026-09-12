import { join } from 'node:path';
import { defineFeaturePlugin, type FeatureHandlers, type FeatureInvocationContext } from 'openclaw/plugin-sdk/feature-plugin';
import {Value} from 'typebox/value';
import { contract } from './contract.js';
import {wireContract, uploadFields, UploadReferenceSchema} from './wire-contract.js';
import {DocumentStore} from './document-store.js';
import {parsePluginConfig,pluginConfigSchema,resolveBudgets} from './budgets.js';
import { Engine } from './engine.js';
import { SqliteStorage } from './storage.js';
import { createBridge, formatRun, help, parseCommand } from './openclaw.js';
import {receipt,describe} from './receipts.js';
import {LoopError,requestError,safeFailure} from './errors.js';

// OpenClaw may evaluate the external plugin for more than one registry scope.
// Keep one plugin-owned executor per state directory in this Gateway process.
// Only service.start creates it; tool registration cannot start a competing store.
const runtimeKey=Symbol.for('openclaw-loops-poc.executor.v1');
const scope=globalThis as typeof globalThis & {[runtimeKey]?:Map<string,Engine>};
const engines=scope[runtimeKey]??=new Map<string,Engine>();
const plugin=defineFeaturePlugin({contract:wireContract,name:'Loops',description:'Inspectable, bounded loops shared by native UI and chat.',setup(api,events){
  const config=parsePluginConfig(api.pluginConfig),budgets=resolveBudgets(config.budgets);
  const bridge=createBridge(api);const stateFile=join(api.runtime.state.resolveStateDir(),'loops-poc','state.json');
  let documents:DocumentStore|undefined;
  const documentStore=()=>documents??=new DocumentStore(join(api.runtime.state.resolveStateDir(),'loops-poc','documents'),Math.max(budgets.definitionBytes,budgets.inputBytes)*2);
  const service=()=>{const engine=engines.get(stateFile);if(!engine)throw new Error('Loops service has not started in this Gateway.');return engine;};
  api.registerService({id:'loops-poc-store',start(){
    if(engines.has(stateFile))return;
    const storage=new SqliteStorage(join(api.runtime.state.resolveStateDir(),'loops-poc','loops.sqlite'),stateFile);
    try{engines.set(stateFile,new Engine(storage,bridge.host,{budgets,concurrency:config.maxConcurrentRuns??1,onChange:()=>events.emit('changed',{})}));}
    catch(error){return storage.close().then(()=>{throw error;},cleanupError=>{throw new AggregateError([error,cleanupError],'Loops startup failed and storage cleanup reported a failure.');});}
  },async stop(){
    const engine=engines.get(stateFile);
    try{await engine?.close();}finally{if(engines.get(stateFile)===engine)engines.delete(stateFile);}
  }});
  api.registerCommand({name:'loops',description:'Discover and execute saved bounded loops.',acceptsArgs:true,requireAuth:true,requiredScopes:['operator.write'],
    agentPromptGuidance:['Loops tools provide full loop lifecycle control on user request. Use loops_library and loops_read for all saved definitions, including drafts. loops_create creates enabled loops by default; set enabled:false only when a draft is wanted. loops_edit preserves activation by default and accepts enabled:true/false to publish or save a draft. loops_enable enables or disables any valid saved revision without a human-only activation step; loops_revoke also stops future host actions in parked runs. Use loops_delete for requested deletion. Read the current revision before changing existing loops and reload on a conflict. To invoke a requested loop, use loops_list/loops_describe then actually call loops_run with the required inputs. If the requested loop is disabled, read and enable it as part of the request to run it, unless the user asks to keep it disabled. Report the actual result or pending/failed state; use loops_status for long-running results. A graph containing an explicit Human review node still pauses for that human decision. If tools are deferred, search for the specific loops_* tool using host discovery. Never claim loops are unavailable just because loops_list is empty. Never simulate calls or edit the plugin store directly.'],
    async handler(command){try{const actor=bridge.actor({source:'command',command,api}),parsed=parseCommand(command,budgets.inputBytes),e=service();
      if(parsed.op==='list')return {text:JSON.stringify(e.list(actor),null,2)};
      const run=parsed.op==='run'?await e.run(actor,parsed.slug,parsed.input,parsed.requestId):parsed.op==='status'?e.status(actor,parsed.runId):parsed.op==='resume'?await e.resume(actor,parsed.runId):parsed.op==='review'?await e.review(actor,parsed.runId,parsed.decision):e.cancel(actor,parsed.runId);
      return {text:formatRun(run)};
    }catch(error){return {text:`Loops: ${error instanceof Error?error.message:'Command failed.'}\n${help}`};}}
  });
  const handlers:FeatureHandlers<typeof contract> = {
    retention:(p,c)=>service().retention(bridge.actor(c),p.policy,p.applyPlanId),
    test:async(p,c)=>receipt(await service().test(bridge.actor(c),p.definition,p.input,p.requestId??(c.source==='tool'?`tool:${c.toolCallId}`:(()=>{throw requestError('requestId is required.');})()))),retry:async(p,c)=>receipt(await service().retry(bridge.actor(c),p.runId,p.mode,p.requestId??(c.source==='tool'?`tool:${c.toolCallId}`:(()=>{throw requestError('requestId is required.');})()))),
    draft:(p,c)=>service().draft(bridge.actor(c),p.definition,p.expectedRevision),versions:(p,c)=>service().versions(bridge.actor(c),p.id),publish:(p,c)=>service().publish(bridge.actor(c),p.id,p.revision,p.expectedRevision),restore:(p,c)=>service().restore(bridge.actor(c),p.id,p.revision,p.expectedRevision),archive:(p,c)=>service().archive(bridge.actor(c),p.id,p.expectedRevision,p.archived),deleted:(_,c)=>service().deleted(bridge.actor(c)),recover:(p,c)=>service().recover(bridge.actor(c),p.id,p.expectedRevision),output:(p,c)=>service().output(bridge.actor(c),p.runId,p.nodeId,p.offset,p.limit),history:(p,c)=>service().history(bridge.actor(c),p.cursor,p.limit),
    capabilities:(p,c)=>service().capabilities(bridge.actor(c),p),validate:(p,c)=>service().validate(bridge.actor(c),p.definition),
    list:(_,c)=>service().list(bridge.actor(c)),describe:(p,c)=>describe(service().describe(bridge.actor(c),p.slug)),
    run:async(p,c)=>{if(p.input!==undefined&&p.text!==undefined)throw requestError('Supply input or the text shortcut, not both.');return receipt(await service().run(bridge.actor(c),p.slug,p.input??(p.text===undefined?{}:{text:p.text}),p.requestId??(c.source==='tool'?`tool:${c.toolCallId}`:(()=>{throw requestError('requestId is required for UI execution.');})())));},
    status:(p,c)=>receipt(service().status(bridge.actor(c),p.runId)),resume:async(p,c)=>receipt(await service().resume(bridge.actor(c),p.runId)),cancel:(p,c)=>receipt(service().cancel(bridge.actor(c),p.runId)),
    library:(_,c)=>service().library(bridge.actor(c)),load:(p,c)=>service().load(bridge.actor(c),p.id),save:(p,c)=>service().save(bridge.actor(c),p.definition,p.expectedRevision,p.enabled),
    create:(p,c)=>service().create(bridge.actor(c),p.definition,p.enabled),edit:(p,c)=>service().edit(bridge.actor(c),p.id,p.expectedRevision,p.changes,p.enabled),delete:(p,c)=>service().delete(bridge.actor(c),p.id,p.expectedRevision),
    enable:(p,c)=>service().enable(bridge.actor(c),p.id,p.revision,p.enabled,p.grants),revoke:(p,c)=>service().revoke(bridge.actor(c),p.id),runs:(_,c)=>service().runs(bridge.actor(c)),inspect:(p,c)=>service().status(bridge.actor(c),p.runId),review:async(p,c)=>receipt(await service().review(bridge.actor(c),p.runId,p.decision)),
  };
  const wrapped=Object.fromEntries(Object.entries(handlers).map(([name,handler])=>[name,async(input:unknown,context:FeatureInvocationContext)=>{
    const actor=bridge.actor(context),payload=structuredClone(input) as Record<string,unknown>;
    try{
    for(const field of uploadFields[name as keyof typeof uploadFields]??[])if(Value.Check(UploadReferenceSchema,payload[field]))payload[field]=documentStore().resolve(actor,payload[field]);
    const operation=contract.operations[name as keyof typeof contract.operations];
    if(!Value.Check(operation.input,payload))throw requestError('Uploaded or inline input does not match the operation schema.');
    const result=await (handler as (input:unknown,context:FeatureInvocationContext)=>unknown)(payload,context);
    if(!Value.Check(operation.output,result))throw new Error('Operation output does not match its Loops schema.');
    actor.check();return documentStore().wrap(actor,result);
    }catch(error){
      actor.check();
      if(!(error instanceof LoopError))throw error;
      return {kind:'loops-error',operation:name,error:safeFailure(error)};
    }
  }])) as FeatureHandlers<typeof wireContract>;
  return {...wrapped,
    document:(p,c)=>documentStore().read(bridge.actor(c),p.documentId,p.offset,p.limit),
    upload:(p,c)=>documentStore().upload(bridge.actor(c),p),
  };
}});
Object.assign(plugin.configSchema.jsonSchema??={},pluginConfigSchema);
plugin.configSchema.parse=parsePluginConfig;
export default plugin;

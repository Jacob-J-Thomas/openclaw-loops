import {describe,it,expect} from 'vitest';
import {parseNativeAgentSelection,compareNativeAgentOwner,projectNativeAgentResult,nativeAgentRunParams,awaitNativeAgentAction} from './helpers/native-agent-plugin.mjs';
import {validateNativeAgentLeadConfig,nativeHistoryFacts,assertNativeAgentRead,assertNativeAgentCancellation,sanitizeNativeAgentReceipt,nativeAgentExecutionTimeoutMs} from '../scripts/verify-native-agent.mjs';
const selection={agentId:'main',provider:'fixture-provider',model:'fixture-model',thinking:'off',timeoutMs:120000,contextTokenBudget:32768};
const owner={agentId:'main',sessionId:'host-id',sessionKey:'host-key',lifecycleRevision:'host-generation',storePath:'/disposable/store'};
const read={state:'completed',settled:true,modelCallStarted:true,tools:[{toolName:'read',isError:false,text:'observed-seed'}],result:{aborted:false,error:null,text:'NATIVE_AGENT_READ observed-seed',attribution:{provider:selection.provider,model:selection.model,usage:{input:23,output:9}}}};
const cancelled={modelCallStarted:true,cancelRequested:true,activeAtCancellation:true,settled:true,settledAt:20,cancelRequestedAt:10,state:'aborted',result:{aborted:true}};
const noUndefined=value=>{expect(value).not.toBeUndefined();if(Array.isArray(value))value.forEach(noUndefined);else if(value&&typeof value==='object')Object.values(value).forEach(noUndefined);};
describe('native agent qualification contract',()=>{
  it('requires explicit bounded settings and supplied model catalog, never credentials discovery',()=>{
    expect(parseNativeAgentSelection(selection)).toEqual(selection);
    expect(()=>parseNativeAgentSelection({...selection,senderIsOwner:true})).toThrow(/Unknown/);
    expect(()=>parseNativeAgentSelection({...selection,timeoutMs:0})).toThrow(/timeoutMs/);
    const config={selection,models:{providers:{[selection.provider]:{baseUrl:'http://127.0.0.1:11439',apiKey:'explicit-disposable-value',models:[{id:selection.model}]}}}};
    expect(validateNativeAgentLeadConfig(config)).toBe(config);
    expect(()=>validateNativeAgentLeadConfig({...config,auth:{profiles:{}}})).toThrow(/only selection/);
    expect(()=>validateNativeAgentLeadConfig({selection,models:{providers:{[selection.provider]:{baseUrl:'http://127.0.0.1:11439',models:[{id:selection.model}]}}}})).toThrow(/disposable provider key/);
  });
  it('binds actual host identity and labels wrong/reset generations as fixture checks',()=>{
    expect(compareNativeAgentOwner(owner,{...owner})).toEqual({ok:true});
    expect(compareNativeAgentOwner(owner,{...owner,sessionKey:'foreign'})).toMatchObject({code:'FOREIGN_SESSION',hostDenied:false,stage:'fixture-owner'});
    for(const changed of [{sessionId:'new-id'},{lifecycleRevision:'new-generation'},{lifecycleRevision:null},{storePath:'/different-store'}])expect(compareNativeAgentOwner(owner,{...owner,...changed})).toMatchObject({code:'SESSION_GENERATION_CHANGED',hostDenied:false});
  });
  it('builds a public durable agent request without pre-admitted identity, sender authority or provider client',()=>{
    const signal=new AbortController().signal,params=nativeAgentRunParams({config:{},selection,owner,workspaceDir:'/disposable/workspace',signal,runId:'caller-correlation',prompt:'fixture read',callbacks:{}});
    expect(params).toMatchObject({sessionId:owner.sessionId,sessionKey:owner.sessionKey,sessionTarget:{agentId:owner.agentId,sessionId:owner.sessionId,sessionKey:owner.sessionKey,storePath:owner.storePath},sessionPersistence:'durable',requireWorkspaceOnly:true,toolsAllow:['read','write'],disableMessageTool:true,provider:selection.provider,model:selection.model,thinkLevel:selection.thinking,streamParams:{maxTokens:1024}});
    for(const key of ['admittedRunContext','preparedRunAdmission','senderIsOwner','authProfileId','execOverrides','scheduledRuntimeAuthority','runtimePluginToolGrant'])expect(params).not.toHaveProperty(key);
    expect(params.abortSignal).toBe(signal);
  });
  it('projects unknown native fields honestly and never includes undefined or credentials',()=>{
    const result=projectNativeAgentResult({meta:{durationMs:1,agentMeta:{sessionId:'host-id',provider:'p',model:'m',credentialSource:{token:'secret'},usage:{input:3,output:4,cost:{total:1}}}},payloads:[{text:'answer'},{text:'private-reasoning',isReasoning:true}]});
    noUndefined(result);expect(result.attribution.usage).toEqual({input:3,output:4});expect(result.text).toBe('answer');expect(JSON.stringify(result)).not.toMatch(/secret|credentialSource|private-reasoning/);expect(projectNativeAgentResult({meta:{}}).attribution).toBeNull();
  });
  it('keeps the action response pending until the original execution settles',async()=>{
    let release,responded=false;
    const record={id:'caller-correlation',settled:false},execution=new Promise(resolve=>{release=resolve;});
    const response=awaitNativeAgentAction(execution,record).then(result=>{responded=true;return result;});
    await Promise.resolve();await Promise.resolve();
    expect(responded).toBe(false);
    record.settled=true;release();
    expect(await response).toEqual({ok:true,result:{ok:true,id:record.id,record:{...record},executionResponseAfterSettlement:true}});
    await expect(awaitNativeAgentAction(Promise.reject(Error('execution failed')),record)).rejects.toThrow('execution failed');
  });
  it('allows model timeout plus bounded RPC overhead within the global remaining budget',()=>{
    const maximum={...selection,timeoutMs:180000};
    expect(nativeAgentExecutionTimeoutMs(maximum,600000)).toBe(210000);
    expect(nativeAgentExecutionTimeoutMs(maximum,70000)).toBe(70000);
    expect(maximum.timeoutMs).toBe(180000);
  });
  it('requires genuine native tool result, selected attribution and usage, not just the model response',()=>{
    expect(()=>assertNativeAgentRead(read,selection,'observed-seed')).not.toThrow();
    for(const invalid of [{...read,tools:[]},{...read,modelCallStarted:false},{...read,result:{...read.result,attribution:{...read.result.attribution,model:'other'}}},{...read,result:{...read.result,attribution:{...read.result.attribution,usage:null}}}])expect(()=>assertNativeAgentRead(invalid,selection,'observed-seed')).toThrow();
  });
  it('rejects cancellation before actual start, after settlement or without host abort/rejection',()=>{
    expect(()=>assertNativeAgentCancellation(cancelled)).not.toThrow();
    for(const invalid of [{...cancelled,modelCallStarted:false},{...cancelled,activeAtCancellation:false},{...cancelled,settled:false},{...cancelled,state:'completed'},{...cancelled,result:null}])expect(()=>assertNativeAgentCancellation(invalid)).toThrow();
  });
  it('requires an assistant transcript receipt rather than a user prompt containing the seed',()=>{
    expect(nativeHistoryFacts({sessionId:'host-id',messages:[{role:'user',content:'seed'}]},'seed').assistantSeed).toBe(false);
    const facts=nativeHistoryFacts({sessionId:'host-id',messages:[{role:'assistant',content:[{type:'text',text:'seed'}]}]},'seed');expect(facts.assistantSeed).toBe(true);expect(facts.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('refuses a successful sanitized receipt until every cleanup boundary is proven',()=>{
    const complete={clientsStopped:true,ownedProcessesExited:true,hostPromisesSettled:true,hostRequestsSettled:true};
    expect(sanitizeNativeAgentReceipt({status:'passed',cleanup:complete}).status).toBe('passed');
    for(const boundary of Object.keys(complete))expect(sanitizeNativeAgentReceipt({status:'passed',cleanup:{...complete,[boundary]:false}}).status).toBe('failed');
  });
  it('publishes only cleanup facts, selected identifiers and numeric usage, never raw evidence',()=>{
    const value=sanitizeNativeAgentReceipt({status:'passed',source:'sha',node:'v24.16.0',requested:selection,token:'private-token',profile:'/private/profile',observations:[{label:'read',classification:'actual-agent-loop',passed:true,raw:'private',owner,attribution:{provider:'p',model:'m',sessionId:'private-session',usage:{input:4,output:2,secret:'private-secret'}}}],cleanup:{clientsStopped:true,ownedProcessesExited:true,hostPromisesSettled:true,hostRequestsSettled:true,path:'/private/profile'}});
    noUndefined(value);expect(JSON.stringify(value)).not.toMatch(/private-token|private-profile|private-session|private-secret|host-key|host-id|host-generation|\/private/);expect(value.observations[0].attribution.usage).toEqual({input:4,output:2});expect(value.maxModelAdmissions).toBe(2);
  });
});

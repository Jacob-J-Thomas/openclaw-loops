import {describe,it,expect,vi} from 'vitest';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {compare,validateGraph} from '../src/graph.js';
import {completionParameters,validateAdvanced} from '../src/inference-settings.js';
import {createBridge,parseCommand} from '../src/openclaw.js';
import type {FeatureInvocationContext} from 'openclaw/plugin-sdk/feature-plugin';
import type {OpenClawPluginApi,PluginCommandContext} from 'openclaw/plugin-sdk/plugin-entry';

const actor:Actor={agentId:'main',sessionKey:'agent:main:test',sessionId:'test',source:'tool',human:false,check:()=>{}};
class Store implements Storage{
  value:ReturnType<Storage['read']>;fail=false;
  read(){return structuredClone(this.value);}
  write(value:Parameters<Storage['write']>[0]){if(this.fail)throw Error('Disk full');this.value=structuredClone(value);}
}
function setup(){const storage=new Store();const host:HostCapabilities={check:()=>{},complete:vi.fn(async()=>({text:'Result'})),modelInfo:async()=>({provider:'fake',model:'test'})};return {storage,host,engine:new Engine(storage,host)};}

describe('release fault regressions',()=>{
  it.each([undefined,'explicit/chosen'])('attributes inference failures to the dispatched agent model with override %s',async model=>{
    const {engine,host}=setup(),caller={...actor,model:'invoker/default'};
    host.capabilities=(_actor,settings={})=>({model:settings.model??(settings.agentId==='worker'?'worker/default':'invoker/default'),configured:'unknown',authorized:'unknown',available:'unknown',parameters:[],notes:[]});
    const complete=vi.fn<HostCapabilities['complete']>(async()=>{throw Object.assign(new Error('Synthetic rate limit'),{status:429});});host.complete=complete;
    const definition=structuredClone(examples[0]),node=definition.nodes.find(n=>n.kind==='inference');if(node?.kind!=='inference')throw Error();node.agentId='worker';if(model)node.model=model;
    definition.revision=1;engine.save(caller,definition,1,true);
    try{
      const run=await engine.run(caller,definition.slug,{text:'Failure attribution'},'agent-model-error'),expected=model??'worker/default';
      expect(complete.mock.calls[0][4]).toMatchObject({agentId:'worker',model:expected});
      expect(run).toMatchObject({state:'failed',errorDetail:{code:'HOST_RATE_LIMITED',phase:'inference',nodeId:node.id,model:expected,retryable:true}});
      expect(run.trace.find(t=>t.nodeId==='return')).toBeUndefined();
    }finally{await engine.close();}
  });
  it('rejects fields that a real producer does not return',()=>{
    const d=structuredClone(examples[0]);const end=d.nodes.at(-1)!;if(end.kind!=='return')throw Error();end.value='{{nodes.input.text}}';
    expect(validateGraph(d)).toContainEqual({nodeId:'return',message:'Node input (input) does not produce text.'});
  });
  it('truthy never resolves an unused right operand',()=>{
    expect(compare({left:'{{input.yes}}',op:'truthy',right:'{{input.absent}}'},{input:{yes:true},nodes:{}})).toBe(true);
  });
  it('failed save rolls back visible state to the committed revision',()=>{
    const {engine,storage}=setup();const before=engine.load(actor,'summarize-text');storage.fail=true;
    expect(()=>engine.edit(actor,'summarize-text',1,{name:'Uncommitted'})).toThrow('Disk full');
    expect(engine.load(actor,'summarize-text')).toEqual(before);
    storage.fail=false;expect(engine.edit(actor,'summarize-text',1,{name:'Committed'}).record.definition.revision).toBe(2);
  });
  it('never serves unverified memory or dispatches work when both commit and readback fail',async()=>{
    const {engine,storage,host}=setup();const committed=structuredClone(storage.value);
    storage.fail=true;const read=vi.spyOn(storage,'read').mockImplementation(()=>{throw new Error('Store disappeared');});
    expect(()=>engine.edit(actor,'summarize-text',1,{name:'Uncommitted'})).toThrow(/could not be verified/);
    read.mockRestore();storage.fail=false;
    // A later successful read is not permission to continue a poisoned engine.
    // Restart owns recovery and decides which committed attempts are uncertain.
    expect(()=>engine.load(actor,'summarize-text')).toThrow(/could not be verified/);
    await expect(engine.run(actor,'summarize-text',{text:'Must not dispatch'},'after-store-loss')).rejects.toThrow(/could not be verified/);
    expect(host.complete).not.toHaveBeenCalled();await engine.close();
    expect(storage.value).toEqual(committed);
    const reopened=new Engine(storage,host);expect(reopened.load(actor,'summarize-text').definition.name).toBe(committed?.loops['summarize-text'].definition.name);await reopened.close();
  });
  it('publishing a smaller capability set does not revoke a pinned wait',async()=>{
    const {engine}=setup();engine.enable(actor,'read-pause-continue',1,true);
    const parked=await engine.run(actor,'read-pause-continue',{text:'Request'},'pin');
    engine.edit(actor,'read-pause-continue',1,{capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}],edges:[{id:'edge',source:'input',target:'return',port:'next'}]},true);
    expect((await engine.resume(actor,parked.id)).state).toBe('completed');
  });
  it('intentional command invocations have fresh identity, explicit retries preserve identity',()=>{
    const ctx={sessionId:'s',args:'run summarize-text hello'} as PluginCommandContext;
    expect(parseCommand(ctx)).not.toEqual(parseCommand(ctx));
    expect(parseCommand({...ctx,args:'run summarize-text hello --request-id repeat'})).toEqual(parseCommand({...ctx,args:'run summarize-text hello --request-id repeat'}));
  });
  it('zero survives validation, while unsupported explicit settings fail without blocking inheritance',()=>{
    const descriptors=completionParameters();
    expect(validateAdvanced({temperature:0},descriptors)).toEqual([]);
    expect(validateAdvanced(undefined,descriptors)).toEqual([]);
    expect(validateAdvanced({topP:0},descriptors).join(' ')).toContain('public isolated completion');
    expect(validateAdvanced({temperature:0},completionParameters({supportsTemperature:false})).join(' ')).toContain('unsupported');
  });
});

describe('real bridge parameter forwarding (fake host completion)',()=>{
  function bridgeSetup(resolveDefaultModelForAgent=(agentId:string)=>({provider:'fake',model:agentId==='research'?'default':'fallback'})){
    const complete=vi.fn(async()=>({text:'ok'}));
    const cfg={plugins:{entries:{'loops-poc':{enabled:true,llm:{allowModelOverride:true}}}},agents:{defaults:{model:{primary:'fake/default'}}}};
    const entry={sessionId:'test',modelOverride:'active',providerOverride:'fake',thinkingLevel:'high',authProfileOverride:'new-session-profile'};
    const api={config:cfg,runtime:{config:{current:()=>cfg},llm:{complete},modelConfig:{resolveDefaultModelForAgent:({agentId}:{agentId:string})=>resolveDefaultModelForAgent(agentId)},agent:{normalizeThinkingLevel:(value:string)=>value,session:{getSessionEntry:()=>entry}}}} as unknown as OpenClawPluginApi;
    return {...createBridge(api),api,complete};
  }
  it('uses the configured host default for UI, command and agent tool paths without forcing sampling defaults',async()=>{
    const bridge=bridgeSetup();
    for(const source of ['session-action','command','tool'] as const){
      const c={agentId:'research',sessionKey:'agent:research:test',sessionId:'test',isAuthorizedSender:true,client:{connId:'test',scopes:['operator.admin']}};
      const context={source,api:bridge.api,...source==='session-action'?{action:c}:source==='command'?{command:c}:{tool:c}} as unknown as FeatureInvocationContext;
      const a=bridge.actor(context);
      await bridge.host.complete(a,'Prompt',new AbortController().signal,10000);
      const args=(bridge.complete.mock.lastCall as unknown as [{model:string;reasoning:string;temperature?:number;maxTokens?:number}])[0];
      expect(args.model).toBe('fake/default');expect(args).not.toHaveProperty('reasoning');expect(args).not.toHaveProperty('temperature');expect(args).not.toHaveProperty('maxTokens');
    }
  });
  it('uses an overridden node agent default consistently for capabilities and completion',async()=>{
    const bridge=bridgeSetup(agentId=>agentId==='worker'?{provider:'worker',model:'configured-default'}:{provider:'invoker',model:'configured-default'});
    const context={source:'session-action',api:bridge.api,action:{agentId:'research',sessionKey:'agent:research:test',client:{connId:'test',scopes:['operator.admin']}}} as unknown as FeatureInvocationContext;
    const current=bridge.actor(context);
    expect(bridge.host.capabilities?.(current,{agentId:'worker'})).toMatchObject({model:'worker/configured-default'});
    await bridge.host.complete(current,'Prompt',new AbortController().signal,10000,{agentId:'worker'});
    expect((bridge.complete.mock.lastCall as unknown as [{agentId:string;model:string}])[0]).toMatchObject({agentId:'worker',model:'worker/configured-default'});
    await bridge.host.complete(current,'Prompt',new AbortController().signal,10000,{agentId:'worker',model:'explicit/chosen'});
    expect((bridge.complete.mock.lastCall as unknown as [{agentId:string;model:string}])[0]).toMatchObject({agentId:'worker',model:'explicit/chosen'});
  });
  it('transports legacy execution profile pins and preserves host denial without adopting a new session profile',async()=>{
    const bridge=bridgeSetup();
    const context={source:'session-action',api:bridge.api,action:{agentId:'research',sessionKey:'agent:research:test',client:{connId:'test',scopes:['operator.admin']}}} as unknown as FeatureInvocationContext;
    const current=bridge.actor(context);
    await bridge.host.complete(current,'Prompt',new AbortController().signal,10000);
    expect((bridge.complete.mock.lastCall as unknown as [{execution:object}])[0].execution).not.toHaveProperty('authProfileId');
    bridge.complete.mockRejectedValueOnce(Object.assign(new Error('Legacy account denied.'),{code:'HOST_POLICY_DENIED',status:403}));
    await expect(bridge.host.complete({...current,authProfileId:'legacy-profile',reasoning:'high'},'Prompt',new AbortController().signal,10000)).rejects.toMatchObject({code:'HOST_POLICY_DENIED',status:403});
    expect((bridge.complete.mock.lastCall as unknown as [{execution:object}])[0].execution).toMatchObject({mode:'isolated-agent-runtime',authProfileId:'legacy-profile'});
    expect((bridge.complete.mock.lastCall as unknown as [{reasoning:string}])[0].reasoning).toBe('high');
  });
  it('forwards explicit zero and records requested versus applied settings',async()=>{
    const bridge=bridgeSetup();
    const result=await bridge.host.complete(actor,'Prompt',new AbortController().signal,10000,{model:'fake/other',reasoning:'low',advanced:{temperature:0,maxTokens:1200}});
    expect((bridge.complete.mock.lastCall as unknown[])[0]).toMatchObject({model:'fake/other',reasoning:'low',temperature:0,maxTokens:1200});
    expect(result).toMatchObject({settings:{requested:{advanced:{temperature:0,maxTokens:1200}},transmittedToHost:{temperature:0,maxTokens:1200},applied:'unknown'}});
  });
  it('omits the runtime timeout when the node inherits host behavior',async()=>{
    const bridge=bridgeSetup();await bridge.host.complete(actor,'Prompt',new AbortController().signal,undefined);
    expect((bridge.complete.mock.lastCall as unknown[])[0]).toMatchObject({execution:{mode:'isolated-agent-runtime'}});
    expect(((bridge.complete.mock.lastCall as unknown as [{execution:object}])[0]).execution).not.toHaveProperty('timeoutMs');
  });
  it('blocks unsupported explicit controls before dispatch, not models with those controls unset',async()=>{
    const bridge=bridgeSetup();await expect(bridge.host.complete(actor,'Prompt',new AbortController().signal,10000,{advanced:{frequencyPenalty:0}})).rejects.toThrow(/public isolated completion/);
    expect(bridge.complete).not.toHaveBeenCalled();await bridge.host.complete(actor,'Prompt',new AbortController().signal,10000);expect(bridge.complete).toHaveBeenCalledOnce();
  });
});

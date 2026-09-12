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
  function bridgeSetup(){
    const complete=vi.fn(async()=>({text:'ok'}));
    const cfg={plugins:{entries:{'loops-poc':{enabled:true,llm:{allowModelOverride:true}}}},agents:{defaults:{model:{primary:'fake/default'}}}};
    const entry={sessionId:'test',modelOverride:'active',providerOverride:'fake',thinkingLevel:'high'};
    const api={config:cfg,runtime:{config:{current:()=>cfg},llm:{complete},agent:{normalizeThinkingLevel:(value:string)=>value,session:{getSessionEntry:()=>entry}}}} as unknown as OpenClawPluginApi;
    return {...createBridge(api),api,complete};
  }
  it('uses the active session model for UI, command and agent tool paths without forcing sampling defaults',async()=>{
    const bridge=bridgeSetup();
    for(const source of ['session-action','command','tool'] as const){
      const c={agentId:'research',sessionKey:'agent:research:test',sessionId:'test',isAuthorizedSender:true,client:{connId:'test',scopes:['operator.admin']}};
      const context={source,api:bridge.api,...source==='session-action'?{action:c}:source==='command'?{command:c}:{tool:c}} as unknown as FeatureInvocationContext;
      const a=bridge.actor(context);
      await bridge.host.complete(a,'Prompt',new AbortController().signal,10000);
      const args=(bridge.complete.mock.lastCall as unknown as [{model:string;reasoning:string;temperature?:number;maxTokens?:number}])[0];
      expect(args.model).toBe('fake/active');expect(args.reasoning).toBe('high');expect(args).not.toHaveProperty('temperature');expect(args).not.toHaveProperty('maxTokens');
    }
  });
  it('forwards explicit zero and records requested versus applied settings',async()=>{
    const bridge=bridgeSetup();
    const result=await bridge.host.complete(actor,'Prompt',new AbortController().signal,10000,{model:'fake/other',advanced:{temperature:0,maxTokens:1200}});
    expect((bridge.complete.mock.lastCall as unknown[])[0]).toMatchObject({model:'fake/other',temperature:0,maxTokens:1200});
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

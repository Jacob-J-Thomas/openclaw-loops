import {describe,expect,it} from 'vitest';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import type {FeatureInvocationContext} from 'openclaw/plugin-sdk/feature-plugin';
import {createBridge} from '../src/openclaw.js';
import {Engine,type HostCapabilities,type Run,type State,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';

const sessionKey='agent:main:dashboard:reset-repro';
const sessionId='retained-session-id';
const storePath='/disposable/fixture/sessions.sqlite';

function deferred(){
  let release!:()=>void;
  const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
}

function fixture(options:{lifecycleRevision?:string}={lifecycleRevision:'revision-before'}){
  const beforeAdmission=deferred();
  const entry:{sessionId:string;lifecycleRevision?:string}={sessionId,...options.lifecycleRevision===undefined?{}:{lifecycleRevision:options.lifecycleRevision}};
  const readInterception:{calls:number;missingOn?:number}={calls:0};
  let hostAdmissionCallbacks=0;
  const session={
    resolveStorePath:()=>storePath,
    getSessionEntry:()=>{readInterception.calls++;return readInterception.calls===readInterception.missingOn?undefined:{...entry};},
    runWithWorkAdmission:async<T>(params:{storePath:string;sessionKey:string;signal?:AbortSignal},run:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{
      expect(params).toMatchObject({storePath,sessionKey});
      // The public 9.6 facade awaits ownership before registering admission.
      await beforeAdmission.promise;
      const initial={...entry};
      const current={...entry};
      if(current.sessionId!==initial.sessionId)throw Error('host session identity changed');
      hostAdmissionCallbacks++;
      return run(new AbortController().signal);
    },
  };
  const api={config:{},runtime:{config:{current:()=>({plugins:{enabled:true,entries:{'loops-poc':{enabled:true}}}})},
    modelConfig:{resolveDefaultModelForAgent:()=>({provider:'fixture',model:'none'})},agent:{session}}} as unknown as OpenClawPluginApi;
  const action={source:'session-action',action:{agentId:'main',sessionKey,client:{connId:'fixture-operator',scopes:['operator.write']}}} as unknown as FeatureInvocationContext;
  const currentAssertion={allowed:true,calls:0};
  const toolController=new AbortController();
  const tool={source:'tool',signal:toolController.signal,tool:{agentId:'main',sessionKey,sessionId,requesterSenderId:'fixture-tool',assertInvocationCurrent:()=>{currentAssertion.calls++;if(!currentAssertion.allowed)throw Error('native invocation closed');}}} as unknown as FeatureInvocationContext;
  const commandAssertion={allowed:true,calls:0};
  const command={source:'command',command:{agentId:'main',sessionKey,sessionId,senderId:'fixture-owner',isAuthorizedSender:true,gatewayClientScopes:['operator.write'],assertOwnerCurrent:()=>{commandAssertion.calls++;if(!commandAssertion.allowed)throw Error('command owner closed');}}} as unknown as FeatureInvocationContext;
  return {entry,readInterception,beforeAdmission,bridge:createBridge(api),action,tool,command,toolController,currentAssertion,commandAssertion,getHostAdmissionCallbacks:()=>hostAdmissionCallbacks};
}

describe('session lifecycle at effect work admission',()=>{
  it('rejects an already stale actor without entering host admission or dispatch',async()=>{
    const f=fixture();
    const actor=f.bridge.actor(f.action);
    f.entry.lifecycleRevision='revision-after';
    let effects=0;
    await expect(f.bridge.withCurrentWork(actor,async()=>{effects++;})).rejects.toMatchObject({code:'LOOPS_SESSION_CHANGED'});
    expect(f.getHostAdmissionCallbacks()).toBe(0);
    expect(effects).toBe(0);
  });

  it('blocks a pre-reset actor after the facade awaits, before effect dispatch',async()=>{
    const f=fixture();
    const actor=f.bridge.actor(f.action);
    let effectBoundaryEntries=0;
    const pending=f.bridge.withCurrentWork(actor,async joined=>{effectBoundaryEntries++;joined.check();return 'effect';});
    expect(effectBoundaryEntries).toBe(0);
    f.entry.lifecycleRevision='revision-after';
    f.beforeAdmission.release();
    await expect(pending).rejects.toMatchObject({code:'LOOPS_SESSION_CHANGED'});
    expect(f.getHostAdmissionCallbacks()).toBe(1);
    expect(effectBoundaryEntries).toBe(0);
  });

  it.each([
    ['defined to absent','revision-before',undefined],
    ['absent to defined',undefined,'revision-after'],
  ])('rejects %s lifecycle drift during admission',async(_name,before,after)=>{
    const f=fixture(before===undefined?{}:{lifecycleRevision:before});
    expect(f.entry.lifecycleRevision).toBe(before);
    const actor=f.bridge.actor(f.action);
    let effects=0;
    const pending=f.bridge.withCurrentWork(actor,async()=>{effects++;});
    if(after===undefined)delete f.entry.lifecycleRevision;else f.entry.lifecycleRevision=after;
    f.beforeAdmission.release();
    await expect(pending).rejects.toMatchObject({code:'LOOPS_SESSION_CHANGED'});
    expect(effects).toBe(0);
  });

  it('rejects a missing final entry even when a legacy revision is absent',async()=>{
    const f=fixture({});
    const actor=f.bridge.actor(f.action);
    expect(f.entry.lifecycleRevision).toBeUndefined();
    f.readInterception.missingOn=f.readInterception.calls+2;
    let effects=0;
    await expect(f.bridge.withCurrentWork(actor,async()=>{effects++;})).rejects.toMatchObject({code:'LOOPS_SESSION_CHANGED'});
    expect(f.getHostAdmissionCallbacks()).toBe(0);
    expect(effects).toBe(0);
  });

  it('rechecks a joined actor after admission and before its later effect',async()=>{
    const f=fixture();
    const actor=f.bridge.actor(f.action);
    let effects=0;
    const joinedReady=deferred(),continueWork=deferred();
    const pending=f.bridge.withCurrentWork(actor,async joined=>{
      joinedReady.release();
      await continueWork.promise;
      joined.check();
      effects++;
    });
    f.beforeAdmission.release();
    await joinedReady.promise;
    f.entry.lifecycleRevision='revision-after';
    continueWork.release();
    await expect(pending).rejects.toMatchObject({code:'LOOPS_SESSION_CHANGED'});
    expect(effects).toBe(0);
  });

  it('accepts unchanged and newly current actors, while retaining native tool assertion',async()=>{
    const f=fixture();
    const old=f.bridge.actor(f.tool);
    f.beforeAdmission.release();
    expect(await f.bridge.withCurrentWork(old,async joined=>{joined.check();return 'old-current';})).toBe('old-current');
    f.entry.lifecycleRevision='revision-after';
    const current=f.bridge.actor(f.tool);
    expect(await f.bridge.withCurrentWork(current,async joined=>{joined.check();return 'new-current';})).toBe('new-current');
    f.currentAssertion.allowed=false;
    await expect(f.bridge.withCurrentWork(current,async()=>{throw Error('effect must not enter');})).rejects.toThrow('native invocation closed');
    expect(f.currentAssertion.calls).toBeGreaterThan(2);
  });

  it('accepts unchanged optional legacy revision and preserves command owner assertion',async()=>{
    const f=fixture({});
    expect(f.entry.lifecycleRevision).toBeUndefined();
    const actor=f.bridge.actor(f.command);
    f.beforeAdmission.release();
    expect(await f.bridge.withCurrentWork(actor,async joined=>{joined.check();return 'current-command';})).toBe('current-command');
    f.commandAssertion.allowed=false;
    await expect(f.bridge.withCurrentWork(actor,async()=>{throw Error('effect must not enter');})).rejects.toThrow('command owner closed');
    const current=f.bridge.actor(f.action);
    // A copied actor has no separate work admission credential. The original
    // current actor still works; a copy cannot be used as a new admission.
    await expect(f.bridge.withCurrentWork({...current},async()=>{throw Error('effect must not enter');})).rejects.toMatchObject({code:'HOST_POLICY_DENIED'});
    expect(await f.bridge.withCurrentWork(current,async joined=>{joined.check();return 'still-current';})).toBe('still-current');
  });

  it('does not dispatch an aborted native tool invocation',async()=>{
    const f=fixture();
    const actor=f.bridge.actor(f.tool);
    let effects=0;
    const pending=f.bridge.withCurrentWork(actor,async()=>{effects++;});
    f.toolController.abort();
    f.beforeAdmission.release();
    await expect(pending).rejects.toThrow();
    expect(effects).toBe(0);
  });

  it('keeps same-session old-run history readable after reset',()=>{
    const f=fixture();
    const oldActor=f.bridge.actor(f.action);
    const oldRun:Run={id:'old-run',requestKey:'old-request',requestFingerprint:'old-fingerprint',owner:{agentId:oldActor.agentId,sessionKey:oldActor.sessionKey,sessionId:oldActor.sessionId},source:'session-action',definition:structuredClone(examples[0]),input:{text:'fixture'},state:'completed',cursor:'return',outputs:{},trace:[],executions:2,activeMs:1,createdAt:'2026-09-25T00:00:00.000Z',updatedAt:'2026-09-25T00:00:01.000Z',result:'retained-history'};
    let state:State={version:1,loops:{},runs:{[oldRun.id]:oldRun}};
    const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const host:HostCapabilities={check:()=>{},complete:async()=>{throw Error('forbidden model call');},modelInfo:async()=>{throw Error('forbidden model call');}};
    const engine=new Engine(storage,host);
    f.entry.lifecycleRevision='revision-after';
    const current=f.bridge.actor(f.action);
    expect(engine.status(current,'old-run').result).toBe('retained-history');
    expect(engine.history(current).items.map(run=>run.id)).toContain('old-run');
    expect(()=>engine.status({...current,sessionId:'foreign'},'old-run')).toThrow(/not found/i);
  });
});
